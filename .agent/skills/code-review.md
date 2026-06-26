# Code Review Skill

Use this when the user asks for review, refactoring, or quality improvements.

Checklist:
- Understand the current behavior before suggesting changes.
- Run the smallest relevant test or typecheck command before editing.
- Prefer minimal diffs over rewrites.
- Look for unsafe shell usage, path traversal, missing timeouts, unbounded output, and secret leaks.
- After editing, run tests again and summarize what changed.
