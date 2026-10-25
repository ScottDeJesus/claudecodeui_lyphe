<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-8497 — toolsets

Named MCP tool sets, defined per box and switched on per conversation: the box file `toolsets.local.json` names the sets, `sessions.toolsets` holds the ones a chat has on, and a chat's CLI gets a set's servers through `Query.setMcpServers`. A caller names a set; no door and no command takes a server config.

| file | owns |
| --- | --- |
| `toolsets.registry.ts` | `resolveToolsetsFile`, `ensureToolsetsFile`, `readToolsetRegistry`, `SET_NAME_PATTERN` |
| `toolsets.service.ts` | `toolsetsService` = `launchFor`, `view`, `switchSet` |
| `toolsets.routes.ts` | `createToolsetsUserRouter`, `createToolsetsCommandRouter` (its first middleware is the shared `chatCredentialGuard`) |
| `toolsets.pointer.ts` | `toolsetPointer(sets)` |
| `toolsets.module.ts`, `index.ts` | `createToolsetsModule()` — the barrel's one export |

The credential a chat carries, the guard of the command doors, the account of a chat and the link that puts a command into `~/.local/bin` are `server/modules/chat-commands/` (MAN-8992), shared with the `notes` command.

Outside the directory: `bin/toolset.mjs`, `server/shared/toolset-types.ts` (+ `src/shared/` mirror), `claude-toolset-seams.ts` in `providers`, the composer section in `src/modules/chat/`.

## Rows

