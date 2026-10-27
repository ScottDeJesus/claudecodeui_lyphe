<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-708 — providers

The provider contract: every wrapper exposes the same seven facets — runtime, models, auth, mcp, skills, sessions, sessionSynchronizer — over the shared interfaces, so a new provider is added without guessing which file moves.

Custom compaction (Claude chats): the stitched history, indexer and search are MAN-8054; the runtime seams are MAN-8055; MAN-8068 says which row holds which seam.

Tool sets (Claude chats): the runtime's seam — context hook, launch, `setMcpServers` sync, hold, live change — is MAN-8495, beside MAN-8055; the module behind it is MAN-8497.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/

## MAN-696 — Providers Module Guide
section: README/000

This file documents the current provider contract in `server/modules/providers`.
Keep it current whenever provider wiring, skill discovery, or session sync
behavior changes. The goal is that a human or AI agent can add a new provider
without guessing which files need to move.

## MAN-697 — Current Provider Shape
section: README/001 Current Provider Shape

Every provider wrapper exposes seven facets:

- `runtime`
- `models`
- `auth`
- `mcp`
- `skills`
- `sessions`
- `sessionSynchronizer`

These correspond to the shared interfaces in `server/shared/interfaces.ts`:

- `IProviderRuntime`
- `IProviderModels`
- `IProviderAuth`
- `IProviderMcp`
- `IProviderSkills`
- `IProviderSessions`
- `IProviderSessionSynchronizer`

The services that consume them are:

- `providerModelsService`
- `providerAuthService`
- `providerMcpService`
- `providerSkillsService`
- `sessionsService`
- `sessionSynchronizerService`

Live execution is consumed through `providerRuntimeService`, which resolves the
provider-owned runtime through the same `providerRegistry` as every other facet.

Current provider ids in this repo are:

- `claude`
- `codex`
- `cursor`
- `opencode`

Those ids are mirrored in backend unions and frontend provider constants. If
adding a new provider, update every place that hardcodes this list.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts

## MAN-698 — Current File Layout
section: README/002 Current File Layout

Each provider lives under its own folder in `server/modules/providers/list/`:

```text
server/modules/providers/list/<provider>/
  <provider>.provider.ts
  <provider>-runtime.provider.js
  <provider>-auth.provider.ts
  <provider>-models.provider.ts
  <provider>-mcp.provider.ts
  <provider>-skills.provider.ts
  <provider>-sessions.provider.ts
  <provider>-session-synchronizer.provider.ts
```

The existing provider folders are `claude`, `codex`, `cursor`, and `opencode`.

Each provider wrapper owns its SDK/CLI runtime alongside its auth, model, and
session facets. Runtime adapters receive registry-backed model and session
lookups from `providerRuntimeService` at execution time instead of importing
those services themselves. This keeps `providerRegistry` as the only provider
mapping without creating a circular dependency. Application-level consumers
import the service from `server/modules/providers/index.ts`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/index.ts

## MAN-699 — The exception: `list/claude/session-host/`
section: README/002 Current File Layout/003 The exception: `list/claude/session-host/`

`list/claude/` additionally holds a `session-host/` directory: the Claude runtime can spawn a
conversation's CLI into a tmux server through it instead of as a child of the API, which is what
lets a chat session outlive an API restart. There is one CLI per conversation, not per message:
the first message spawns it and every later one is pushed into its open input stream
(`claude-runtime.provider.js` §`queryClaudeSDK`; the queue and the idle closer are in
`server/shared/prompt-stream.ts` — `list/claude/chat-process.ts` re-exports them, so the runtime's
import is unchanged — the live-vs-launch setting split is in `list/claude/chat-process.ts`, and
the bounded reading of the installed CLI that split compares against is
`list/claude/installed-cli-version.ts`). `claude-runtime.provider.js` imports `armKeepaliveSpawn` and
`keepaliveReadopt` from it; `server/index.ts` calls `readoptKeepaliveSessions` once per boot
through the providers barrel — before `server.listen`, except on a handover boot, where it waits
for the retiring server to exit first. The mechanism, that exception, its gate, its fallback, and
why three of its files are plain ESM JavaScript, are in
[`server/modules/providers/list/claude/session-host/MANUAL.md (README)`](list/claude/session-host/MANUAL.md) §"Re-adoption, on boot".

**A chat whose project folder is gone.** The run loop in `claude-runtime.provider.js` checks the run's
settled `cwd` (`assertProjectFolderExists` over `diagnoseProjectFolder`, `list/claude/claude-project-folder.ts`; the projects list asks the same test to mark a gone project, MAN-8135) before
`armKeepaliveSpawn`, so before any host or process starts, and for every door that starts a CLI on this
machine: a send, an edited send, a compaction's restart from scratch, a respawn after a retirement. A
re-adoption (its CLI already runs) and a node's project (its folder lives on the node) are not checked.
The client gets ONE `error` frame naming the folder ("This project's folder no longer exists on this
machine: <path>. Restore the folder to continue this chat, or start a new chat in another project."), then the terminal
`complete`; the journal gets one `[Claude SDK] Not starting a process for session …` line and no stack.
why before the spawn: `tmux new-session -c <missing dir>` silently falls back to the home directory, so
the host starts, and its `spawn` then fails with an ENOENT whose message names the BINARY. Any other
CLI that cannot start reaches the client as Node's own message in the SDK's wording (`Failed to spawn
Claude Code process: spawn … ENOENT`, carried by the host's `exit` frame `error`), never a bare "exited
with code N"; where this check did not run (a node's project) the host names an unenterable `cwd` in
that message itself. The run loop's catch stays silent only for a process that has had a turn (or a re-adopted
one): a run that fails before it opens its first turn failed the message it was started for, and says so.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-project-folder.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/installed-cli-version.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/prompt-stream.ts

## MAN-700 — What Each Facet Does
section: README/004 What Each Facet Does

| Facet | Responsibility | Base / Service |
| --- | --- | --- |
| `runtime` | Run and abort live SDK/CLI sessions; optionally (`activity?`) report what a chat's process is doing, MAN-8055 | `IProviderRuntime` -> `providerRuntimeService` |
| `models` | Resolve supported and active models | `IProviderModels` -> `providerModelsService` |
| `auth` | Report install/auth state for the provider runtime | `IProviderAuth` -> `providerAuthService` |
| `mcp` | Read, list, write, and remove provider-native MCP config | `McpProvider` -> `providerMcpService` |
| `skills` | Discover provider-native skill markdown files | `SkillsProvider` -> `providerSkillsService` |
| `sessions` | Normalize live events and fetch session history | `IProviderSessions` -> `sessionsService` |
| `sessionSynchronizer` | Scan transcript artifacts and upsert session metadata | `IProviderSessionSynchronizer` -> `sessionSynchronizerService` |

`sessions` and `sessionSynchronizer` are separate concerns:

- `sessions` handles runtime event normalization and history fetches.
- `sessionSynchronizer` handles file-backed session indexing into `sessionsDb`.

`POST /api/providers/sessions` accepts an optional `simpleList` boolean; only
`true` tags the new row for the simple chat list. `GET /api/providers/sessions/recent`
accepts an optional `simpleList=true` query flag; with it the answer is one page of the
simple list's top-level rows — a folder counts once however many chats it holds — as
`layout` (the page's rows, each folder whole), `conversations` (every chat they draw, in
drawn order), `total` and `hasMore`, read by `simpleListService.readFeed` (MAN-7519).

Every row of that feed also carries the chat's `icon` (the chosen kebab-case
icon name, or `null` for the default) and its `unread` flag (its last run
finished while the chat was not on screen, and it has not been on screen since).

The one write the sidebar owns outside the chat itself, the icon, lives in
`session-user-state.routes.ts`, mounted from `provider.routes.ts`:

- `PUT /api/providers/sessions/:sessionId/icon` takes `{ icon: string | null }`
  and answers `{ sessionId, icon }`. A bad name is a 400 `INVALID_SESSION_ICON`.

The answer is followed by a `session_upserted` broadcast on the chat
websocket, so every open tab re-renders the row.

The simple list's folders and row moves live in `simple-list.routes.ts`, mounted
from `provider.routes.ts` beside them: `POST` (201), `PATCH`, `DELETE`
`/api/providers/simple-list/folders[/:folderId]` and `PUT
/api/providers/simple-list/position`, each followed by one `simple_list_changed`
frame; a bad body is a 400 `INVALID_SIMPLE_LIST_FOLDER_NAME`, `_FOLDER_ID`,
`_FOLDER` or `_POSITION`, a missing folder or item a 404
`SIMPLE_LIST_FOLDER_NOT_FOUND` / `SIMPLE_LIST_ITEM_NOT_FOUND`, and a refused place
a 409 `SIMPLE_LIST_POSITION_REFUSED`. Full table: MAN-7519.

## MAN-7405 — The Claude model catalog
section: README/004 What Each Facet Does/001 The Claude model catalog

The Claude picker's options, names, descriptions and effort levels come from the installed CLI's own catalog. There is no list typed in beside the aliases, so a CLI release that moves an alias moves the picker with it.

