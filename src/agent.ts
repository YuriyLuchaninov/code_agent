#!/usr/bin/env npx tsx
import "dotenv/config";
import { GoogleGenAI, type Interactions } from "@google/genai";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

type AnyStep = Interactions.Step;
type FunctionCallStep = Interactions.FunctionCallStep;
type FunctionResultStep = Interactions.FunctionResultStep;

const API_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const WORKDIR = process.cwd();
const SKILLS_DIR = path.join(WORKDIR, ".agent", "skills");
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 25);
const TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS ?? 20_000);
const MAX_OUTPUT = Number(process.env.MAX_OUTPUT_CHARS ?? 12_000);
const AUTO_APPROVE = process.env.AUTO_APPROVE === "1";

const systemPrompt = `You are a tiny coding agent running in: ${WORKDIR}
You have two tools:
- bash: inspect files, edit files, run tests, and verify work.
- skill: list or load lazy Markdown skills from .agent/skills when you need specialized instructions.
Work iteratively: inspect before editing, make small changes, run checks, then summarize.
Never escape the working directory. Never run destructive commands. Ask for a skill before guessing domain-specific workflow.`;

const tools = [
  {
    type: "function",
    name: "bash",
    description: "Run one bash command in the current project directory after human approval.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "A single bash command to execute." },
      },
      required: ["cmd"],
    },
  },
  {
    type: "function",
    name: "skill",
    description: "List available skills or load one skill from .agent/skills/<name>.md.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Optional skill name without .md. Omit to list skills." },
      },
    },
  },
] satisfies Interactions.Tool[];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function cut(text: string, limit = MAX_OUTPUT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n... <truncated ${text.length - limit} chars>`;
}

function textArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function blocked(cmd: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/\brm\s+-rf\s+[\/~*]/i, "destructive rm -rf"],
    [/\bsudo\b/i, "sudo is not allowed"],
    [/\bmkfs\b|\bdd\s+if=/i, "disk-level command"],
    [/\bchmod\s+-R\s+777\b/i, "unsafe chmod"],
    [/\b(curl|wget)\b[^|;]*\|\s*(sh|bash)\b/i, "pipe-to-shell install"],
    [/(:(\s*)\(\)\s*\{\s*:\|:&\s*}\s*;:)/, "fork bomb"],
    [/\bgit\s+clean\s+(-[a-z]*f[a-z]*d|-[a-z]*d[a-z]*f)/i, "destructive git clean"],
  ];
  return rules.find(([pattern]) => pattern.test(cmd))?.[1] ?? null;
}

async function approve(cmd: string): Promise<boolean> {
  if (AUTO_APPROVE) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`\nRun in ${WORKDIR}?\n$ ${cmd}\nAllow? [y/N] `);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function runBash(cmd: string): Promise<string> {
  const command = cmd.trim();
  if (!command) return "ERROR: empty command";
  const reason = blocked(command);
  if (reason) return `BLOCKED: ${reason}`;
  if (!(await approve(command))) return "REJECTED: human did not approve this command";

  return new Promise((resolve) => {
    let stdout = "", stderr = "", timedOut = false;
    const child = spawn("bash", ["-lc", command], { cwd: WORKDIR, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, TIMEOUT_MS);
    child.stdout.on("data", (x) => { stdout = cut(stdout + x.toString()); });
    child.stderr.on("data", (x) => { stderr = cut(stderr + x.toString()); });
    child.on("error", (e) => { clearTimeout(timer); resolve(`ERROR: ${e.message}`); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(cut([
        `exit_code=${code}${timedOut ? " (timeout)" : ""}`,
        stdout && `stdout:\n${stdout}`,
        stderr && `stderr:\n${stderr}`,
      ].filter(Boolean).join("\n\n")));
    });
  });
}

async function loadSkill(rawName?: string): Promise<string> {
  const files = await readdir(SKILLS_DIR).catch(() => []);
  const skills = files.filter((x) => x.endsWith(".md")).map((x) => x.replace(/\.md$/, "")).sort();
  const name = (rawName ?? "").trim().replace(/\.md$/, "");
  if (!name) return skills.length ? `Available skills:\n${skills.map((x) => `- ${x}`).join("\n")}` : "No skills found.";
  if (!/^[a-z0-9_-]+$/i.test(name)) return "ERROR: invalid skill name";

  const file = path.join(SKILLS_DIR, `${name}.md`);
  const safeRoot = path.resolve(SKILLS_DIR) + path.sep;
  if (!path.resolve(file).startsWith(safeRoot)) return "ERROR: skill path escaped skills directory";
  const text = await readFile(file, "utf8").catch(() => "");
  return text ? cut(`# Skill: ${name}\n\n${text}`, 8_000) : `ERROR: skill '${name}' not found. Available: ${skills.join(", ") || "none"}`;
}

function resultStep(call: FunctionCallStep, text: string): FunctionResultStep {
  return {
    type: "function_result",
    name: call.name,
    call_id: call.id,
    result: JSON.stringify({ output: text }),
  };
}

async function execute(call: FunctionCallStep): Promise<FunctionResultStep> {
  const args = call.arguments ?? {};
  const name = call.name;
  if (name === "bash") return resultStep(call, await runBash(textArg(args.cmd)));
  if (name === "skill") return resultStep(call, await loadSkill(textArg(args.name)));
  return resultStep(call, `ERROR: unknown tool '${name}'`);
}

async function agent(task: string): Promise<void> {
  if (!API_KEY) fail("Set GEMINI_API_KEY first.");
  const ai = new GoogleGenAI({ vertexai: false, apiKey: API_KEY });
  const history: AnyStep[] = [{ type: "user_input", content: [{ type: "text", text: `${systemPrompt}\n\nUser task:\n${task}` }] }];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    console.log(`\n--- turn ${turn}/${MAX_TURNS} ---`);
    const interaction = await ai.interactions.create({ model: MODEL, store: false, input: history, tools });
    const steps = ((interaction as { steps?: AnyStep[] }).steps ?? []) as AnyStep[];
    history.push(...steps);

    const outputText = textArg((interaction as { output_text?: unknown; outputText?: unknown }).output_text ?? (interaction as { outputText?: unknown }).outputText);
    if (outputText.trim()) console.log(outputText);

    const calls = steps.filter((x): x is FunctionCallStep => x.type === "function_call");
    if (calls.length === 0) {
      console.log("\nagent finished");
      return;
    }

    for (const call of calls) {
      console.log(`\ntool -> ${call.name}: ${JSON.stringify(call.arguments ?? {})}`);
      const result = await execute(call);
      console.log(cut(JSON.parse(String(result.result)).output, 1_500));
      history.push(result);
    }
  }
  console.log(`\nagent stopped: MAX_TURNS=${MAX_TURNS}`);
}

const task = process.argv.slice(2).join(" ").trim();
if (!task) fail('Usage: GEMINI_API_KEY=... npm run dev -- "inspect this project"');
await agent(task).catch((e) => fail(e instanceof Error ? e.message : String(e)));
