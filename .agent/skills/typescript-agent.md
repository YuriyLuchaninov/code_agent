# TypeScript Agent Skill

Use this for TypeScript CLI and agent-harness work.

Rules:
- Keep the public API tiny and explicit.
- Prefer typed helpers over large framework abstractions.
- Avoid LangChain-style indirection unless the user asks for it.
- Model messages, tool calls, and tool results as plain serializable data.
- Keep all filesystem and shell access behind tool functions.