- **The read** (`list/claude/claude-engine-catalog.ts`, the one mechanism the model catalog and the command catalog share — MAN-8069; `claude-model-catalog.ts` is the model catalog's own spec: its question, its file, its picker). It starts an SDK `query` in streaming-input mode, with a prompt that yields nothing, and calls `supportedModels()`. The CLI answers with every model it can run, the alias each family answers to, its name for each, a description and the effort levels each accepts, and it does so without starting a turn. Measured 2026-09-28 on Claude Code 2.1.284: 633–901 ms, no API request, no transcript. The read runs on Haiku (`claude-haiku-4-5-20251001`), from `os.tmpdir()`, with the executable the chat runtime spawns, on the chosen account (`env: { ...userFacingEnv(), ...account.env }`, MAN-8848), and with `settingSources: []`. With no settings source named, the SDK loads every one, the read's cwd included, and each read ran the user's SessionStart and SessionEnd hooks plus any `.claude/settings.json` another user left in world-writable `/tmp`. The catalog is byte-identical with no source loaded.
- **When it runs.** Once per installed CLI version, keyed on `readInstalledCliVersion()`, the `cli-version` module's one cached reading; the catalog never runs a `--version` of its own. The answer is kept at `~/.cloudcli/claude-model-catalog.json` beside the version it was read on (`CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH` redirects it), so the dev server's handovers load it instead of respawning the CLI. A reading with no version ("not heard") is served whatever is kept under a real version and never spawns the CLI or replaces that record; only a CLI never named by path, with nothing keyed, is read once per process. `getSupportedModels` also sits on the send path (effort validation), so a caller waits at most 3 s for a read in flight and is otherwise served what is already known.
- **The open tab.** The picker asked for its list once, at mount, so a CLI update left an open tab on the old list until the page was reloaded (2026-10-08: the CLI served Haiku 5.5 and the catalog file named it within seconds, while a tab listed only Haiku 4.5). `src/modules/chat/hooks/useReloadModelsOnCliChange.ts` re-reads `GET /api/providers/<provider>/models` for every provider when `useCliVersion().installed` moves from one version string to another — the app's one reading of the installed CLI, so it adds no poll. The first reading (null to a string) is not a move, and a null is "not heard". The answer is laid over the previous catalog (`{ ...previous, ...next }`), so a provider whose answer is unusable (a JSON error body) keeps its last good list.
- **When the read fails.** The server serves the last good catalog on disk, whatever version it came from. With none, it serves `CLAUDE_FALLBACK_MODELS`, whose rows are named by family alone ("Opus", "Sonnet") and state no generation. One `[Claude models]` log line says which. A failed version is asked again after 10 minutes.
- **What is offered** (`list/claude/claude-model-options.ts`). One row per family, the newest: the family's alias entry where the catalog has one, else its newest pinned id (Fable: its value is the id it runs, with or without the `[1m]` context suffix). `default` and the older pinned versions are dropped. A new family appears on its own, in the catalog's order. Ultracode is added exactly where the catalog's effort levels include `xhigh`. Values stay the ones stored sessions hold (`opus[1m]`, `fable`, `sonnet[1m]`, `haiku`), so every stored selection still matches an option.
- **Names carry the version.** The CLI words a name one of two ways: with the version in it ("Haiku 4.5"), or by family alone ("Opus") with the version opening the description ("Opus 5.5 · Best for everyday, complex tasks"). A name with a version is shown as the CLI gives it. A name with none, whose description opens with that name, a version (`5`, `5.5`, `4.8`) and ` · `, is shown as `<name> <version>` ("Opus 5.5") over the description that follows the separator, so the menu does not say the version twice. That name is the option's `label` and the `LABELS_BY_MODEL_ID` entry, so the menu, the composer chip and chat captions all read it, and it stays right with each release. Everything else stays as the catalog says it: a description that opens with another name ("Default (recommended)" over "Sonnet 5.5 · …") or a notice ("Newer version available · …"), an entry with no description, and the no-catalog fallback. The composer's model rows show the name only; the description is in the API's answer.
- **Stored ids.** The definition carries `LABELS_BY_MODEL_ID`, the picker's name for every concrete id the catalog lists. `mergeProviderModels` passes it through, and `src/modules/chat/utils/modelLabels.ts` reads it before its own generation-parsing fallback, which names only ids the catalog does not list. So `claude-sonnet-5-5` reads "Sonnet 5.5"; `claude-sonnet-5`, which the 2.1.310 catalog does not list, reads "Sonnet 5" from the fallback (the family plus the id's own version).
- **Proof.** `.verify/probe-claude-catalog-picker.mjs [run-name]` prints the API's answer (each option's label and description, `LABELS_BY_MODEL_ID`) and, from the DOM, the chip and every row of the open menu, desktop and phone, dark and light, with the console errors and failed responses; it writes the four screenshots and a JSON report to `.verify/out/<run-name>-*`. `.verify/probe-opus-55-selector.mjs` covers stored-turn captions and the resumed-session chip.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-options.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-models.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useReloadModelsOnCliChange.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/modelLabels.ts

## MAN-701 — How To Add A Provider
section: README/005 How To Add A Provider

1. Add the provider id everywhere it is part of the contract.

- Update `server/shared/types.ts` `LLMProvider`.
- Update `src/shared/types.ts` `LLMProvider` if the frontend should know about it.
- Update `server/modules/providers/provider.routes.ts`.
- Update `server/modules/agent/agent.routes.ts` if the provider is launchable from the agent runtime.
- Update `server/index.ts` if the provider needs runtime boot or shutdown wiring.
- Update the `PROVIDER_ORDER` list in `public/api-docs.html` if the provider should appear in the public API docs.
- Update `src/modules/chat/hooks/useChatProviderState.ts` and
  `src/modules/chat/transcript/ProviderSelectionEmptyState.tsx` if
  the provider should be selectable in chat. The new-chat model picker hides a
  provider whose `/:provider/auth/status` answers `authenticated: false`, so a
  selectable provider needs a working auth status.
- Update `src/modules/provider-auth/ProviderLoginModal.tsx` if the
  provider has a login/setup flow.

2. Create the wrapper class.

- Add `server/modules/providers/list/<provider>/<provider>.provider.ts`.
- Add `server/modules/providers/list/<provider>/<provider>-runtime.provider.js`
  when the provider supports live SDK/CLI execution.
- Extend `AbstractProvider`.
- Expose readonly `auth`, `mcp`, `skills`, `sessions`, and `sessionSynchronizer`.
- Call `super('<provider>')`.

3. Implement auth.

- Return a full `ProviderAuthStatus`.
- Treat normal `not installed` / `not authenticated` states as data, not exceptions.
- Keep provider-specific credential discovery inside the auth provider.
- If the provider has no auth step, return a stable unauthenticated or not-installed status instead of omitting the facet.

4. Implement MCP.

- Extend `McpProvider`.
- Pass the supported scopes and transports to `super(...)`.
- Implement the four required methods:
  - `readScopedServers(...)`
  - `writeScopedServers(...)`
  - `buildServerConfig(...)`
  - `normalizeServerConfig(...)`
- Use the shared validation and normalization behavior from `McpProvider`.
- Keep the provider-specific config format local to the provider implementation.

Current MCP formats in this repo are:

| Provider | User / Project Storage | Supported Scopes | Supported Transports |
| --- | --- | --- | --- |
| Claude | `.mcp.json` in user / local / project locations | `user`, `local`, `project` | `stdio`, `http`, `sse` |
| Codex | `.codex/config.toml` | `user`, `project` | `stdio`, `http` |
| Cursor | `.cursor/mcp.json` | `user`, `project` | `stdio`, `http` |
| OpenCode | `~/.config/opencode/opencode.json` or `<workspace>/opencode.json` (`.jsonc` is read when present) | `user`, `project` | `stdio`, `http` |

5. Implement skills.

- Extend `SkillsProvider`.
- Implement `getSkillSources(workspacePath)`.
- Return the actual discovery roots for the provider.
- Skills are discovered from `SKILL.md` files.
- `readProviderSkillMarkdownDefinition(...)` reads front matter `name` and `description`.
- If `name` is missing, the parent directory name is used as a fallback.
- Use `recursive: true` only when the provider stores skills in nested trees.
- Keep the emitted `command` string aligned with the provider's real skill syntax.

Current skill discovery roots are:

| Provider | User Roots | Project / Repo Roots | Prefix | Notes |
| --- | --- | --- | --- | --- |
| Claude | `~/.claude/skills` | `<workspace>/.claude/skills` | `/` | Also discovers Claude plugin skills from enabled plugin installs. Command skills live under `commands/`; markdown skills live under `skills/` and are scanned recursively. |
| Codex | `~/.agents/skills`, `~/.codex/skills/.system`, `/etc/codex/skills` | `<workspace>/.agents/skills`, `path.dirname(workspacePath)/.agents/skills`, topmost git root `.agents/skills` | `$` | Overlapping roots are deduplicated before scanning. |
| Cursor | `~/.cursor/skills` | `<workspace>/.cursor/skills`, `<workspace>/.agents/skills` | `/` | Uses slash-style commands. |
| OpenCode | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | Cwd-to-topmost-git-root `.opencode/skills`, `.claude/skills`, and `.agents/skills` | `/` | Reuses OpenCode, Claude, and Agents skill locations. Overlapping roots are deduplicated before scanning. |

Command forms currently used by the providers are:

- Claude user/project skills: `/skill-name`
- Claude plugin skills: `/plugin-name:skill-name`
- Codex skills: `$skill-name`
- Cursor skills: `/skill-name`
- OpenCode skills: `/skill-name`

6. Implement sessions.

- Implement `normalizeMessage(raw, sessionId)` and `fetchHistory(sessionId, options)`.
- Use `createNormalizedMessage(...)` and `generateMessageId(...)` for emitted messages.
- Keep normalized message ids unique. If one raw event produces multiple text
  parts, append a discriminator so ids do not collide.
- Keep pagination consistent:
  - `limit: null` means unbounded/full history.
  - `limit: 0` means an empty page.
  - always return `total`, `hasMore`, `offset`, and `limit` when paginating.
- Sanitize any filesystem-derived ids before using them in file or database paths.
- Do not assume a provider's history format matches another provider's format.

7. Implement session synchronization.

- Implement `synchronize(since?: Date)` to scan provider artifacts and upsert
  sessions into `sessionsDb`.
- Implement `synchronizeFile(filePath)` for single-file watcher updates.
- Use the existing helpers when they fit:
  - `buildLookupMap(...)`
  - `extractFirstValidJsonlData(...)`
  - `findFilesRecursivelyCreatedAfter(...)`
  - `normalizeSessionName(...)`
  - `readFileTimestamps(...)`
  - `readLastTranscriptTimestamp(...)` — prefer this for `updated_at`; a
    transcript's mtime moves on idle bookkeeping writes, not just messages
- Make the sync resilient to partial, malformed, or missing provider files.
- Returning `null` from `synchronizeFile` (or refusing a path before the scan reads it) is
  also how a provider excludes a session it does not own from ever getting a row — see
  Claude's board-launched-Metis refusal in the scan-roots table above. Refuse on the
  extractor's own returned `cwd`, not on a guessed path shape, and refuse it BEFORE the
  file is read to EOF so an excluded transcript costs no more than any other skip.
- The orchestration service runs all provider synchronizers and only advances
  `scan_state.last_scanned_at` when every provider succeeds.

Current session sync roots are:

| Provider | Scan Roots | Metadata Helpers / Notes |
| --- | --- | --- |
| Claude | `~/.claude/projects/**/*.jsonl` | Uses `~/.claude/history.jsonl` for name lookup and the trailing `ai-title`, `last-prompt`, or `custom-title` entries for title recovery. Refuses to enrol (never mints a `sessions`/`projects` row for) a transcript whose `cwd` resolves under `KANBAN_METIS_SESSION_ROOT` (`~/.claude/kanban-metis/<boardId>/`) — a board-launched Metis session the Kanban board's own driver owns and reads by session id instead; see `isUnder`/`KANBAN_METIS_SESSION_ROOT` in `claude-session-synchronizer.provider.ts`. |
| Codex | `~/.codex/sessions/**/*.jsonl` | Uses `~/.codex/session_index.jsonl` for title lookup and the last `task_complete` message for a fallback title. |
| Cursor | `~/.cursor/projects/**/*.jsonl` | Uses sibling `worker.log` to recover `workspacePath`, then derives the session title from the first user prompt. |
| OpenCode | `~/.local/share/opencode/opencode.db` | Reads active sessions/messages/parts from OpenCode's shared SQLite database and stores `jsonl_path` as `null` so deleting one app session cannot remove the shared DB. |

8. Register the provider.

- Add the new provider class to the table `allProviders()` builds in `server/modules/providers/provider.registry.ts`.
- Update `server/modules/providers/provider.routes.ts` provider parsing.
- If the provider introduces a new service or lifecycle hook, export it from the module entrypoint that consumes providers.

9. Wire runtime and UI surfaces outside the providers module when needed.

