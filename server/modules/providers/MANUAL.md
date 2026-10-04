<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-708 — providers

The provider contract: every wrapper exposes the same seven facets — runtime, models, auth, mcp, skills, sessions, sessionSynchronizer — over the shared interfaces, so a new provider is added without guessing which file moves.

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
(`claude-runtime.provider.js` §`queryClaudeSDK`; the queue, the idle closer and the live-vs-launch
setting split are in `list/claude/chat-process.ts`, and the bounded reading of the installed CLI
that split compares against is `list/claude/installed-cli-version.ts`). `claude-runtime.provider.js` imports `armKeepaliveSpawn` and
`keepaliveReadopt` from it; `server/index.ts` calls `readoptKeepaliveSessions` once per boot
through the providers barrel — before `server.listen`, except on a handover boot, where it waits
for the retiring server to exit first. The mechanism, that exception, its gate, its fallback, and
why three of its files are plain ESM JavaScript, are in
[`server/modules/providers/list/claude/session-host/MANUAL.md (README)`](list/claude/session-host/MANUAL.md) §"Re-adoption, on boot".

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/installed-cli-version.ts

## MAN-700 — What Each Facet Does
section: README/004 What Each Facet Does

| Facet | Responsibility | Base / Service |
| --- | --- | --- |
| `runtime` | Run and abort live SDK/CLI sessions | `IProviderRuntime` -> `providerRuntimeService` |
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

The Claude picker's options, labels, descriptions and effort levels come from the installed CLI's own catalog. There is no list typed in beside the aliases, so a CLI release that moves an alias moves the picker with it.

- **The read** (`list/claude/claude-model-catalog.ts`). It starts an SDK `query` in streaming-input mode, with a prompt that yields nothing, and calls `supportedModels()`. The CLI answers with every model it can run, the alias each family answers to, its name for each, a description and the effort levels each accepts, and it does so without starting a turn. Measured 2026-09-28 on Claude Code 2.1.284: 633–901 ms, no API request, no transcript. The read runs on Haiku (`claude-haiku-4-5-20251001`), from `os.tmpdir()`, with the executable the chat runtime spawns, and with `settingSources: []`. With no settings source named, the SDK loads every one, the read's cwd included, and each read ran the user's SessionStart and SessionEnd hooks plus any `.claude/settings.json` another user left in world-writable `/tmp`. The catalog is byte-identical with no source loaded.
- **When it runs.** Once per installed CLI version, keyed on `readInstalledCliVersion()`, the `cli-version` module's one cached reading; the catalog never runs a `--version` of its own. The answer is kept at `~/.cloudcli/claude-model-catalog.json` beside the version it was read on (`CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH` redirects it), so the dev server's handovers load it instead of respawning the CLI. A reading with no version ("not heard") is served whatever is kept under a real version and never spawns the CLI or replaces that record; only a CLI never named by path, with nothing keyed, is read once per process. `getSupportedModels` also sits on the send path (effort validation), so a caller waits at most 3 s for a read in flight and is otherwise served what is already known.
- **When the read fails.** The server serves the last good catalog on disk, whatever version it came from. With none, it serves `CLAUDE_FALLBACK_MODELS`, whose rows are named by family alone ("Opus", "Sonnet") and state no generation. One `[Claude models]` log line says which. A failed version is asked again after 10 minutes.
- **What is offered** (`list/claude/claude-model-options.ts`). One row per family, the newest: the family's alias entry where the catalog has one, else its newest pinned id (Fable, on 2.1.284). `default` and the older pinned versions are dropped. A new family appears on its own, in the catalog's order. Ultracode is added exactly where the catalog's effort levels include `xhigh`. Values stay the ones stored sessions hold (`opus[1m]`, `fable`, `sonnet[1m]`, `haiku`), so every stored selection still matches an option.
- **Stored ids.** The definition carries `LABELS_BY_MODEL_ID`, the catalog's name for every concrete id it lists. `mergeProviderModels` passes it through, and `src/modules/chat/utils/modelLabels.ts` reads it before its own generation-parsing fallback, which names only ids the catalog does not list. So `claude-sonnet-5-5` reads "Sonnet 5.5" and `claude-sonnet-5` reads "Sonnet 5".
- **Proof.** `.verify/probe-claude-catalog-picker.mjs <before|after>` prints the API's answer and the picker's rows, desktop and mobile, dark and light. `.verify/probe-opus-55-selector.mjs` covers stored-turn captions and the resumed-session chip.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-options.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-models.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/modelLabels.ts

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

- Add the new provider class to `server/modules/providers/provider.registry.ts`.
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
