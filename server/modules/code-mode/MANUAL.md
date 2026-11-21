<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-10091 — code-mode

Code Mode for chats, CloudCLI's side: the two hooks the Claude runtime asks through its context (`context.codeMode`, MAN-8487), each answered by the house's verb `~/.claude/scripts/code-mode config --chat` (MAN-10072). Whether a chat works with one search and one script is the house's answer, behind its `chats` switch; this module passes the chat's facts, stores the one fact a chat keeps (the mode it was born in), and mounts no route and draws nothing.

| file | owns |
| --- | --- |
| `code-mode.service.ts` | `codeModeService` = `launchFor`, `serversChanged` |
| `code-mode.module.ts`, `index.ts` | `createCodeModeModule()` — the barrel's one export; calls `providerRuntimeService.useChatCodeMode` once, from `server/index.ts` beside the toolsets module |

The shapes are `ChatCodeModeLaunch` and `ChatCodeModeHooks` in `server/shared/code-mode-types.ts`; neither crosses a wire, so `src/shared` has no mirror. The runtime imports nothing from this module.

## `launchFor({ appSessionId, onNode, cwd, servers })`

1. `{ on: false }`, with no verb call, for no `appSessionId`, for `onNode`, and for Kaylee's own chat: a `cwd` at or under `~/.claude/state/companion` (her CLI is launched in `<that>/<user id>`; the companion barrel exports nothing to ask).
2. Reads `sessionUserStateDb.getCodeMode(id)` — `sessions.code_mode`: 1 born on, 0 born off; NULL reads born off when the row already holds a conversation (`provider_session_id` or `jsonl_path` set), so a chat that existed before its mode was decided never changes mode halfway through, and undecided only for a chat's first launch.
3. Runs `code-mode config --chat <id> --cwd <cwd>`, plus `--born on|off` when the row holds a word, with `servers` as JSON on stdin (a map can carry a token, and argv shows in `ps`): `execFile` on the verb's absolute path, 12 s, 1 MB of output, `userFacingEnv()`, cwd home.
4. Parses the LAST non-empty stdout line and checks every field: `{on:false}` with its `why` kept beside the launch (never inside it), or `{on:true}` with `tools` strings, `server.command` a non-empty string and `server.args` strings, `prompt` a string, `env` string values. The launch is rebuilt field by field, so nothing beyond the contract reaches the runtime.
5. Only the switch's own answer (on, or off with an empty `why`), and only for a chat whose row held no word: `setCodeMode(id, launch.on)`. A chat keeps the mode it was started in; `--born` means the verb never reads the switch for it again.

Any failure — the stored mode unreadable, the verb timed out, exited non-zero or printed more than the cap, a last line that is not a launch, or an off whose `why` names the house's reason (the box not ready, the chat's folder not a directory) — answers `{ on: false }` and stores nothing, so the next message asks again and the chat launches as it does today (INV-78). A store that finds no row (`setCodeMode` false) still answers the launch.

## `serversChanged({ appSessionId, servers })`

Runs `code-mode config --chat <id> --servers` with the map on stdin; the verb rewrites that chat's `server.json` atomically. A failure is logged once and REJECTED with the verb's reason (`the house could not hand chat <id> its changed servers: <reason>`): the verb's exit 2 (a chat with no `server.json`, never launched in Code Mode, or one retention removed), a timeout, a crash. The runtime's push (`createCodeModeServerSync`) turns the rejection into `confirmed: false` with that reason, so the switch never reads connected over a bridge that took nothing.

## Logging

`[code-mode] chat <id> <what>: <cause>`, once per distinct cause for the process's life (`what` is `launches without Code Mode`, `could not store the mode it launched in` or `could not hand its changed servers to the house`). The key takes the chat id out of the cause, because the verb's stderr names the chat: the same failure in a second chat is not logged again. At 200 kept keys the set is emptied.

## The column

`sessions.code_mode INTEGER` (nullable), added by `addSessionCodeModeColumn` in `migrations.ts`, run from `runMigrations` at boot right after `sessions.toolsets`; nothing is backfilled (the held-conversation rule above is read at every launch, so it reaches the rows the live database already had) and nothing is left for the operator to apply. Read and written only through `sessionUserStateDb.getCodeMode` / `setCodeMode`; a value other than 0 or 1 reads undecided with one warning.

## Probing

Import `code-mode.service.ts` directly through `cloudcli-tsx` with `DATABASE_PATH` on a scratch database and `CODE_MODE_FLAG_DIR` on a scratch folder holding `chats.flag`; never write `chats.flag` at its real place. The verb writes `~/.claude/state/code_mode/chats/<id>/` for each chat it answers on.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/code-mode/, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-user-state.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/code-mode-types.ts