If the provider can run live chat sessions, update the runtime entrypoints too:

- `server/modules/providers/list/<provider>/<provider>-runtime.provider.js`
- `server/modules/providers/list/<provider>/<provider>.provider.ts`
- `server/modules/agent/agent.routes.ts`
- `server/index.ts`

If the provider is visible in the UI, update:

- provider model fallback files under `server/modules/providers/list/<provider>/`
- `src/modules/chat/hooks/useChatProviderState.ts`
- `src/modules/chat/transcript/ProviderSelectionEmptyState.tsx`
- `src/modules/provider-auth/ProviderLoginModal.tsx`
- `src/shared/constants.ts` (`MCP_PROVIDER_NAMES`)

governs: /home/lyphe/.claude/claudecodeui_lyphe/public/api-docs.html, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent/agent.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/provider.registry.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/provider.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatProviderState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ProviderSelectionEmptyState.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/provider-auth/ProviderLoginModal.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/history.jsonl

## MAN-702 — Minimal Wrapper Template
section: README/006 Minimal Wrapper Template

```ts
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { <Provider>ProviderAuth } from './<provider>-auth.provider.js';
import { <Provider>ProviderModels } from './<provider>-models.provider.js';
import { <Provider>McpProvider } from './<provider>-mcp.provider.js';
import { <provider>Runtime } from './<provider>-runtime.provider.js';
import { <Provider>SkillsProvider } from './<provider>-skills.provider.js';
import { <Provider>SessionsProvider } from './<provider>-sessions.provider.js';
import { <Provider>SessionSynchronizer } from './<provider>-session-synchronizer.provider.js';
import type {
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSessions,
  IProviderSkills,
} from '@/shared/interfaces.js';

export class <Provider>Provider extends AbstractProvider {
  readonly runtime: IProviderRuntime = <provider>Runtime;
  readonly models: IProviderModels = new <Provider>ProviderModels();
  readonly auth: IProviderAuth = new <Provider>ProviderAuth();
  readonly mcp: IProviderMcp = new <Provider>McpProvider();
  readonly skills: IProviderSkills = new <Provider>SkillsProvider();
  readonly sessions: IProviderSessions = new <Provider>SessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer =
    new <Provider>SessionSynchronizer();

  constructor() {
    super('<provider>');
  }
}
```

## MAN-703 — Minimal Skills Template
section: README/007 Minimal Skills Template

```ts
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

export class <Provider>SkillsProvider extends SkillsProvider {
  constructor() {
    super('<provider>');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.<provider>', 'skills'),
        commandPrefix: '/',
      },
    ];
  }
}
```

## MAN-704 — Minimal Session Sync Template
section: README/008 Minimal Session Sync Template

```ts
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

export class <Provider>SessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(since?: Date): Promise<number> {
    return 0;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    return null;
  }
}
```

## MAN-705 — AI Prompt Template
section: README/009 AI Prompt Template

Use this prompt when asking an AI agent to add a provider:

```text
Add a new provider "<provider>" using the current provider module architecture.

Requirements:
1) Create:
    - server/modules/providers/list/<provider>/<provider>.provider.ts
    - server/modules/providers/list/<provider>/<provider>-runtime.provider.js
   - server/modules/providers/list/<provider>/<provider>-auth.provider.ts
   - server/modules/providers/list/<provider>/<provider>-models.provider.ts
   - server/modules/providers/list/<provider>/<provider>-mcp.provider.ts
   - server/modules/providers/list/<provider>/<provider>-skills.provider.ts
   - server/modules/providers/list/<provider>/<provider>-sessions.provider.ts
   - server/modules/providers/list/<provider>/<provider>-session-synchronizer.provider.ts
2) Register in:
    - server/modules/providers/provider.registry.ts
    - server/modules/providers/provider.routes.ts
   - server/shared/types.ts LLMProvider
   - src/types/app.ts LLMProvider
3) Mirror the nearest existing provider implementation for file naming, style,
   and error handling.
4) Implement skills support with SkillsProvider and the current skill roots.
5) Implement session synchronization if the provider stores transcript files.
6) Ensure sessions use unique ids, safe path handling, and correct pagination.
7) Keep `sessions` and `sessionSynchronizer` separate.
8) Run:
   - npx eslint <touched files>
   - npx tsc --noEmit -p server/tsconfig.json
```

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/provider.registry.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/provider.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/tsconfig.json

## MAN-706 — Validation
section: README/010 Validation

After adding or changing a provider, run the relevant checks:

```bash
npx eslint server/modules/providers/**/*.ts server/shared/types.ts server/shared/interfaces.ts
npx tsc --noEmit -p server/tsconfig.json
```

Useful tests in this repo:

- `server/modules/providers/tests/mcp.test.ts`
- `server/modules/providers/tests/skills.test.ts`
- `server/modules/providers/tests/opencode-sessions.test.ts`

If you touch sessions or session synchronization, add or update focused tests
alongside the implementation.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/tsconfig.json

## MAN-707 — Common Mistakes
section: README/011 Common Mistakes

- Adding provider files but forgetting `provider.registry.ts` or
  `provider.routes.ts`.
- Adding a live runtime without exposing it from the provider wrapper.
- Updating backend provider ids but not `src/types/app.ts` or the frontend
  provider constants.
- Omitting `runtime`, `skills`, or `sessionSynchronizer` from the wrapper.
- Returning duplicate normalized message ids for split content.
- Treating `limit === 0` as unbounded history.
- Building file paths from raw session ids without validation.
- Hardcoding a skill root without checking the provider's actual discovery rules.
- Forgetting that Claude plugin skills are discovered differently from normal
  user/project skill folders.
- Assuming one provider's MCP config file format works for the others.
- Reading `providerRegistry` — or building a service on it (`createProviderModelsService()` resolves the registry) — at module-evaluation time. The registry builds its four providers on the FIRST call that needs one (`allProviders()`); a provider's own files import services that import the registry, so a provider built at evaluation lets import order decide whether a module loads (`Cannot access 'providerRegistry' before initialization`). A factory reads the registry inside the function it returns, never in its own body.

## MAN-7519 — The simple list's feed, four routes and simple_list_changed frame

The simple list's read and its four writes on the server. Storage and ladder: MAN-7511; repository: MAN-7515; client contract: MAN-7514.

| File | Owns |
| --- | --- |
| `services/simple-list.service.ts` | `simpleListService`: `readFeed`, `createFolder`, `updateFolder`, `deleteFolder`, `moveItem`; file-local `broadcastSimpleListChanged` |
| `simple-list.routes.ts` | `simpleListRoutes` (Router): transport shape only — bodies, lengths, ids |
| `provider.routes.ts` | `router.use(simpleListRoutes)` after `router.use(sessionUserStateRoutes)`; the feed's one branch |

## Feed — `GET /api/providers/sessions/recent?simpleList=true`
- Branch in `provider.routes.ts`: `simpleListOnly ? simpleListService.readFeed(limit, offset) : sessionsService.listRecentSessions(limit, offset)`. Without the flag the answer is the recents query, unchanged.
- Answer: `{ conversations, layout, total, hasMore }`.
- `layout` = top-level rows sliced `[offset, offset + limit)`: `{ kind: 'chat'; sessionId }` or `{ kind: 'folder'; folderId; name; collapsed; sessionIds }`. Types on the client: MAN-7514.
- `total` = count of top-level rows; `hasMore` = `offset + layout.length < total`. A client paging `offset = items.length` lines up with the server.
- `conversations` = every chat of `layout`, in drawn order; a folder's chats sit in the folder's place. Row shape is `sessionsService.listRecentSessions`'s own (`RecentChat`); the file declares none.

### `readFeed` walk
1. `sessionsService.listRecentSessions(EVERY_TAGGED_CHAT, 0, { simpleListOnly: true })` — `EVERY_TAGGED_CHAT = -1`, SQLite reads a negative `LIMIT` as no bound. `why:` the walk must see every chat to place it.
2. One layout folder per `simpleListDb.listFolders()` row.
3. Walk `simpleListDb.readLadder()` in order:
   - folder entry → top level, only if its row is in `listFolders()`;
   - chat entry not among step 1's chats (archived, archived project, scratch folder) → skipped;
   - chat whose `folderId` names a live folder → that folder's `sessionIds`;
   - any other chat (folder null or row gone) → top level.
- 2026-09-30, copy of the live DB: with no folder, `conversations`, `total`, `hasMore` equal `listRecentSessions(limit, offset, { simpleListOnly: true })` for six page shapes.

## Routes (`simple-list.routes.ts`, all under `/api/providers`)
Success: `createApiSuccessResponse(data)`.

| Route | Body | Answers |
| --- | --- | --- |
| `POST /simple-list/folders` | `{ name }` | 201 `{ folderId, name, collapsed }`; id minted by `randomUUID()` in the service |
| `PATCH /simple-list/folders/:folderId` | `{ name?, collapsed? }`, at least one | 200 `{ folderId, name, collapsed }` |
| `DELETE /simple-list/folders/:folderId` | — | 200 `{ folderId, released }`; `released` = chats set loose |
| `PUT /simple-list/position` | `{ item, folderId, after }`, all three keys present | 200 `{ item, folderId, after }` |

- `item` / `after` = `{ kind: 'chat' | 'folder'; id }`; `folderId` and `after` may be `null`, not absent. `simpleList.move` sends exactly this (MAN-7514).
- Name: trimmed, 1–80 characters (`FOLDER_NAME_MAX_LENGTH`). Folder id: `/^[A-Za-z0-9-]{1,64}$/`. Chat id: `parseSessionId`; a malformed one in a position body answers `INVALID_SIMPLE_LIST_POSITION`, never the id parser's code.

## Refusals
| Code | Status | When |
| --- | --- | --- |
| `INVALID_SIMPLE_LIST_FOLDER_NAME` | 400 | `name` not a string of 1–80 characters after trim |
| `INVALID_SIMPLE_LIST_FOLDER_ID` | 400 | `:folderId` fails the pattern |
| `INVALID_SIMPLE_LIST_FOLDER` | 400 | `collapsed` not a boolean; PATCH with neither `name` nor `collapsed` |
| `INVALID_SIMPLE_LIST_POSITION` | 400 | `item`, `folderId` or `after` unusable or absent |
| `SIMPLE_LIST_FOLDER_NOT_FOUND` | 404 | PATCH/DELETE of a missing folder; a move into a missing one |
| `SIMPLE_LIST_ITEM_NOT_FOUND` | 404 | repository verdict `unknown-item` |
| `SIMPLE_LIST_POSITION_REFUSED` | 409 | repository verdict `refused` |

- Verdicts pass through as the repository checks them (MAN-7515 §`moveItem` checks): a folder moved into a folder answers 409 `SIMPLE_LIST_POSITION_REFUSED`, not `SIMPLE_LIST_FOLDER_NOT_FOUND`, because check 2 fires before check 3.
- An empty PATCH is refused. `why:` a write that changes nothing would still broadcast a frame.