| question | row |
| --- | --- |
| the box file, its validation rules, `sessions.toolsets` | MAN-8498 |
| the two doors, the mounts, `createToolsetsModule` | MAN-8499 |
| the per-chat credential, the command doors' guard, the account of a chat, the command link | MAN-8992 |
| `view`, `switchSet`, every refusal code, the launch hook, the pointer sentence, the frame | MAN-8500 |
| the `toolset` command: usage, stdout, exit codes, the link, the PATH | MAN-8501 |
| edits that break the mechanism (one `setMcpServers` path, the retry's call, the base-name guard, the SDK-server trap, tool sets stay a live setting) | INV-8471 |
| edits that break the doors (no server config from a caller, the guard first, one credential per chat) | INV-8472 |
| the shared types, `ProviderRuntimeContext.toolsets`, `syncToolsets`, `loopbackApiOrigin`, `JWT_SECRET` | MAN-8487 |
| the Claude runtime's seam, beside MAN-8055: context hook, launch, functions, call-ins | MAN-8495 |
| the seam's hold on a fresh process, applied digest, live settings, why a sync never retires | MAN-8502 |
| the seam's one mechanism, one sync run, the journal line, the traps | MAN-8503 |
| the composer section and `useSessionToolsets` | MAN-8490 |
| the whole-system proof | MAN-8496 |

## Register a set

1. Add a stanza to `toolsets.local.json` (shape: MAN-8498). No restart: the file is read at every call.
2. A chat's model menu (the last group) lists it at the next read: opening the chat, a `session_toolsets_changed` frame, a reconnect or a reload.
3. A press switches it on for that chat, in any chat with a live process; its tools arrive in the same turn as deferred tools. `toolset on <name>` in the chat's Bash does the same, but only in a chat whose process was launched after the credential shipped (an older process answers `unavailable`, exit 3: MAN-8501).
4. A chat's next fresh process names the set to the model in its system prompt (MAN-8500).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/

## MAN-8498 — Tool sets storage — the box file `toolsets.local.json` and the `sessions.toolsets` column

Where sets are defined (a file) and which a chat has on (a column). Map: MAN-8497. Types: MAN-8487. A caller names a set; no verb takes a server config. why: a chat can switch a set that is defined, never define one.

## The box file — `toolsets.local.json`

| fact | value |
| --- | --- |
| path | `resolveToolsetsFile()`: `TOOLSETS_FILE` when set, else `<application root>/toolsets.local.json` (found from the module's directory, never `process.cwd()`), beside `apps.local.json` |
| git | ignored (`.gitignore`, under the application-registry lines) |
| created | `ensureToolsetsFile()` at boot writes `{}\n` with `flag: 'wx'`; `EEXIST` is swallowed; a failure is one `[toolsets]` warning and the API stays up |
| repaired | never. A file that exists is never rewritten, whatever it holds. A deleted file reads back as `{}` (the reader re-ensures it) |
| cached | never. `readToolsetRegistry()` reads and validates at every call (view, switch, launch hook): a set appended by hand is live for the next message and the next switch, with no restart |
| written otherwise | never by the server |
| reader | `readToolsetRegistry()` → `{ file, sets: ToolsetDefinition[] }`; consumer `toolsets.service.ts` |

Shape (the proof's probe set; this box ships `{}`):

```json
{ "probe": { "description": "Echo probe for the tool-set proof",
             "mcpServers": { "probe": { "type": "stdio", "command": "/usr/bin/node", "args": ["/tmp/mcp-probe/probe-server.mjs"] } } } }
```

## Reader rules

All-or-nothing, in file order; the first defect is the one reported, as `AppError` `TOOLSETS_REGISTRY_INVALID` (500, `details.path` = the file). why: a half-read registry would let a chat switch a set from a file its owner has not finished editing.

| rule | refusal text starts |
| --- | --- |
| file is JSON | `the file is not valid JSON (…)` / `the file could not be read (…)` |
| root is an object | `the file must be a JSON object whose keys are set names` |
| set name matches `SET_NAME_PATTERN` = `^[a-z0-9][a-z0-9_-]{0,31}$` | `set "<name>": a set name is …` |
| set is an object | `set "<n>": a set must be a JSON object` |
| `description` absent, or a non-blank string (trimmed) | `set "<n>": description must be a non-empty string` |
| `mcpServers` an object with ≥ 1 server | `set "<n>": mcpServers must be an object holding at least one server` |
| server name `^[A-Za-z0-9_-]{1,64}$` | `set "<n>": server "<s>": a server name is …` |
| server name unique across the whole box | `… already defined by set "<owner>" …` |
| server is an object | `a server must be a JSON object` |
| no `type` or `stdio`: non-empty `command`; `args` a string list; `env` a string record | `a stdio server needs a command` / `args must be a list of strings` / `env must be an object of strings` |
| `http` / `sse`: non-empty `url`; `headers` a string record | `an <type> server needs a url` (`an http server …`, `an sse server …`) / `headers must be an object of strings` |
| any other `type`, `sdk` included | `type <t> is not supported (a server is stdio, http or sse)`, `<t>` printed as JSON: a string is quoted (`type "sdk"`), a non-string is bare (`type 5`, `type null`) |

- Message shape: `set "home": server "ha": an http server needs a url`.
- Every other key of a server passes through untouched; the CLI reads it. A stdio server with no `args` is sent to the CLI with `args: []` (MAN-8495).
- `sdk` is refused. why: an in-process server cannot be defined in a file (INV-8471).
- Servers are built with `Object.fromEntries`: `__proto__` is a legal server name.
- Listing order is `JSON.parse` key order (an all-digit name sorts first); the launch merge sorts by set name.

## The column — `sessions.toolsets`

| value | means |
| --- | --- |
| `NULL` | never switched: launches as before the column existed, no control request |
| `[]` | switched on and off again; a switch never writes it back to `NULL` |
| `["a","b"]` | JSON array of strings, sorted, de-duplicated |

- Declared in `SESSIONS_TABLE_SCHEMA_SQL` (`schema.ts`); added to an existing database by `addSessionToolsetsColumn` (`migrations.ts`, after `addSimpleListFolders`). Nothing backfilled.
- `sessionUserStateDb.getToolsets(sessionId)` → `string[] | null`. A cell that is not a JSON string array reads `null` with one warning naming the session, at every read.
- `sessionUserStateDb.setToolsets(sessionId, names)` writes the sorted, de-duplicated array; `false` when no row has the id.
- why on the chat's own row: the row IS the session. It follows the chat through a compaction or an edited first message (both move the chat to a new provider id), and is deleted with the chat. `SESSION_ROW_COLUMNS` and the fork insert do not carry it.
- Read it: `sqlite3 ~/.cloudcli/auth.db "select session_id, toolsets from sessions where toolsets is not null"`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.gitignore, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-user-state.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.registry.ts

## MAN-8499 — Tool sets doors — `/api/toolsets`, `/api/toolsets-cmd`, the mounts and `createToolsetsModule`

Two routers from `createToolsetsModule()`; each route parses, calls one `toolsetsService` verb and answers (verbs: MAN-8500). Map: MAN-8497. A body never carries a server config.

## `createToolsetsModule()` → `{ userRouter, commandRouter }`

Called once in `server/index.ts`, before both mounts. In order:

1. `ensureToolsetsFile()` — creates the box file as `{}` (MAN-8498).
2. `ensureChatCommandLink('toolset', 'toolsets')` — links `~/.local/bin/toolset` (MAN-8992, MAN-8501).
3. `providerRuntimeService.useChatToolsets({ launchFor })` — registers the launch hook (MAN-8487).

Steps 1 and 2 are each wrapped: a failure is one `[toolsets]` warning and the API stays up. why: a read-only root or home must not take down chat, files and git for a list of sets; the view answers the broken setup on the one request that needs the file.

## Mounts — `server/index.ts`

| path | guard | router |
| --- | --- | --- |
| `/api/toolsets` | `authenticateToken` | `userRouter` |
| `/api/toolsets-cmd` | none at the mount; `chatCredentialGuard` (MAN-8992) is the router's first middleware | `commandRouter` |

- Both mount after `/api/apps` and above the `/api` 404 (`API_ROUTE_NOT_FOUND`).
- `validateApiKey` guards all of `/api`: with `API_KEY` set, the `toolset` command (it sends no `x-api-key`) gets 401 at `/api/toolsets-cmd`. This box has no `API_KEY` in `.env`.
- Every refusal goes to `next`; the global handler answers `{ success: false, error: { code, message, details? } }`.

## User door — `/api/toolsets` (the operator's token)

| call | answers |
| --- | --- |
| `GET /sessions/:sessionId` | `{ success: true, data: SessionToolsetsView }`; `:sessionId` is the app's |
| `PUT /sessions/:sessionId/sets/:set` body `{ "on": boolean }` | `{ success: true, data: ToolsetSwitchResult }` |

- A malformed `:sessionId` → 400 `INVALID_SESSION_ID` (`parseSessionId`). A non-boolean `on` → 400 `TOOLSET_BODY_INVALID`. Every other refusal is `view`'s and `switchSet`'s (MAN-8500).
- No token → 401 from `authenticateToken`.
- Client: the composer, through `api.toolsets.read` / `api.toolsets.set` and `useSessionToolsets` (MAN-8490).

## Command door — `POST /api/toolsets-cmd` (the chat's credential)

- Body `ToolsetCommandRequest` = `{ claudeSessionId, action: 'list' | 'on' | 'off', set? }`. Any other `action` → 400 `TOOLSET_ACTION_INVALID`.
- `list` → `{ success: true, data: SessionToolsetsView }`; `on` / `off` → `{ success: true, data: ToolsetSwitchResult }`. A missing or malformed `set` reaches `switchSet`, which answers 400 `TOOLSET_NAME_INVALID`.
- The route takes the chat's app session id from `chatAppSessionOf(res)`, never from the body.
- Client: `bin/toolset.mjs` (MAN-8501).

### Guard and credential

The guard is `chatCredentialGuard` and the credential is `chatCredential(appSessionId)`, both of `server/modules/chat-commands/` (MAN-8992), shared with the doors of the `notes` and `followups` commands. A miss of any kind is 401 `CHAT_CREDENTIAL_REFUSED`; a pass leaves the chat's app session id for `chatAppSessionOf(res)`.

Measured 2026-10-25: `POST /api/toolsets-cmd` with a wrong bearer → HTTP 401 and that envelope. Measured 2026-10-16: `GET /api/toolsets/sessions/<id>` with no token → 401.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.routes.ts

## MAN-8500 — Tool sets verbs — `view`, `switchSet`, the launch hook `launchFor`, the pointer sentence and the `session_toolsets_changed` frame

`toolsetsService` = `{ launchFor, view, switchSet }` (`toolsets.service.ts`). Callers: the two doors (MAN-8499), `server/index.ts` through `createToolsetsModule()`. Map: MAN-8497. Types: MAN-8487.

## `view(appSessionId)` → `SessionToolsetsView`

| field | holds |
| --- | --- |
| `sessionId` | the app's session id |
| `availability`, `node` | `'available'` / `'node'`; `node` is the Cerberus node when `projectsDb.nodeForPath(row.project_path)` names one. A node chat still lists the sets |
| `sets[]` | every set the box defines, file order: `name`, `description` (or null), `servers` (names), `on` |
| `strays` | names on for this chat that the box no longer defines, sorted |
| `registryError`, `registryFile` | why the box file could not be read (else null); its absolute path |

- A broken box file is data in `view`: `sets: []`, `strays: []`, `registryError` set. why: every on-name would read as a stray.

## Refusals — `view` and `switchSet`

| when | answers |
| --- | --- |
| no chat with the id | 404 `SESSION_NOT_FOUND` |
| chat's provider is not `claude` | 400 `TOOLSETS_CLAUDE_ONLY` |
| `switchSet` on a chat whose project runs on a Cerberus node | 409 `TOOLSETS_NOT_ON_THIS_BOX`, `details.node`; row untouched |
| `switchSet` with the box file broken | 500 `TOOLSETS_REGISTRY_INVALID`; row untouched |
| `set` not a string or not `SET_NAME_PATTERN` | 400 `TOOLSET_NAME_INVALID` |
| `on` of a name the box does not define | 404 `TOOLSET_NOT_DEFINED`, `details.defined` = the defined names |
| `off` of an undefined name that is one of the chat's strays | allowed; names no servers |

## `switchSet(appSessionId, set, on)` → `ToolsetSwitchResult`

`set` is `unknown`: the command door passes its body's field through unjudged and this is where it is judged.

1. Claude-chat check, node check, read registry, name check, defined check (the refusals above, in that order).
2. Next list = the row's list (`NULL` read as `[]`) with the name added or removed, sorted. Written only when it differs: `changed`.
3. Sync: `providerRuntimeService.syncToolsets('claude', id)`, skipped when the row was `NULL` and nothing changed (an `off` of a defined set on a never-switched chat): `live: 'applied'`, every server `unchanged`.
4. Each of THIS set's servers gets an outcome:

| sync answer | `live` | server `outcome` |
| --- | --- | --- |
| `{ live: false }` | `'next-message'` | `pending` |
| `{ live: true, confirmed: false, reason }` | `'unconfirmed'` | `unconfirmed`, `detail: reason` |
| `{ live: true, confirmed: true, … }`, `on` | `'applied'` | `failed` (`detail` = the CLI's error) when the name is an own key of `errors`, else `connected` when in `added`, else `unchanged` |
| `{ live: true, confirmed: true, … }`, `off` | `'applied'` | `removed` when in `removed`, else `unchanged` |

5. When `changed`, the frame goes out (below).
6. The answer carries `set`, `on`, `changed`, `live`, `servers` and a fresh `view`.

- `Object.hasOwn` on `errors`, not `in`: a server may be named `toString`.
- A stray's switch names no servers (`servers: []`).
- `live: 'next-message'` means the runtime answered `{ live: false }` (no live, non-closing process, or its sync threw): the chat's next process launches with the new list.
- Measured 2026-10-16 through the command: `on` → `connected` (the server a child of the chat's CLI), `off` → `removed`, no server process left.

## Frame — `session_toolsets_changed`

`{ kind: 'session_toolsets_changed', sessionId, at }` (`SessionToolsetsChangedEvent`; `sessionId` is the app's) goes to every open `/ws` socket over `connectedClients` after a switch that changed the list, never otherwise. Same fan-out as the notes frame: stringify once, skip a socket that is not open, catch per client. Its readers: the composer's hook (MAN-8490).

## Launch hook — `launchFor({ appSessionId, onNode })` → `ChatToolsetLaunch`

Registered through `useChatToolsets`; the Claude runtime asks it at every message, spawn and join (MAN-8495).

| chat | `env` | `servers` | `promptLine` |
| --- | --- | --- | --- |
| no app session id, or on a node | `{}` | `null` | `null` |
| Claude chat, box file unreadable | the two variables | `null` | `null`; one `[toolsets]` warning per changed message |
| row `NULL` | the two variables | `null` | `toolsetPointer(sets)` |
| row holds names | the two variables | merged `mcpServers` of the row's names the box still defines, set-name order; `{}` when none | `toolsetPointer(sets)` |

- The two variables: `CLOUDCLI_TOOLSET_URL` = `loopbackApiOrigin()` (`SERVER_PORT`, MAN-8487), `CLOUDCLI_TOOLSET_TOKEN` = `chatCredential(appSessionId)` (MAN-8992: the one credential every command of the chat sends, `notes` too). Every Claude chat on the box carries both, whatever the registry holds. why: a chat that started before the first set was registered can still switch it on.
- A node chat gets neither. why: a stdio command names this box's paths and could not reach this box's loopback.
- Set-name order is load-bearing: the runtime digests the map's JSON to learn whether a process already carries it.
- `servers: null` = nothing in play, no control request. `{}` = in play, no server (a row of `[]`, or only strays).
- Reaches a live process through the sync, not the prompt: a running process keeps the prompt it launched with, so a set registered after launch is switchable from the menu at once but is named to the model only by its next fresh process.

## Pointer sentence — `toolsetPointer(sets)`

`null` for no sets, so an empty registry changes no prompt. Otherwise this text, each set `name (description)` or `name` alone, joined by `; `:

> Tool sets: this box defines MCP tool sets that stay off until a conversation switches them on — <name> (<description>); <name> (<description>). Run `toolset on <name>` in Bash to switch one on for this conversation only: its tools arrive within the same turn as deferred tools, so load them with ToolSearch, and they stay on for this conversation's later messages. `toolset off <name>` switches it off, and `toolset list` shows which are on.

- Appended after `systemPrompt.append` (space-joined) by `applyToolsetLaunch` through `ChatToolsetLaunch.promptLine`; `surface-signal.ts` is untouched.
- The words after the list are load-bearing: a switched-on set's tools arrive as DEFERRED tools in the same turn, and the model must load them through ToolSearch before calling them.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.pointer.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.service.ts

## MAN-8501 — Tool sets command — `bin/toolset.mjs`, its stdout and exit codes, the link in `~/.local/bin`, and how `~/.local/bin` reaches a chat

`toolset list | on <set> | off <set>` — the model's one-call switch inside a chat. A COMMAND, not a tool on an MCP server of CloudCLI's own. why: a chat carries no MCP server of ours; one added would put a server and its tools into every chat's context and every `setMcpServers` call would have to re-pass it (INV-8471). A command costs nothing until called, a skill can call it, and it is the one form that can answer "unavailable" outside CloudCLI. Map: MAN-8497. Door and guard: MAN-8499.

## `bin/toolset.mjs`

Plain dependency-free Node ESM, run by bare `node` (`#!/usr/bin/env node`, mode 755), the footing `warden/` has; `package.json`'s `lint` names `bin/`. No state. It lives in this repo because its contract is this server's routes and environment.

Usage: `toolset list`, `toolset on <set>`, `toolset off <set>`. Anything else (another verb, no `<set>`, an extra argument) prints the usage on stderr and exits 2.

| variable | holds | set by |
| --- | --- | --- |
| `CLAUDE_SURFACE` | `cloudcli` inside a CloudCLI chat | the launch (`SURFACE_ENV`, `surface-signal.ts`) |
| `CLAUDE_CODE_SESSION_ID` | the conversation's Claude session id | the CLI |
| `CLOUDCLI_TOOLSET_URL` | the API's loopback origin | the launch hook (MAN-8500) |
| `CLOUDCLI_TOOLSET_TOKEN` | the chat's credential (MAN-8499) | the launch hook |

Request: `POST ${CLOUDCLI_TOOLSET_URL}/api/toolsets-cmd`, `Authorization: Bearer ${CLOUDCLI_TOOLSET_TOKEN}`, JSON `{ claudeSessionId, action, set }`, `AbortSignal.timeout(45_000)` (above the server's 30 s bound on a live sync; the composer's PUT carries the same 45 s, and the two move together).

## Exit codes — the contract a skill reads

| code | meaning | stream |
| --- | --- | --- |
| 0 | listed; or switched with every server `connected`, `removed`, `unchanged` or `pending` | stdout |
| 1 | switched, but a server `failed` or went `unconfirmed` | stdout (the lines name it) |
| 2 | refused: usage, or an error envelope (400, 404, 409, 500) | stderr: `toolset: <error.message>` |
| 3 | unavailable | stderr: `toolset: unavailable — <why>` |

- `TOOLSET_NOT_DEFINED` adds `Defined: a, b.` from `error.details.defined`, or `No set is defined on this box.`
- `pending` exits 0: the row moved and nothing failed.
- A broken box file makes `list` print `The tool-set file could not be read (<file>): <defect>` and exit 0 (the door answered); `on` and `off` get the 500 and exit 2.

### Unavailable (exit 3)

| case | `<why>` |
| --- | --- |
| `CLAUDE_SURFACE` is not `cloudcli` | `not running inside a CloudCLI chat` |
| the URL or the token is missing | `this chat's CLI was started without the tool-set credential; its next process carries it` |
| `CLAUDE_CODE_SESSION_ID` is missing | `CLAUDE_CODE_SESSION_ID is not set, so this conversation cannot be named` |
| no answer at the URL (refused, timeout after 45 s, a restricted port) | `CloudCLI does not answer at <url> (<reason>)` |
| HTTP 401 carrying CloudCLI's envelope (`success` is a boolean: `CHAT_CREDENTIAL_REFUSED`) | `CloudCLI does not know this session` |
| an answer that is not CloudCLI's JSON envelope — any status, a 401 without `success` included (`validateApiKey`'s `{"error":"Invalid API key"}` on a box with `API_KEY` set) | `<url> answered HTTP <status>, which is not a CloudCLI answer` |
| a defect in the script itself | `internal error: <message>` |

why the last: a skill's one remedy is to fall back, and it applies to every case that is not a refusal.

Round trip, measured 2026-10-16 (3 runs, an unknown session against the dev API): 0.05–0.06 s to the 401 `unavailable` line. A live `on` / `off` waits on the CLI's sync, up to 30 s.

Measured 2026-10-16: `env -u CLAUDE_SURFACE toolset list` → `toolset: unavailable — not running inside a CloudCLI chat`, exit 3; `toolset bogus` → the usage, exit 2.

## stdout

| call | lines |
| --- | --- |
| `list` | `Tool sets on this box (<n>):`, then one line per set `  <name>  on\|off  <description> [<server>, …]` (no description: just `[…]`), then one per stray `  <name>  on  no longer defined on this box`. None defined: `No tool sets are defined on this box (<registryFile>).` |
| `on` / `off` | `<set>: on for this conversation.` / `<set>: already on.` / `<set>: off for this conversation.` / `<set>: already off.`; with `live: 'next-message'` the line adds ` It applies from this conversation's next message.`; then one line per server `  <server>  <outcome>`, `failed: <detail>` and `unconfirmed: <detail>` carrying the one-line detail |

Outcomes are `ToolsetServerOutcome.outcome` (MAN-8487): `connected`, `failed`, `removed`, `unchanged`, `pending`, `unconfirmed`.

## The link — `ensureChatCommandLink('toolset', 'toolsets')`

`ensureChatCommandLink(commandName, logLabel)` is `server/modules/chat-commands/`' (MAN-8992), shared with the `notes` and `followups` commands: `createToolsetsModule()` calls it once (wrapped: a failure is one warning). It keeps `~/.local/bin/toolset` a symlink to `<application root>/bin/toolset.mjs`; `~/.local/bin` is made if missing.

| state found | does | journal |
| --- | --- | --- |
| script missing from the install | nothing | one `[toolsets]` warning |
| no `toolset` there | creates the symlink; losing the race to the other server of a handover (`EEXIST`) is the outcome wanted | `linked <link> -> <target>` |
| a regular file | leaves it alone (the operator's) | one warning |
| a symlink to the target | nothing | silent |
| a symlink elsewhere | re-points: `toolset.<pid>.tmp` beside it, renamed over, so a chat's Bash never meets a gap | `re-pointed <link> from <old> to <target>` |

Measured 2026-10-16: `~/.local/bin/toolset -> /home/lyphe/.claude/claudecodeui_lyphe/bin/toolset.mjs`.

## How `~/.local/bin` reaches a chat's PATH

| source | carries `~/.local/bin` |
| --- | --- |
| `deploy/systemd/cloudcli-server-dev.service` `Environment=PATH=` (`node_modules/.bin`, `~/.npm-global/bin`, `~/.local/share/pnpm`, the system dirs) | no |
| the running dev supervisor's and API's process environment (`/proc/<pid>/environ`) | no — the unit's string |
| `~/.claude/settings.json` `env.PATH` | yes (and `~/.claude/scripts`) |
| a chat's Bash tool PATH | yes — equal to the `settings.json` string, character for character (measured 2026-10-16) |

- The CLI applies the settings `env` at run time, so a CLI process's own `environ` cannot show it.
- Shell snapshots (`~/.claude/shell-snapshots/`, measured 2026-10-16): the 6 from 2026-10-05 on export a PATH equal to the `settings.json` string; the 5 oldest (mid-September) lack `~/.local/bin`. No snapshot lies between, so no boundary date is known.
- Why settings.json and not a login shell: the chat's Bash PATH carries `/usr/games`, which neither the unit nor a login shell carries, and its order (`~/.claude/scripts` first) is settings.json's; a login shell from the unit's PATH would put `~/.local/bin` first.
- This box needs no hand step because of that one settings line, which this repo does not control. A box without it gets `toolset: command not found` (127) in a chat while the pointer sentence still names the command.
- Adding `__HOME__/.local/bin` to the unit's `Environment=PATH=` is not applied: the operator's call (it needs `deploy/systemd/install.sh` and a daemon-reload).

governs: /home/lyphe/.claude/claudecodeui_lyphe/bin/toolset.mjs, /home/lyphe/.claude/claudecodeui_lyphe/deploy/systemd/cloudcli-server-dev.service, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/chat-commands/chat-commands.link.ts
