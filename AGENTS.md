# Repository guidance

## Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

## Frontend code

For every task that creates, modifies, refactors, or reviews frontend code under `src/`, load and follow `$frontend-module-standards` from `.agents/skills/frontend-module-standards/SKILL.md`. Apply it only to frontend code; do not impose those architecture rules on the backend.

## Probes run on Haiku

Every real model call made to reproduce or prove a change runs on Haiku, so a probe never spends the operator's usage on a bigger model:

- A probe chat driven through the app passes `model: 'haiku'` in its send options.
- A direct Agent SDK `query` passes `model: 'claude-haiku-4-5-20251001'`.
- A `claude -p` run passes `--model claude-haiku-4-5-20251001`.
- A probe chat that sends a turn is launched in `.verify/lib/probe-project.mjs`'s scratch project under `/tmp`, never in a real project such as this repo: it logs in as the operator, so the heal reading tells its prompt from his only by where CloudCLI launched the chat, and a probe prompt filed as his correction fires a heal.

Never let a probe fall back to the app's default model. Keep probe turns short and few.