## `simple_list_changed` — the frame
- `SimpleListChangedEvent` = `{ kind: 'simple_list_changed'; at: number }`, `at` epoch ms; declared in `server/shared/types.ts` beside `KanbanBoardEvent`, and a member of `GatewayEventKind`.
- No `seq`, no `sessionId`: it never becomes a transcript row. It names no folder and no chat: a client that hears it re-reads the feed.
- Built only by `broadcastSimpleListChanged` in `simple-list.service.ts`, once per write, after the repository call succeeded. A refused write (400, 404, 409) and the feed read send none.
- Goes to every client in `connectedClients` whose `readyState` is `WS_OPEN_STATE`; `JSON.stringify` once, a catch per client. It copies `broadcastKanbanEvent` (MAN-588).
- 2026-09-30, live: create, move into a folder, delete = 3 writes, exactly 1 frame each.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/provider.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/simple-list.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/simple-list.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## MAN-8054 — Compacted history — the stitch, the divider, the resume placeholder, the opening context, search and the indexer

**RULE: a chat with compaction records reads as ONE conversation — each compacted transcript, a divider, then the live transcript; a chat with none reads exactly the live transcript.**

Records come from `sessionCompactionsDb.listCompactions` (MAN-8046). Claude only.

## History — `stitchCompactedHistory`

`stitchCompactedHistory({ sessionId, liveTranscriptPath, liveProviderSessionId, readTranscriptRows })` in `claude-compacted-history.ts` returns `{ rows, liveRows, supersededRows, openingContextTokens }`. The file is a leaf: `claude-sessions.provider.ts` hands its one-transcript reader in as `readTranscriptRows`; nothing imports back.

| Part | Rule |
| --- | --- |
| Order | per record, oldest first: that transcript's rows, then one divider row; then the live rows |
| Read of a compacted transcript | `readTranscriptRows(record.oldJsonlPath, record.oldProviderSessionId)`: its own id, so its subagents are found under its own folder |
| Reader | `getSessionMessages(sessionId, transcriptPath, providerSessionId, limit, offset)` reads ONE transcript; a missing file is no rows, never an error; `readTranscriptRows` keeps only rows carrying `providerSessionId` and drops every record that wears a turn's shape without being one (`isClaudeTurnLookalike`, `server/shared/claude-transcript-rows.ts`: a `message.role` of `user`/`assistant` on a record not typed `user`/`assistant` — the CLI's `api-request-blob`, which stores the request body it is about to send, with no `uuid` and no `timestamp`). Read as a turn it is a second copy of a message the file already holds, with an id and a time minted at read time: the old message that reappeared at the foot of a chat. The subagent reader, transcript search and the universe's transcript tap read lines of their own and make the same refusal |
| Divider | raw row `type: 'cloudcli-compaction'`, `uuid: compaction-<old provider id>`, `timestamp` = `createdAt`, or the millisecond before the following seed's stamp when the seed is stamped no later (the record keeps the swap to the second, the seed to the millisecond, and the store's timestamp sort would otherwise put the summary above its divider; the marker's own `at` stays `createdAt`); `normalizeMessage` → `isCompactionRow` / `normalizeCompactionRow` → one `kind: 'compaction'` message whose `compaction` is a `ChatCompactionMarker` (`server/shared/types.ts`; the client mirrors it in `src/shared/types.ts`, keep identical) |
| Seed | the first user prompt row (`isUserPromptRow`) of every transcript after the first becomes `isCompactSummary: true`, `uuid: compaction-summary-<previous record's old provider id>`, first text block only; drawn under `showCompactSummary`. The id equals the live frames' id, so the refresh after a compaction replaces the live row |
| Resume placeholder | when the session resumes from disk, the CLI writes one `<synthetic>` assistant row whose only text is "No response requested." before the operator's message. `normalizeMessage` turns it into no message (`isResumePlaceholderRow`, `server/shared/claude-transcript-rows.ts`), in a compacted chat and in every other: it is the CLI keeping the turns alternating, not the assistant answering, and drawn it reads as a reply nothing earned. Search skips it too, so it is never a chat's last assistant text. A rate-limit refusal, an expired login or an API error is `<synthetic>` as well but says something the reader needs (`isApiErrorMessage: true`), and is drawn. The row stays in the transcript: it is the resume point an edit's anchor rule uses (`readTranscriptRows` keeps it). The resumed turn's live frames carry no such row (measured) |
| Anchors | `withoutAnchors` strips `transcriptAnchorId` from every row of a compacted transcript (`supersededRows`): no edit, no fork there |
| `tokenUsage` | `withOpeningContext(summarizeClaudeTokenUsage(liveRows), openingContextTokens)` (`withOpeningContext` lives in `provider-token-usage.service.ts`): the context the chat holds now. The composer has a second reader, `GET /sessions/:id/token-usage` (`getSessionTokenUsage`, called on every session select), and it answers the same number: when its transcript reads `used` 0 it applies `withOpeningContext` with the latest record's `post_tokens` (`latestCompaction`). Whichever lands last, the counter reads `post_tokens`. `openingContextTokens` is the latest record's `post_tokens` (the CLI's own count at the compaction's end) while the live transcript holds no assistant usage (`summarizeClaudeTokenUsage` reads `used` 0: the seed append has no reply, and the placeholder is a zero-usage `<synthetic>` row), else null; it then stands as `used`, `inputTokens` and `breakdown.input`. Null in a chat with no compaction, and when the record has no `post_tokens` yet |

## Cache and launches

| What | Rule |
| --- | --- |
| `readHistoryCompanionStamp(sessionId, transcriptPath, providerSessionId)` (`session-agents.service.ts`) | subagent stamp + `readCompactionStamp(sessionId)` (`compactions:<old id>@<postTokens>,…`); `sessions.service.ts` and `session-subagent-runs.service.ts` BOTH pass it, since two stamps for one entry evict each other |
| Why the record rides the stamp | the swap writes its record before the new transcript exists, and `postTokens` is filled after the seed's last row; path, mtime and size alone cache a marker without its "after" |
| `collectStampedSoulLaunches(providerSessionIds)` | takes an array: the live id and every record's `oldProviderSessionId`; one pass over the launch directory |
| `subagentTranscriptService.readByToolUse` | looks up the live transcript, then each record's `oldJsonlPath` newest first, each under its own provider id |

## Indexer and search

| What | Rule |
| --- | --- |
| `ClaudeSessionSynchronizer.processSessionFile` | returns null when `sessionsDb.isProviderSessionSuperseded(id, provider)`: a compacted or abandoned-seed transcript is not a sidebar chat (the Codex rule) |
| `listCompactedTranscriptRows(chatRows)` (`session-conversations-compacted.ts`) | one extra search entry per record whose chat is in `chatRows`: the chat's row with `provider_session_id` = old id and `jsonl_path` = old path; appended after the live rows; same hidden-root and archived-project filters as every row. An archived chat adds none |
| `getSessionKey` | `provider:session_id:provider_session_id`; without the third part a hit in the old transcript makes the live row scan its live file |
| `addSessionResult(sessionResults, result)` | ONE result per chat and provider (the sidebar keys results by chat id); appends hits whose `messageUuid`, `timestamp` and `snippet` together are not already held |
| `extractClaudeSearchableMessage` (`session-conversations-search.service.ts`) | null for a lookalike and for the resume placeholder; a user text hit shows the typed words: `stripTransparentWrapperPrefix` (`server/shared/local-commands.ts`) takes a leading `/plain ` off, as the chat does for a send with an image |

## Traps

| Trap | Why / do |
| --- | --- |
| `stitchCompactedHistory` reads no live rows when `liveProviderSessionId` is a record's `oldProviderSessionId` | a caller that took the id before the swap landed pairs it with the fresh path, still the old file in the gap; every compacted row would draw twice. Keep the rule if the stitch is restructured |
| `GET /token-usage` answers the old transcript's last turn between a swap and the seed's first row | `getSessionTokenUsage` reads `session.jsonl_path` with no provider-id filter, and until the new file exists that path is the old transcript; only `fetchHistory`'s `tokenUsage` is cured of that gap. Once the seed's file exists both readers answer `post_tokens` until the first reply |
| The history cache charges its byte budget by the live file's size | a stitched entry's compacted rows go uncharged |
| `listCompactions` runs on every stamp read | no `session_id` index (MAN-8046) |
| A whitespace-only seed block is not guarded | the summarizer's block 0 always opens with its preamble; only a hand-edited transcript reaches it |

## Proof — the chat shows each message once

| Command | Does |
| --- | --- |
| `node .verify/trailing-old-message-proof.mjs [--app URL] [--api URL] [--label x]` | defaults `--app http://127.0.0.1:5183`, `--api http://127.0.0.1:3011`. In a scratch chat under `/tmp` on Haiku: a long ask, Stop once the CLI has written it, then a one-word ask; fails unless the transcript holds the interrupt, the stand-in reply and an `api-request-blob` record carrying each prompt. Held against the transcript's rows at the second send, after its reply, after a reload, and in desktop-dark, phone-dark and phone-light: no "No response requested." bubble, each prompt drawn once and in order, each stamp the row's own; over the sessions API one user row per prompt, every id a transcript uuid. Console errors fail it. 2 Haiku turns. Exit 0 held, 1 a check failed, 2 the run could not finish. Shots `.verify/shots/trailing-old-message-<label>-<desktop\|phone>-<light\|dark>-<state>.png` |
| `bash .verify/trailing-old-message-before.sh` | the same proof against a copy of the tree with the changed server files from HEAD (probe server :7897, scratch Vite :5297); exit 0 only when the proof FAILED. Never put the old reader back on the live :3011 for it |

2026-10-16: pre-change server 41 of 49 checks failed; fixed tree 49 of 49 on :5183 and on :5184.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compacted-history.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-sessions.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-session-synchronizer.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-token-usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-conversations-compacted.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-conversations-search.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-soul-launches.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/subagent-transcript.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-transcript-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/local-commands.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/trailing-message-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/trailing-old-message-before.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/trailing-old-message-proof.mjs

## MAN-8055 — The Claude runtime's seams to custom compaction — the seed append (`transcriptAppend`), the taken-over launch, the turn-end report

The Claude runtime reaches a custom compaction (`server/modules/compaction/`) only through its context, `ProviderRuntimeContext.compaction` (`ChatCompactionHooks`: `takesOver`, `turnEnded`, `turnRestored`, `activityChanged`), and imports nothing from that module. `providerRuntimeService.useChatCompaction(hooks)` stores the hooks every context then carries — one delegating object that reads the registered hooks at CALL time, because a process keeps the context of the message that spawned it. The default answers `takesOver` false and does nothing for the other three, so with nothing registered the runtime behaves as it did before the seams. `providerRuntimeService.activity(provider, appSessionId)` asks the provider's runtime (`IProviderRuntime.activity?`) and answers `{ live: false, busy: false, why: null }` when it has none.

Sibling seam, same context-hook shape: the chat's tool sets, `list/claude/claude-toolset-seams.ts` (MAN-8495). Tool sets are a live setting beside the compaction flip below — `planLiveChanges` `changes.toolsets`, applied by `setMcpServers`, never a respawn; MAN-8502 lists every live setting and every respawn reason of `chat-process.ts`.

