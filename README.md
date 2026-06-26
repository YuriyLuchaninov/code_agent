# Gemini Mini Code Agent

A tiny TypeScript coding-agent harness powered by the Gemini API.

It is intentionally small enough to read in one sitting, but it still contains the core ideas behind tools like Claude Code, OpenCode, Codex-style coding agents, and other terminal-based agent harnesses:

1. Give the model a task.
2. Let the model request a tool call.
3. Execute the tool in your local harness.
4. Send the tool result back to the model.
5. Repeat until the model stops asking for tools.

The main implementation lives in [`src/agent.ts`](./src/agent.ts). It is designed for educational use and for blog posts that explain how agent harnesses work under the hood.

## What this agent can do

The agent exposes two custom tools to Gemini:

### `bash`

Runs a single bash command in the current working directory.

The harness adds a few guardrails:

- human approval before each command;
- `AUTO_APPROVE=1` for controlled demos and throwaway sandboxes;
- command timeout;
- output truncation;
- denylist for obviously dangerous commands such as `sudo`, `rm -rf /`, `curl | bash`, disk formatting, fork bombs, and destructive `git clean`.

This is still **not a real sandbox**. Run it in Docker, a devcontainer, a VM, or a disposable repository if you want to let it edit files.

### `skill`

Lists or loads lazy Markdown skills from `.agent/skills/*.md`.

This is the small unusual feature that makes the harness more interesting than a bare `bash` loop. Instead of stuffing every instruction into the system prompt, the agent can load specialized instructions only when they are useful:

- `code-review`
- `typescript-agent`
- `article-writer`

This is a simple form of context engineering: skills stay out of the prompt until the model asks for them.

## Requirements

- Node.js 20+
- A Gemini API key
- A Unix-like shell with `bash`

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env`:

```bash
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-3.5-flash
```

You can also export the variables directly in your shell.

## Usage

```bash
GEMINI_API_KEY=... npm run dev -- "inspect this repo and explain how it works"
```

Ask it to use a skill:

```bash
GEMINI_API_KEY=... npm run dev -- "load the typescript-agent skill, then review src/agent.ts"
```

Run in a disposable sandbox with automatic approval:

```bash
AUTO_APPROVE=1 GEMINI_API_KEY=... npm run dev -- "run the typecheck and fix any errors"
```

## Scripts

```bash
npm run dev -- "your task"   # run the agent with tsx
npm run start -- "your task" # same as dev
npm run typecheck            # TypeScript typecheck
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | required | Gemini API key. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model name. Use a stronger model for harder coding tasks. |
| `MAX_TURNS` | `25` | Maximum agent-loop iterations. |
| `COMMAND_TIMEOUT_MS` | `20000` | Bash command timeout. |
| `MAX_OUTPUT_CHARS` | `12000` | Maximum stored command output. |
| `AUTO_APPROVE` | `0` | Set to `1` to skip interactive command approval. |

## Architecture

The harness is deliberately boring:

```text
user task
  ↓
Gemini Interactions API call with tool declarations
  ↓
model returns text and/or function_call steps
  ↓
harness executes bash or skill locally
  ↓
harness appends function_result steps
  ↓
repeat
```

The model does not run tools by itself. The harness owns execution, validation, timeouts, approvals, and the working directory.

## Why this exists

This repository is meant to accompany an article idea like:

> My own "Claude Code" on minimum settings: bash, tools, loop, and a little fear.

The point is not to compete with production coding agents. The point is to make the core mechanism visible:

- the model is not the agent;
- the harness is the product layer around the model;
- tools are just functions with schemas;
- the agent loop is small;
- the hard parts are safety, state, context management, UX, sandboxing, and evaluation.

## Production gaps

Before turning this into a real tool, you would need at least:

- a proper filesystem sandbox;
- structured patch application instead of arbitrary shell editing;
- allowlists per tool and per command family;
- persistent sessions;
- context compaction;
- telemetry and trace logs;
- model/tool retries;
- regression evals;
- a stronger permission model.

## Example tasks

After installing dependencies and setting `GEMINI_API_KEY`, you can run the agent with a natural-language task:

```bash
npm run start -- "List available skills, then inspect this repository and explain its structure in 5 bullets."
```

Ask it to explain how the project works:

```bash
npm run start -- "Read package.json, tsconfig.json, README.md, and src/agent.ts. Explain how to run this project and what the main agent loop does."
```

Ask it to inspect the agent implementation:

```bash
npm run start -- "Inspect src/agent.ts and explain where the model is called, where tool calls are executed, and where tool results are appended back into the interaction history."
```

Use a lazy-loaded skill:

```bash
npm run start -- "Use the code-review skill and review src/agent.ts. Focus on security risks, TypeScript typing, and places where the code is intentionally minimal."
```

Use the article-writing skill:

```bash
npm run start -- "Use the article-writer skill and propose a short outline for a blog post titled: 'A Tiny Claude Code Clone: Bash, Tools, Loop, and a Little Fear'."
```

Run project checks through the agent:

```bash
npm run start -- "Run npm run typecheck. If it fails, inspect the error and suggest the smallest possible fix."
```

Ask for a small documentation change:

```bash
npm run start -- "Create docs/demo-task.md with three example tasks for this agent: one read-only task, one code review task, and one small editing task."
```

Ask for a small code improvement while keeping the project minimal:

```bash
npm run start -- "Use the typescript-agent skill, inspect this project, run typecheck, then propose one small improvement that keeps the agent easy to explain in a blog post."
```

You can also run the agent without manual approval prompts by setting `AUTO_APPROVE=1`:

```bash
AUTO_APPROVE=1 npm run start -- "Run npm run typecheck and summarize the result."
```

Use `AUTO_APPROVE=1` only in a disposable repository, container, VM, or another safe sandbox. The built-in denylist, timeouts, and output limits are guardrails, not a real security boundary.


## License

MIT