`claude-runtime.provider.js` takes call-in lines only; every body is `list/claude/claude-compaction-seams.ts`:

- **Taken over at launch.** `resolveSdkOptions` asks `takesOver({ appSessionId })` (a run with no app session id never asks; a chat placed on a Cerberus node is asked and answered exactly as a local one) and `applyCompactionSettings` merges `CLI_COMPACTION_SETTINGS` (`{ idleCompaction: false }`, the one constant) into `sdkOptions.settings` beside ultracode's. `autoCompactEnabled` is never touched: the CLI's threshold compaction, its compaction at overflow and its precompute stay as the net. With the answer false nothing is merged and the launch is byte-identical.
- **A flip is live.** `LaunchProfile.compactionTakenOver` is read off the launch settings (a profile recorded before the field reads as off); `planLiveChanges` makes a change of it a live `compaction` change, never a respawn, applied once for a re-adopted profile; `applyChanges` hands `applyFlagSettings` the constant, or — to give the chat back — `null` for a process that was only flipped on live (it removes the live value, so the operator's own setting shows again) and the CLI's DEFAULT (`idleCompaction: true`) for a process LAUNCHED taken over. Not `null` for that one: measured on 2.1.293 with no model call, the launch holds the key in the flag layer's base and a live `null` only removes what a live apply added, so `effective.idleCompaction` keeps reading `false` under it. The default also overrides an `idleCompaction` the operator set in a settings file; a launch argument cannot be taken back live, and the only other way is a respawn. Whether a process was launched on is fixed at launch (`launchedTakenOver`), and a re-adopted host with no profile on record counts as launched on.
- **The turn's end is reported.** At the end of every `result` branch — after the turn's own `complete` — `turnEnded(report)` gets the turn's last MAIN-THREAD assistant request (`contextTokens`), the window of the model that request ran on (`contextWindow`, from the result's `modelUsage`), the turn's send options without anything one turn carries (`PER_TURN_SEND_OPTIONS`: `transcriptAppend`, `compactionSeed`, `resumeFromScratch`, the attachments among them), whether a client turn was waiting (`answered`), `aborted`, `seed` and the process's `activity`. `activityChanged` follows every `result`, `task_started`, `task_notification` and `background_tasks_changed`, and once when the process ends with `live: false` (not when a newer process already holds the session key, nor while a replacement is spawning for the chat). `get activity` on the process handle is `busy` for a turn pending or in flight, a follow-up turn about to start, or background work, with `why` naming which. A non-ambient `task_notification` outside a running turn holds the process busy ("a turn is about to start") until the follow-up's `init` or any `result`, or for 2 s — the CLI starts that turn ~100 ms later, and an idle report in the gap would let a compaction swap the process under it. A re-adopted run's report has no model options of its own, so its `sendOptions` are filled from the host's recorded launch profile (bare only for a host with none). Every hook call is wrapped: a hook that throws is logged and the turn goes on, and `takesOver`, which a send awaits, answers "not taken over" after 10 s.
- **A turn the server did not see end is reported too.** The idle deadline is a timer a turn end arms, so a restart drops it, and the host the boot re-adopts has no turn end left to arm one. When `spawnProcess` adopts a host whose turn was complete (`reattach.turnCompleteSent`), `reportRestoredTurn` (`claude-compaction-restore.ts`) reads the host's last turn — a local host's off its journal on this machine (`lastTurnRecord`, MAN-683: the newest `result`'s time and `modelUsage`, and the last main-thread assistant message since the `result` before it), a node host's from the record its warden lists (`reattach.lastTurn`, `CerberusNodeHostLastTurn`: the warden runs the same `lastTurnRecord` over its own journal, picks the request with the same `mainThreadRequestOf`, and sends it cut down to `type`, `parent_tool_use_id`, `message.model` and `message.usage`) — and calls `turnRestored(report, endedAt, idleTries)` (`idleTries`: the host meta's `idleCheck.tries` when its `at` is not before `endedAt`, else 0 — MAN-8316, "Bounded across a restart"). The budget goes through `mainThreadRequestOf` (`session-host/host-registry.js`: the one rule for which assistant message is a turn's request and what it measures — main thread, not `<synthetic>`, more than zero tokens), the same function the live stream asks of each assistant message and the warden asks of a node host's journal, so the restored `contextTokens` is the number the turn end logged (Uploads, 2026-10-12: 321,120 both ways); `contextWindow` is `contextWindowFor` over the result's `modelUsage`; `answered`, `aborted` and `seed` are false and `activity` is the adopted process's (busy while `deferredTools` is non-empty or `backgroundTasks` is). A host that never ended a turn reports nothing (a node host whose warden predates `lastTurn` lists none, so reports nothing), and a host whose turn is still running gets its deadline from its own turn end. What the compaction does with it is MAN-8066, "A restart".
- **A re-adopted process knows what its host was running.** `backgroundTasks` (the CLI's own task signal, which the process's idle closer, its `activity` and the compaction's guard read) starts from `reattach.liveTasks`, the tasks the host's journal shows running (`host-live-tasks.js`, MAN-683): a restart used to empty it, and a backgrounded subagent or monitor the call ledger (`backgroundWorkIds`) never names read idle until its next change. The process's `idleCheck` (the compaction's record of its idle check for the last turn end) starts from `reattach.idleCheck`; every note it sends carries it, a `result` clears it, and `handle.markIdleCheck(tries)` — reached through `claudeRuntime.markIdleCheck` and `providerRuntimeService.markIdleCheck` — sets it and writes the host's meta through the host's own note (`ack: false`).
- **A seed append** is `options.transcriptAppend` (strings, each a text block; `options.compactionSeed` marks the run, `isSeedAppend`). `transcriptAppendMessage` makes it one SDK user message with `shouldQuery: false` and its own uuid: the CLI writes it to the transcript, calls no model, and merges it into the next message that queries. `buildPromptMessages` answers the append first, then the send's own message; the own message is dropped only when an append exists and the command is empty with nothing attached. A seed append files no run-stopped push. A push's pending turn is named by its LAST message (`openTurn` in `spawnProcess` and in `pushTurn`): an append-only push waits for the append's own `result`, an append pushed with a message waits for the message's.
- **An append's `result`** (`num_turns: 0`, all-zero usage, `user_message_uuids` naming only appends the process pushed — `createAppendLedger().namesOnlyAppends`) is no turn's end. Alone in its push it answers the pending turn; pushed beside a message it is skipped with `continue` and the message's own result answers. It skips the reconciliation block, and the all-zero cumulative-usage fallback is blocked for it. Before its `complete` the runtime sends one `token_budget` from `askContextTokens(getContextUsage({ detail: 'full' }))` inside the grace window; `totalTokens` not above 0, a late or a failed ask gives one `console.warn` and no `token_budget`. why `full`: `summary` reads ~5-8K tokens high on a session that has made no request; `full` is the nearer count but still reads 1,758 above the next request's own prompt, the same on three Haiku chats (`post_tokens` 35,971 / 35,937 / 36,147 against a first request of 34,213 / 34,179 / 34,389; 2026-10-09, 2.1.295, ~0.5 s against ~64 ms); the two whole-leg chats read 2,075 and 2,141 (35,523 against 33,448; 36,478 against 34,337). So the composer's counter steps down by that, 1.8-2.1K, at the first reply.
- **A run that resumes nothing** (`resumeFromScratch`: an edited first prompt, a compaction's seed append) seeds the session-id capture with null, so the session it starts is captured, handed to `ws.setSessionId` and announced with `session_created`; seeded with the chat's old provider id, as it was, the capture never fired and the chat stayed on the old session. When the run registry then moves a Claude chat's row from one provider session to another it marks the session it leaves superseded first, so the abandoned original is kept on disk, goes with the chat and is never indexed as a second sidebar chat.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-restore.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/websocket/services/chat-run-registry.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## MAN-8068 — Custom compaction — the providers' seams at a glance: history, indexer, search, runtime hooks, which row holds each

Claude only. The module that compacts is `server/modules/compaction/` (MAN-8067); the providers reach it through their context and its record through `sessionCompactionsDb` (MAN-8046), and import neither module. With the switch off, a chat with no record reads exactly as before and the launch is byte-identical.

| Seam | Fact | Row |
|---|---|---|
| history | `fetchHistory` stitches: per compaction record, oldest first, that transcript's rows (read under its own provider id, so its subagents are found), one `kind: 'compaction'` row (`id` `compaction-<old provider id>`), then the live transcript's rows. `stitchCompactedHistory` in `list/claude/claude-compacted-history.ts` | MAN-8054 |
| old rows | rows of a superseded transcript carry no `transcriptAnchorId`: no edit, no fork from them | MAN-8054 |
| seed as summary | the first user-prompt row of every transcript after the first is rewritten to `isCompactSummary: true`, `id` `compaction-summary-<previous old provider id>`, first text block only; the existing branch draws it under `showCompactSummary`; the seed's other blocks (the operator's messages, the tail, the handover line) are not drawn | MAN-8054 |
| counter | `tokenUsage` (the composer's context counter) is read from the live transcript's rows; until the first reply after a compaction it holds none, and the latest record's `post_tokens` stands in (`openingContextTokens`); the history page and `GET /token-usage` both answer it | MAN-8054 |
| indexer | `ClaudeSessionSynchronizer.processSessionFile` skips a transcript whose provider id is superseded (the Codex rule): a compacted transcript is never a second sidebar chat | MAN-8054 |
| search | `listCompactedTranscriptRows` adds one search entry per record, the chat's own row with the old provider id and path: a hit in a compacted transcript names its chat | MAN-8054 |
| launches | `sessions.service.ts` `fetchHistory` collects stamped soul launches for the live provider id AND each record's old id | MAN-8054 |
| runtime hooks | `ProviderRuntimeContext.compaction: ChatCompactionHooks` (`takesOver`, `turnEnded`, `turnRestored`, `activityChanged`); `providerRuntimeService.useChatCompaction(hooks)`; default: `takesOver` false, the others nothing | MAN-8055 |
| `activity` | optional `IProviderRuntime.activity(appSessionId)` → `{ live, busy, why }`; `providerRuntimeService.activity(provider, id)` answers not-live when a runtime has none | MAN-8055 |
| seed append | `options.transcriptAppend` (strings) is pushed as one `shouldQuery: false` message with no turn of its own, ahead of the send's own message; its `result` is no turn's end and is answered with one `token_budget` from `getContextUsage({ detail: 'full' })`; `options.compactionSeed` files no run-stopped push | MAN-8055 |
| `resumeFromScratch` | the run seeds the session-id capture with null, so the session it starts is announced (`session_created`) and the registry moves the chat's row; the transcript the chat leaves is marked superseded first. An edited first prompt and a compaction's seed append both ride it | MAN-8055 |
| CLI settings | `CLI_COMPACTION_SETTINGS` = `{ idleCompaction: false }`, merged only for a taken-over chat; `autoCompactEnabled` is never touched | MAN-8055, MAN-8067 |

## MAN-8069 — The Claude Code command group in the slash palette

The chat palette's **Claude Code** group is the command list the installed Claude CLI advertises to every SDK client, read from the engine and never typed in. CloudCLI's own six commands (`/help /models /cost /memory /config /status`) keep their own group, titled **CloudCLI Commands**, so the two are told apart.

- **The read** (`list/claude/claude-command-catalog.ts` over `claude-engine-catalog.ts`, the mechanism the model catalog shares — MAN-7405). `supportedCommands()` of an idle CLI with `settingSources: []`: 55 records in 695 ms on Claude Code 2.1.295, all `builtin: true`. Skills, custom commands, plugins and MCP prompts are not in that answer — the palette already lists those from disk — so the list cannot go stale through a skill or plugin change and the CLI version is its whole key. Kept at `~/.cloudcli/claude-command-catalog.json`, `{cliVersion, readAt, commands, terminalCommands}` (`CLOUDCLI_CLAUDE_COMMAND_CATALOG_PATH` redirects it). Timings and retry as MAN-7405 (20 s read ceiling, 3 s wait cap, 10 min failed-read retry). When the read fails the last stored list of any version is served, else an empty one, with one `[Claude commands]` log line: the palette always opens.
- **The terminal-only set.** The engine's `terminal_slash_commands` rides a turn's `init` system message and nothing else: an idle read never receives one. The chat loop's init branch (`claude-runtime.provider.js`) hands it, with the frame's own `claude_code_version`, to `noteTerminalCommands`, which keeps it in the record of that version, in memory and on disk. A set from a CLI older than the installed one is not kept, and a new CLI version starts with none. Nothing is typed in: until a chat has run on a version, no command is badged `terminal`. Terminal commands are SHOWN, badged `terminal` (the SDK says desktop surfaces may keep them); sent headless, `/doctor` runs as the engine's setup checkup.
- **The route** (`commands/engine-commands.service.ts`; `POST /api/commands/list`). Adds `engine: [...]`: every record as `{name: '/'+name, description, argumentHint, aliases, namespace: 'engine', metadata: {type: 'terminal' | 'claude-code'}}`, sorted by name, minus names beginning `__` (engine-internal) and minus an exact name CloudCLI answers itself (`builtInCommands` — today the engine's `config`; CloudCLI's own wins). `count` includes the engine entries. A catalog that cannot be read is `engine: []`, never an error reply.
- **The client** (`useSlashCommands`, `CommandMenu`). `data.engine` is merged with `type: 'engine'` for a Claude composer only (a Codex, Cursor or OpenCode composer never gets the group; the list reply names no provider), after the custom commands, so a user's own command of the same name is the submit guard's first match. The group sits right after CloudCLI Commands; each row shows its `argumentHint` beside the name and a `claude-code` / `terminal` badge, and a long description truncates on one line. An engine entry, like a skill, is inserted into the composer as `/name ` when picked and goes to the wire as typed text; it is never sent to `/api/commands/execute` (`isEngineHandledCommand` in `src/shared/utils.ts`, used by the menu pick and by the submit guard in `useChatComposerState`).
- **Traps.** `Created on first use`: both catalogs build their `EngineCatalog` inside a function, because the cli-version barrel, the websocket module and the providers barrel form an import cycle, and a `new EngineCatalog(...)` at module top level throws `Cannot access 'EngineCatalog' before initialization` in an unlucky entry order. A fresh chat's own `/sessions/<id>/token-usage` 404 is the known console noise in any probe that opens a chat with no transcript.
- **Proof.** `node .verify/palette-claude-code-group.mjs` (the open palette at 1440x900 and 390x844, light and dark; the live list reply; one Haiku `/usage` turn in the scratch probe project; the model picker as the shared mechanism's regression guard; the provider gate, no turn sent: a Codex, Cursor or OpenCode composer's palette has no Claude Code group and Claude's has it again, skipped with a `skip:` line when the picker offers no other provider with a model). The group follows the composer's provider, which is a stored per-user preference (`selectedProvider`), so every session pins the composer on Claude and drops its preference writes (`lib/prefs-pin.mjs`; the picker switches in `lib/composer-provider.mjs` move the page, never the shared dev account): a run neither depends on nor changes the stored value. The `/doctor` and `/model` hint checks compare against the hint in the live `POST /api/commands/list` reply, never a literal. The turn's `/doctor` → `terminal` check proves the init-frame hand-off only when `/doctor` was not badged `terminal` before the turn (the stored set was empty for the CLI version); otherwise it prints a `note:` and checks only that the badge stands.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/commands/commands.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/commands/engine-commands.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-command-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/CommandMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSlashCommands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## MAN-8495 — The Claude runtime's seams to tool sets — entry points, the `claude-toolset-seams.ts` functions, the call-ins

The Claude runtime learns a chat's tool sets through `context.toolsets` only (MAN-8487) and imports nothing from the toolsets module (MAN-8500, map MAN-8497). Sibling of MAN-8055 (custom compaction): the same context-hook shape. `claude-runtime.provider.js` takes call-in lines; every body is `list/claude/claude-toolset-seams.ts`.

## Entry points

| name | where | does |
| --- | --- | --- |
| `ProviderRuntimeContext.toolsets` (`ChatToolsetHooks`) | `server/shared/types.ts` | always present; one delegating object that reads the registered hooks at CALL time (a process keeps the context of the message that spawned it) |
| `providerRuntimeService.useChatToolsets(hooks)` | `provider-runtime.service.ts` | stores the hooks; the default answers the inert launch, so with nothing registered a launch is today's |
| `IProviderRuntime.syncToolsets?(appSessionId)` | `server/shared/interfaces.ts` | optional; only a runtime that keeps a live process per chat has it |
| `providerRuntimeService.syncToolsets(provider, id)` | `provider-runtime.service.ts` | `runtime.syncToolsets?.(id) ?? { live: false }`; a throw or reject → `{ live: false }` with one warning |
| `claudeRuntime.syncToolsets(id)` | `claude-runtime.provider.js` | a live, non-closing process → `handle.syncToolsets(30_000)`; else `{ live: false }` |

## Functions — `claude-toolset-seams.ts`

| function | does |
| --- | --- |
| `askToolsetLaunch(context, { appSessionId, onNode }, deadlineMs = 2_000)` | asks `context.toolsets.launchFor`; a throw, a reject, a non-record answer or no answer in `deadlineMs` → the inert launch `{ env: {}, servers: null, promptLine: null }`; each distinct failure text logs one `[Claude SDK]` warning per server process |
| `applyToolsetLaunch(sdkOptions, launch)` | `launch.env` into `sdkOptions.env`; `launch.promptLine` after `systemPrompt.append`; an inert launch changes neither; `servers` are never put on the launch |
| `toolsetDigest(servers)` | `null` for null/undefined (nothing in play), `''` for `{}`, else sha256 of the map's JSON; digests only, never configs (a config can carry a token) |
| `createToolsetSync(deps)` → `{ sync(boundMs) }` | one process's sync into its CLI; never throws, never retires the process |

`ToolsetSyncDeps`: `getQuery`, `isClosing`, `context`, `appSessionId`, `onNode`, `setApplied(digest | null)`, optional `baseServerNames()` (omitted → the base-name guard is off; the runtime always passes it).

## Call-ins — `claude-runtime.provider.js`, `chat-process.ts`

| where | call-in |
| --- | --- |
| `resolveSdkOptions` | `askToolsetLaunch` + `applyToolsetLaunch`; returns `toolsets: { digest: toolsetDigest(launch.servers), servers }` |
| `launchProfileOf(…, toolsets)` (5th arg) | `LaunchProfile.toolsets` = the digest the message WANTS; `null` when nothing is in play |
| process creation | `createToolsetSync({ …, setApplied: d => { profile.toolsets = d }, baseServerNames: () => Object.keys(sdkOptions?.mcpServers ?? {}) })`; `handle.syncToolsets(boundMs)` |
| `planLiveChanges` | `changes.toolsets = next.toolsets !== null && next.toolsets !== live.toolsets` (re-adopted: `next.toolsets !== null`); a tool-set difference is never a respawn reason |
| `applyChanges` | `changes.toolsets` → `withinGrace(handle.syncToolsets(INTERRUPT_GRACE_MS = 5_000))`; a failure warns and the turn goes on; the "Applying to the running process" log skips `toolsets: false` |
| spawn | `profile.toolsets = reattach ? null : ''`; the hold on a fresh process: MAN-8502 |
| re-adopt profile merge | `Object.assign(profile, next, { …, toolsets: profile.toolsets })` — what the process HOLDS is what the sync recorded, not what the message wants |
| `claudeRuntime.syncToolsets(appSessionId)` | live non-closing process → `handle.syncToolsets(30_000)`; else `{ live: false }` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-toolset-seams.ts

## MAN-8502 — The Claude runtime's seams to tool sets — the hold on a fresh process, the applied digest, the live settings, why a sync never retires a process
section: The Claude runtime's seams to tool sets — `claude-toolset-seams.ts`, the one `setMcpServers` mechanism, the base-name guard, the sync's bound/001 The hold on a fresh process

- Applies when the launch's `servers` map is non-empty and the run is not a re-adoption. Then the prompt queue starts EMPTY (the hooks-retry branch builds its queue from the same messages), and right after `addSession` registers the handle `handle.syncToolsets(INTERRUPT_GRACE_MS = 5_000)` runs; whatever it answers (it never rejects), its settle pushes the spawn's prompt messages. why: the chat's first turn already has the tools.
- Not awaited: the message loop starts at once, because it answers the SDK's control request.
- Bound: 5 s for the whole run (the hook's ask included). Past it the prompt goes in anyway, the applied digest is `null`, and the next joining message syncs again. Measured 2026-10-16: a hook answering at 1.9 s and a CLI that never answers `setMcpServers` → settled at 5002 ms, `confirmed: false`, "setMcpServers was not answered within 5000 ms".
- A launch with `servers` null or `{}` holds nothing: the queue starts with the prompt, as before.

## Applied digest — `LaunchProfile.toolsets`

| value | on the process's profile | on a message's profile (`launchProfileOf`, 5th argument) |
| --- | --- | --- |
| `null` | not known: a re-adopted process, or a sync that failed, went unanswered or left a server unconnected | nothing in play for the chat: never syncs |
| `''` | none applied (a fresh process before its first sync) | the chat's on-sets define no server (`{}`) |
| 64-hex | sha256 of the map's JSON applied to this process | the digest the message WANTS |

| `planLiveChanges` | `changes.toolsets` | result |
| --- | --- | --- |
| wanted `null` | false | no sync |
| wanted ≠ held (a new set on, a set off, a held `null`) | true | `applyChanges` syncs before the turn |
| wanted = held | false | no sync |
| process re-adopted (`live.unknown`) | `next.toolsets !== null` | one sync; the held digest is what that sync recorded, not what the message wants |

A tool-set difference is never a respawn reason.

## Live settings of a running process — `planLiveChanges` (`chat-process.ts`)

| setting | applied by |
| --- | --- |
| model | `setModel` |
| effort, ultracode | `applyFlagSettings` |
| permission mode (a bypass request on a process not launched with it respawns) | `setPermissionMode` |
| allowed tools, GROWN | in place (`sdkOptions.allowedTools`) |
| compaction taken over | `applyFlagSettings` (MAN-8055) |
| **tool sets** | `setMcpServers`, through `createToolsetSync` |

Respawn reasons (launch arguments): `resumeFromScratch`, a resume anchor, `cwd`, the installed CLI newer than the process's, the account (`LaunchProfile.account` against `chosenAccount()`; words `account <slug> → <slug>`; `null` on either side is not heard, never a respawn — MAN-8848), the base `mcpServers` map, a bypass request, any change to the disallowed list, a SHRUNK allowed list.

## Why a sync never retires a process

- `joinProcess` retires the process and spawns afresh when `applyChanges` throws for another setting; `applyChanges` catches the tool-set sync's own failure, warns, and the turn goes on. `createToolsetSync` never throws and `claudeRuntime.syncToolsets` never rejects.
- why: `retire` interrupts the turn, then ends the queue (EOF), and a background task still running at that EOF dies with the CLI; the respawn would meet the same server again. A server that fails to connect is reported (`failed`, or `unconfirmed` past the bound) and a slow http server is not a broken conversation.
- The failure is not lost: the applied digest goes `null`, so the next joining message syncs again.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-toolset-seams.ts

## MAN-8503 — The Claude runtime's seams to tool sets — the one `setMcpServers` mechanism, one sync run, the base-name guard, the journal line, the traps
section: The Claude runtime's seams to tool sets — `claude-toolset-seams.ts`, the one `setMcpServers` mechanism, the base-name guard, the sync's bound/002 One sync run — `createToolsetSync(...).sync(boundMs)`

## Mechanism — INV-8471

- A set's servers reach a CLI only through `Query.setMcpServers(map)`, handed the FULL map of the chat's on-sets every call: the call REPLACES the servers it owns. why: one code path for on, off, a fresh process and a re-adopted one.
- Never in the launch's `mcpServers` option (a launch argument: a change replaces the process). Never `toggleMcpServer` (writes `disabledMcpServers` into the project's `~/.claude.json` entry, shared by every session in the folder).
- `setMcpServers` also replaces every IN-PROCESS SDK server (measured 2026-10-15: a call without the new set tore down the SDK server hosting the switch tool mid-call, "Connection closed"). No chat launch carries one today; one that does must be re-passed in the sent map on every call, in `runOnce`.

## One sync run — `createToolsetSync(...).sync(boundMs)`

Runs are chained (one at a time, in ask order); each re-asks the hook when its turn comes, so racing switches leave the CLI holding what the row says last.

1. `isClosing()` → `{ live: false }`.
2. Ask the hook (`min(2 s, boundMs)`). Hook failed → `{ live: true, confirmed: false, reason }`; nothing sent, applied digest untouched.
3. `servers === null` → `{ live: true, confirmed: true, added: [], removed: [], errors: {} }`; no request, no journal line.
4. No query → `{ live: false }`.
5. `shapeForCli`: a server named like a launch `mcpServers` key is dropped from the call and goes to `errors` (settled for the process: no resync per message); a stdio server (type unset or `stdio`) without `args` is sent with `args: []`.
6. Names in `failedNames` that are still wanted: call 1 without them, then call 2 with the full map; `mergeResults` joins both; a name removed only to retry is not in `removed`.
7. `boundMs` bounds the WHOLE run (ask + every `setMcpServers`; each call gets what is left, min 1 ms). A call past it → `{ live: true, confirmed: false, reason }`, applied digest `null`.

| result | applied digest recorded (`setApplied`) | answer |
| --- | --- | --- |
| CLI reports no errors | `toolsetDigest(hook's servers)` | `confirmed: true`, `added`, `removed`, `errors` = rejected base names |
| CLI reports ≥1 `errors` | `null` (next joining message syncs again) | `confirmed: true`, `errors` = rejected + CLI's |
| call throws or exceeds `boundMs` | `null` | `confirmed: false`, `reason` |

- `failedNames` = keys of the last result's `errors`: the CLI treats a repeat of an identical map as a no-op and stops reporting the failure, hence remove-then-add. A server that stays down is retried by every joining message.
- Journal: `[Claude SDK] Tool sets for session <id>: +<added> -<removed> errors=<names> (<ms> ms)` or `… unconfirmed: <reason ≤200 chars> (<ms> ms)`; `(ms)` starts before the hook ask.

## Traps

- Base-name collision, measured on Claude Code 2.1.301: a `setMcpServers` naming a launch-option server TAKES THE NAME OVER, and the call that later omits it removes the operator's server. The guard covers the launch `mcpServers` option only; a base server from a settings file or a plugin cannot be named here (unmeasured).
- `loggedFailures` (the once-per-text set) is never bounded.
- Prompt order for a joining message while the first prompt is held: its sync queues behind the spawn's, so its `pushTurn` runs after the held prompt is released (by construction; unexercised live).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-toolset-seams.ts

## MAN-8848 — The Claude launch account — the spawn read, the join comparison, the launch record

Every Claude CLI start in CloudCLI rides the account the house chose. The door's verb: MAN-8842. The two reads this launch makes (`launchCredential`, `chosenAccount`): MAN-8849; rules: INV-9253. The respawn rule's place in `planLiveChanges`: MAN-8502.

## Starts that read the account
| start | env built | read |
|---|---|---|
| chat CLI (`spawnProcess`, `claude-runtime.provider.js`) | `sdkOptions.env = { ...sdkOptions.env, ...launch.env }`, after `resolveSdkOptions` and `userFacingEnv()` | once per spawn; skipped for a re-adoption (`reattach`) |
| model and command catalogs (`readRecordsFromCli`, `claude-engine-catalog.ts`) | `{ ...userFacingEnv(), ...account.env }` | per read |
| diagnosing agent and its audit (`diagnosis-agent.ts`, `diagnosis-audit.ts`) | `{ ...userFacingEnv(), ...account.env }` | per run, after the abort listener is attached |

## `claude-launch-account.ts`
| export | answers |
|---|---|
| `launchAccountEnv()` | `{ env, account, slug }`; `env` is `{ CLAUDE_CODE_OAUTH_TOKEN: <token> }` when the door holds a token for the chosen account, else `{}`; never rejects: any failure is `{ env: {}, account: null, slug: null }`, the launch rides the live login |
| `accountRespawn(live, next)` | `account <from> → <to>` (slugs; digest when a slug is missing) or `null`; `null` when either `account` is not a string (not heard) or the two are equal |
| `recordLaunch({ session, account, slug, why })` | appends one line to the launch record; never throws, never gates a launch |

## Profile fields — `LaunchProfile.account`, `.accountSlug`
| profile | value |
|---|---|
| the process's (set at spawn) | the door's answer at the spawn; `null` when the door gave none, and for a re-adopted host whose meta holds none. Also the account the process's limit signals and rate-limit readings belong to (MAN-8859) |
| a message's (`launchProfileOf`, 6th and 7th arguments) | the account the house has chosen now (`chosenAccount()`); `null` when the record is absent or unreadable |

## Join — an account change replaces the process
1. `joinProcess` reads `chosenAccount()` on every message and builds `next` with it. A join never asks the door.
2. `planLiveChanges` calls `accountRespawn(live, next)` after the CLI-version rule and before the re-adopted-process branch; a reason is `{ respawn, changes: null }`.
3. `joinProcess` logs `[Claude SDK] Replacing the process for session <id>: account <slug> → <slug>`, retires the process and answers `{ launchWhy: 'respawn: account <slug> → <slug>' }`.
4. `queryClaudeSDK` spawns afresh on `joined?.launchWhy ?? 'new'`; the spawn reads the door and rides the new token; the conversation resumes.
5. A running process keeps the environment it was started with, so a changed choice reaches an open conversation only at its next message.

## Launch record — `~/.cloudcli/claude-launches.jsonl`
- One line per chat CLI start: `{ at, session, account, slug, why }`; `at` epoch seconds, `why` is `new` or `respawn: <reason>`; mode 0600.
- Lines older than 30 days are dropped on the first append of each UTC day (the day read from the newest line's `at`); written through a temp file and a rename.
- Evidence, never authority: every write failure is swallowed.
- `CLAUDE_LAUNCHES_PATH` moves the file for a probe.

## Proof
`.verify/account-chat-launch.sh` — scratch home with two made-up accounts: the token rides the first turn (a 401 from the made-up token), `store.choose` of the other account replaces the process at the next message, the launch record carries both lines, and the token appears in no log, session file or launch record. `.verify/account-chat-launch.mjs` drives one turn on a chat.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-audit.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-launch-account.ts

## MAN-8859 — Claude chats' limits and readings by launch account — claude-limit-memory.ts, claude-chat-readings.ts, the account key in claude-runtime-signals.ts

What a chat's rate-limit events and limit notices belong to: the account the chat PROCESS WAS LAUNCHED ON, never the live login (after a switch, the live login is not the account an open chat rides). The signals table and the two memories: MAN-614. The launch profile: MAN-8848.

## The account key
- `claude-runtime.provider.js` hands `detectRuntimeSignals` a context with `account` (digest or `null`) and `accountSlug` (slug or `null`), read off the process's launch profile; a re-adoption uses its recorded profile, `null` when it holds none.
- `limitAccountOf(context)` (`claude-runtime-signals.ts`) = `accountSlug || account || 'unknown'`. It keys the limit memory AND the notice `dedupeKey`; change it and both move together.
- The key is never `liveAccountEmail()`: a limit belongs to the account that met it, and a warning sent for one account never silences another's.

## Limit memory — `claude-limit-memory.ts`
| fact | value |
|---|---|
| file | `~/.cloudcli/limit-memory.json`, mode 0600, staged and renamed; `CLOUDCLI_LIMIT_MEMORY_PATH` moves it, read on every call |
| `accountLimitMemory(account)` | `{ windows: Map<rateLimitType, LimitMemory>, creditsExhaustedAnnounced }`; a falsy `account` is `'unknown'` |
| `windowMemory(rateLimitType, account)` | one window's `LimitMemory`: `announcedResetsAt`, `warnedBuckets`, `warnedWindowResetsAt`, `warnedAt`, `overageAnnounced`; reset timers are not stored |
| unreadable or malformed file | an empty memory; the cost is one warning too many |
| keys in the file | slugs, digests or `unknown`; a key that is an email address is dead data, nothing reads or writes one |

## Notice key and title — `emitLimit`, `buildNotificationText`
- `emitLimit` builds every limit notice: `dedupeKey` = `claude:<code>:<limitAccountOf>:<rateLimitType>:<keyPart>`. The orchestrator (`notification-orchestrator.service.js`) dedupes on `dedupeKey` alone for 20 s, so two accounts crossing the same window together are two notices.
- `meta.accountSlug` rides on the notice when the launch profile has a slug.
- `buildNotificationText` (`notification-copy.service.ts`): a code in `ACCOUNT_LIMIT_CODES` appends ` · <slug>` to its title when `meta.accountSlug` is a non-blank string; every channel reads that one title. Never a digest in a title (INV-76). No slug in the launch record: the title is unnamed.

## Chat readings — `claude-chat-readings.ts`
- `noteChatWindows(account, unifiedWindows)`, called by the `rate_limit_event` branch with `context.account` (the DIGEST). A null or empty `account`, or an event with no readable window, files nothing.
- Conversion: `unifiedWindows.five_hour` / `.seven_day`: `utilization` fraction → percent (one decimal, 0..150), `resetsAt` epoch seconds → ISO instant, into `ClaudeUsageWindow` rows with keys `five_hour` / `seven_day`. An entry that is not a live window is left absent, never 0 %.
- One reading per move: an in-memory map (account digest → the two windows last filed) lives in the server process; a reading is filed only when either window's percent or `resetsAt` differs from it. The first event after a restart files once; the pacer's store dedupes an identical row on its own (MAN-8844).
- Filing: `notePacerReading(account, rows, Date.now(), 'chat')` → `pacer note --source chat` (`note` in `pacer-door.ts`, exported through `server/modules/accounts/index.ts`). `at` is the instant the event arrived (the event carries none). `note` takes `'meter' | 'chat'` with no default.
- A stored chat step wakes the dispatcher and settles the account rule like a meter's (MAN-8846), so a chat's reading can trigger a switch. The pacer's source table: MAN-8628.

## Proof
Measured 2026-10-21, live dev API :3011, two Haiku turns in a scratch project: launch record `{account:"f9caa612", slug:"scottdejesus", why:"new"}`; `readings.newest("f9caa612")` → `source='chat'`, `at` = the turn's time; the second turn's identical windows filed nothing; `limit-memory.json` gained a `scottdejesus` key carrying the chat's `five_hour` window.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-chat-readings.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-limit-memory.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime-signals.ts

## MAN-9060 — sessions.name_given — the mark on a chat name: who writes it, who reads it, how the duplicate merge carries it

`sessions.name_given` INTEGER NOT NULL DEFAULT 0: `1` when a person gave the chat its `custom_name` (the sidebar's rename, Kaylee's `rename_session`), `0` for every other writer. why: `custom_name` alone cannot tell a name he typed from one the app proposed, and a name he typed is never replaced.

| fact | value |
| --- | --- |
| declared | `addSessionNameGivenColumn` (`migrations.ts`, after `addSessionEffortColumn`); not in `schema.ts` — a fresh database gets it from the migration run |
| existing rows | `0`: no name on disk is known to be his |
| row type | `name_given: number` in `SessionRow`; named in `SESSION_ROW_COLUMNS` (`sessions.db.ts`) |
| undo | none: nothing writes it back to `0` |
| read it | `sqlite3 ~/.cloudcli/auth.db "select session_id, custom_name, name_given from sessions where name_given = 1"` |

## Doors (`sessionsDb`, `sessions.db.ts`)

| door | does | caller |
| --- | --- | --- |
| `renameByPerson(sessionId, customName)` | `updateSessionCustomName` then `markNameGiven`, in one `db.transaction` | `sessionsService.renameSessionById`, reached by `PUT /api/providers/sessions/:sessionId` (`provider.routes.ts`: the sidebar's rename) and by `rename_session` (`companion/tools/act-tools.ts`: Kaylee's rename) |
| `markNameGiven(sessionId)` | `name_given = 1` | `renameByPerson` only |
| `updateSessionCustomName(sessionId, customName)` | writes the name, never the mark | a name the app derives: `codex-session-synchronizer.provider.ts` (the Codex thread name), `companion-send.ts` `sendToNewChat` (Kaylee's `create_session` title), `chat-namer.service.ts` (Haiku's name) |
| `nameFactsOf(sessionId)` | `{ customName, nameGiven, appCreated, isArchived }`, or `null` when no row has the id | `chat-namer.service.ts` (chat-names module, MAN-9067): questions 1 to 3 of the naming pass (`appCreated` + `isArchived`; `nameGiven`; `customName`) and the re-read before its write |

`appCreated` = `provider_session_id IS NULL OR session_id <> provider_session_id`: the app allocated the id. A chat discovered on disk holds one id in both columns.

## Kaylee's two doors

| tool | write | `name_given` after |
| --- | --- | --- |
| `rename_session` (`act-tools.ts`) | `sessionsService.renameSessionById`, then `broadcastSessionUpserted` | `1`: it is his word |
| `create_session` title (`companion-send.ts`, `sendToNewChat`) | `sessionsDb.updateSessionCustomName` after `sessionsService.createAppSession`, then `broadcastSessionUpserted` | `0`: her title is not a name he gave; the namer replaces it when it fails `isSayableName` |

## The duplicate merge — `assignProviderSessionId`

The watcher's row (keyed by the provider id) merges into the app row. A name travels with its mark.

| duplicate's `name_given` | app row's `name_given` | `custom_name` after | `name_given` after |
| --- | --- | --- | --- |
| `1` | `0` | the duplicate's (the app row's when the duplicate has none) | `1` |
| any other pair | | the app row's (the duplicate's when the app row has none) | the larger of the two |

The UPDATE's right-hand sides read the app row as it was before the statement, so the `CASE` sees the app row's own mark, not the one `MAX` writes.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-send.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/tools/act-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/sessions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/provider.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/sessions.service.ts

## MAN-9068 — A steer — folding a message into the turn a Claude process is running: the verb, the miss, the transcript shape and the history row

A steer is one user message pushed into the turn a Claude process is running, so a correction reaches the session while it works instead of queueing behind the turn going the wrong way. The SDK folds a message queued mid-turn into the turn in flight.

| piece | what it is |
| --- | --- |
| the handle's `steer(content)` (`claude-runtime.provider.js`) | pushes ONE uuid-stamped `SDKUserMessage` into the process's queue, opens NO turn, touches the idle closer. `false` when the process is closing, has no queue or has no pending turn (`pendingTurn === null`). The uuid is remembered in `steeredUuids`. |
| `steerClaudeSession(sessionId, content)` | `getSession(id)?.process`; none, closing or a false `steer` is `'not_running'`, else `'folded'`. Also `claudeRuntime.steer`. |
| `providerRuntimeService.steer(provider, id, content)` | a provider whose runtime has no `steer` (or throws) answers `'not_running'`. The compaction decorator answers `'not_running'` while `flightOf(id)` holds a compaction of a Claude chat. |
| `steerChatRun(id, content, echo, deps)` (`chat-run-verbs.service.ts`) | no running run → `'not_running'`; `'folded'` writes `echo` onto that run's writer. The caller starts a turn instead on `'not_running'`. |

- THE MISS IS NOT A RARE RACE (measured by Athena, 2026-10-27, Haiku). The CLI takes a pushed message only at a TOOL-RESULT BOUNDARY. A steer sent into a turn that makes no further tool call (a text-only turn, the final reply, a long closing summary) is never taken by it: `steer()` answers `folded` and the steer runs as the CLI's next turn after the turn's `complete`. So `folded` means "pushed", not "the turn changed course", and the sentence she tells him says so ("Sent to X while it works. It takes the brief at its next tool step, or as its own turn right after it finishes"). At the `result` that ends the pending turn without listing a remembered steer uuid in `user_message_uuids`, the runtime logs `[Claude SDK] A steer for session <id> missed its turn and runs as a turn of its own` and remembers the uuid in `missedSteers`; the steer's own turn is the next result that LISTS that uuid, and it is logged (`… that missed its turn has finished its own`) and kept out of the background-work branch (no `notifyBackgroundWorkCompleted`, no deferred-tool hold released). A `result` with no `user_message_uuids` says nothing either way and logs nothing.
- STOP AND A PENDING STEER. The same boundary rule means a steer pushed and not yet taken sits in the CLI's queue, and the interrupt a Stop sends makes the CLI dequeue it and answer it as a turn of its own — after the Stop, with nobody watching, in whatever permission mode the chat runs. So `abortClaudeSDKSession` reads `hasPendingSteer` (a steer remembered in `steeredUuids`, i.e. not yet accounted for by a result) at the press and, when it is true, KILLS the process WITHOUT sending the interrupt first (measured: kill-after-interrupt FAILS — the interrupt is what makes the CLI dequeue the steer and start answering it, and the CLI went on answering after the SIGTERM), outranking "keep the process for background work" and "end stdin"; `steer()` answers false once a Stop has marked the instance (`abortedInstances`). Conservative: a steer already taken stays remembered until the turn's result, and a Stop in that stretch also ends the process (the next message spawns a fresh one on the transcript).
- A MISSED STEER'S TURN HAS NO RUN. The turn the CLI runs for a steer that missed is invisible to the run registry (the run ended with the turn it missed, and the registry drops a second `complete`), but not to the runtime, which reports it busy (`activity`: "a turn is in flight"). So `abortChatRun` with no running run asks the runtime (`abortUnregisteredTurn`): a process mid-turn is stopped through `runtime.abort`, answer `stopped`; background work alone is not a turn and stays `not_running`. The same door serves a background task's wake-up turn. Her `stop_session` and the page's `chat.abort` ride it. The end of that turn is announced as a run's end (`notifyRunStopped`, the "finished" notification), in the runtime's result branch (`ownSteers`), and never as background work. What it still lacks is a registry run: no `complete` frame, no unread mark, no run-completed listener (the focus feed) — opening a run for a missed steer is a websocket/registry design change, a follow-up.
- THE TRANSCRIPT SHAPE (measured 2026-10-27, CLI 2.1.x, a steer five seconds into a `seq 1 20` Bash loop on Haiku): the CLI does NOT write the folded message as a `user` row. It writes `{ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt, source_uuid, delivery_id } }` at the point it was folded in (between the loop's tool result and the reply), with `queue-operation` rows (`enqueue`, then `remove` with `reason: 'absorbed_mid_turn'`) and an `api-request-blob` quoting it ("The user sent a new message while you were working"). The run shows exactly one `complete` and the reply obeys the steer.
- THE HISTORY ROW. `claude-queued-prompt.ts` (`queuedPromptAsUserRow`) gives a `queued_command` / `prompt` attachment the shape of a user row, so `normalizeMessage` draws it as a user text turn; every other attachment keeps meaning nothing. It carries NO `transcriptAnchorId` (an attachment is not a resume point). Before this row existed a message folded into a running turn was missing from the chat after a reload and nothing could mark it "Through Kaylee".
- ONE LIVE ROW. The SDK stream replays no `user` row for the steer, so the echo (`local_kaylee_<uuid>`, `spokenVia: 'kaylee'`) is the only live row; the page's reconcile swaps it for the history row once that exists.

Shown by `.verify/companion-send.mjs` (`.verify/companion-send-scratch.sh` on a scratch stack: the live box has one Kaylee shared by everyone at work).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-runtime.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/companion/companion-send.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-queued-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-sessions.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/websocket/services/chat-run-verbs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/companion-send.mjs
