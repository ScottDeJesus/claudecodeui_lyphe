# Simple chat list — a flat sidebar mode over the same sessions

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> A user preference `simpleChatList` (boolean, DEFAULT ON) plus `simpleChatProjectId` (the project new chats start in). Both live in the existing user preferences store. Exposed in Settings (a toggle + a project picker).
> When ON, the sidebar replaces the project tree, the search chips ("Projects / Conversations / Running / Archived" pills in SidebarHeader) and the per-project New Session buttons with a flat list: Top: a project dropdown (defaults to `simpleChatProjectId`; changing it updates the preference and applies to NEW chats going forward) and a single "New chat" button that starts a new session in that project. Below: only chats CREATED FROM THE SIMPLE VIEW, newest first. It starts EMPTY. Pre-existing sessions never appear here.
> Each row: title (custom_name or summary), rename (reuse existing inline rename → PUT /api/providers/sessions/:id), and a "Remove" action. Remove = if the session has a live run, show a confirmation ("This chat is still running. Stop it and remove?"); on confirm (or immediately if idle) abort the run (reuse the existing abort-session websocket path / chat-run-registry) then archive the session (existing soft delete: DELETE /api/providers/sessions/:id without force → isArchived=1). Transcript on disk is never touched. Running indicator on rows. Mobile and desktop both. Collapsed icon rail (SidebarCollapsed.tsx) unchanged.
> When OFF, the current full sidebar returns exactly as today. Do NOT delete the existing tree/chips code. Simple mode is a second view over the same data.
> Shell / Files / Git / Tasks tabs follow the PROJECT OF THE OPEN CHAT (selecting a simple-list row must set selectedProject to that row's project just as clicking a session in the tree does today). With no chat open, they follow the dropdown project.
> Rename and remove reuse existing server routes; only the "tagged" flag and the list endpoint are new server surface.

**THIS PLAN DELIVERS:**
A nullable `simple_list_at` column on `sessions`, stamped at insert time when the app-session `POST /api/providers/sessions` body carries `simpleList: true` (the row is minted by that POST before the first `chat.send`, so the flag rides the POST, not the websocket frame); a `simpleList=true` filter on the existing `GET /api/providers/sessions/recent` that narrows the cross-project feed to tagged, non-archived sessions in creation order (one visibility clause, one mapper, one row type — the simple list IS the recents feed filtered to tagged rows); two flat user-preference keys `simpleChatList` (default `true`) and `simpleChatProjectId` (default `null`) read through one shared hook; a Settings → Appearance section "Sidebar" with the toggle and a project picker; and, when the toggle is on, a sidebar body that keeps the header's logo/collapse/refresh controls and the footer (settings gear) but replaces the search field, the four chips, the project tree and its New Session buttons with a project dropdown, one "New chat" button and the flat list of tagged chats (newest created first, 20 per page, running spinner, inline rename via the existing PUT, Remove = abort-then-archive with a stop confirmation when a run is live, the flow owned by a sidebar hook that waits on the busy set rather than polling). Turning the toggle off restores today's sidebar untouched. Every phase is proven on the running dev server (curl, better-sqlite3, headless Chromium at 1440 and 390 px) and spends zero Claude turns.

**OPERATOR VERDICT:** CONFIRMED 2026-09-08 — Scott: "Yes, that's it — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = []

[budget]
max_cycles = 10
max_spawns = 36
max_fix_passes = 2
max_attempts = 2
max_replans = 1
```

## Interfaces

Server (every path relative to `server/`; imports use the `@/` alias = `server/` and end in `.js`):

- `sessions` table gains `simple_list_at DATETIME` (nullable, no default). Declared in `modules/database/schema.ts` `SESSIONS_TABLE_SCHEMA_SQL` (line 123-150) directly after `forked_from_session_id TEXT,`; migrated by a new `addSimpleListAtColumn(db)` in `modules/database/migrations.ts` cloned from `addForkedFromSessionIdColumn` (line 428-431), called in `runMigrations` on the line after `addForkedFromSessionIdColumn(db);` (line 521); indexed by `CREATE INDEX IF NOT EXISTS idx_sessions_simple_list_at ON sessions(simple_list_at)` beside `idx_sessions_is_archived` (line 525-532). `NULL` = not tagged; a timestamp = created from the simple view, and it is the list's sort key.
- `modules/database/repositories/sessions.db.ts`: `SessionRow` (line 5-20) gains `simple_list_at: string | null;` and `SESSION_ROW_COLUMNS` (line 28-30) gains `simple_list_at`. `createAppSession(sessionId, provider, projectPath, customName?, simpleList = false): string` (line 175-192) writes `simple_list_at` as `CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END` bound with `simpleList ? 1 : 0` (better-sqlite3 refuses a boolean bind). `getRecentSessionsPage(limit: number, offset: number, options: { simpleListOnly?: boolean } = {})` (line 543-568) is the ONE feed query: when `options.simpleListOnly` is true its `visibilityClause` gains `AND sessions.simple_list_at IS NOT NULL` (the SELECT and the COUNT share the clause, as today) and its `ORDER BY` becomes `sessions.simple_list_at DESC, sessions.session_id DESC`; when false or absent the SQL is byte-identical to today's. No second page function.
- `modules/providers/services/sessions.service.ts`: `CreateAppSessionResult` (line 17-22) gains `simpleList: boolean`; `createAppSession(provider, projectPath, initialMessage, simpleList = false)` (line 215-234) passes it to the repository and echoes it. `listRecentSessions(limit: number, offset: number, options: { simpleListOnly?: boolean } = {})` (line 145-171) passes `options` through to `sessionsDb.getRecentSessionsPage`; its mapper and its page shape `{ conversations, total, hasMore }` do not change. No second list function, no extra row field.
- `modules/providers/provider.routes.ts`: `POST /sessions` (line 727-737) parses `const simpleList = body.simpleList === true;` and passes it as the 4th argument. `GET /sessions/recent` (line 747-755) additionally parses `const simpleListOnly = parseOptionalBooleanQuery(req.query.simpleList, 'simpleList') ?? false;` (the local helper at line 65, already used by `DELETE /sessions/:sessionId` for `force`) and passes `{ simpleListOnly }` as the 3rd argument. NO new route: the flag lives on the feed that already exists, so the parametric `/sessions/:sessionId` ordering is never at risk.
- Nothing in the barrels changes: `sessionsService` is already exported from `modules/providers/index.ts` and `sessionsDb` from `modules/database/index.ts`.

Client (every application import uses `@/...`; `type` never `interface`):

- `src/shared/userSettings.ts`: `UserPreferences` (line 18-29) gains `simpleChatList: boolean; simpleChatProjectId: string | null;` and `LEGACY_STORAGE_KEYS` (line 54-65) widens to `Record<UserPreferenceKey, string | null>` and gains `simpleChatList: null, simpleChatProjectId: null` — `null` means "born after the migration, nothing to seed", stated in the map's header comment; `readLegacyPreference` (line 200-209) returns `undefined` when the key maps to `null` before touching localStorage. No invented legacy key: the map's header says entries are the keys a setting was read from, and none existed. The entries are still required because `PREFERENCE_KEYS` is derived from that map (line 67). Server needs no change: preferences are key-agnostic EAV rows in `user_preferences`, one row per flat key, JSON-encoded. They are flat keys, not members of the `uiPreferences` blob, because that blob is a typed boolean reducer (`src/shared/uiPreferences.ts`, `parseBoolean` over `UiPreferences`) and `simpleChatProjectId` is a `string | null`; the pair must live in one store, and the precedent for a non-boolean or feature-owned flat key is `tasksEnabled` / `projectSortOrder` / `selectedProvider`.
- `src/shared/hooks/useSimpleChatListPreferences.ts` (new): `export type SimpleChatListPreferences = { enabled: boolean; projectId: string | null; setEnabled: (next: boolean) => void; setProjectId: (next: string | null) => void }` and `export function useSimpleChatListPreferences(): SimpleChatListPreferences`, built on `useSyncExternalStore(subscribeToUserPreferences, () => readUserPreference<boolean>('simpleChatList', true))` and the same for `'simpleChatProjectId'` with fallback `null`; setters call `writeUserPreference(key, value)`. No provider, no context. It lives in `src/shared/hooks/` because three feature modules consume it (sidebar, settings, chat) — the frontend standard's placement rule for hooks.
- `src/shared/types.ts`: NO change. The simple list's row type is the existing `RecentConversationListItem` (`sessionId, provider, projectId, projectDisplayName, sessionTitle, lastActivity`); the client resolves the row's `Project` from `projects` by `projectId`, so no path field is needed.
- `src/shared/api.ts`: `createSession` payload type (line 303-306) gains `simpleList?: boolean`; `recentConversations` (line 204-205) gains `simpleList?: boolean` in its options object and passes it into the existing `query({ limit, offset, simpleList })` — that helper (line 59-69) drops `false`/`undefined`, so the tree's recents request stays byte-identical. No new helper.
- `src/modules/chat/hooks/useChatComposerState.ts`: calls `useSimpleChatListPreferences()` at hook top level and passes `simpleList: simpleChatListEnabled` in the `api.providers.createSession({...})` payload at line 754-758. `src/modules/git-panel/hooks/git-delegation/startRun.ts:15` is NOT changed: a delegated git run is never tagged.
- `src/modules/sidebar/hooks/useSimpleChatList.ts` (new, module-private): `export function useSimpleChatList(selectedSessionId: string | null): { rows: RecentConversationListItem[]; total: number; hasMore: boolean; isLoading: boolean; hasError: boolean; reload: () => Promise<void>; loadMore: () => Promise<void>; renameLocal: (sessionId: string, title: string) => void; removeLocal: (sessionId: string) => void }`. Fetches `api.recentConversations({ limit, offset, simpleList: true })`; reloads on mount, on any `session_upserted` event from `useWebSocket().subscribe` (debounced 500 ms, refetching `limit = max(20, rows.length)`, `offset = 0`), and whenever `selectedSessionId` becomes an id not present in `rows`.
- `src/modules/sidebar/hooks/useSimpleChatRemove.ts` (new, module-private): `export function useSimpleChatRemove(input: { onArchived: (sessionId: string) => void }): { pendingStop: RecentConversationListItem | null; failedSessionId: string | null; remove: (row: RecentConversationListItem) => void; confirmStop: () => void; cancelStop: () => void }`. Owns the whole Remove flow so the list component stays presentational: `remove(row)` archives at once when `useBusySessionIdSet()` does not hold the id, else sets `pendingStop`; `confirmStop()` sends `{ type: 'chat.abort', sessionId }` through `useWebSocket().sendMessage` and records the id as awaiting-idle; ONE `useEffect` on `[busySessionIds, awaitingId]` archives when the busy set no longer holds the id; ONE 15 s fallback timer (cleared on unmount and on success) archives anyway for a run whose abort never completes. No `setInterval`, no ref polling: the busy set IS the client's computed running model (fed by `chat_subscribed`/`complete` frames and re-synced from `GET /sessions/running` every 5 s by `SessionProtectionContext`). `archive(id)` = `await api.deleteSession(id, false)`; on `ok` → `onArchived(id)`; else `failedSessionId = id` for 4 s.
- `src/modules/sidebar/SidebarSimpleList.tsx` (new): a file-local, unexported `type SidebarSimpleListProps = { projects: Project[]; selectedProject: Project | null; selectedSession: ProjectSession | null; isMobile: boolean; onProjectSelect: (project: Project) => void; onSessionSelect: (session: ProjectSession, projectId: string) => void; onNewSession: (project: Project) => void; onSessionRemoved: (sessionId: string) => void; onRenameSession: (sessionId: string, summary: string) => Promise<void>; t: TFunction }` and `export default function SidebarSimpleList(props)`. The type is declared and used in this one file only (the frontend standard's single-file rule; `SidebarProjectListProps` at `src/shared/types.ts:1381` is the two-file precedent this deliberately avoids). Composes the two hooks above; renders the project Select + New chat strip, the rows, the empty state, Show more and the stop dialog. Rendered by `Sidebar.tsx` (not by `SidebarContent`) as `<SidebarSimpleList … />` with `onProjectSelect={handleProjectSelect}` (controller, `hooks/useSidebarController.ts:863-869`), `onSessionSelect={handleSessionClick}` (controller :503-510), `onNewSession={onNewSession}` (Sidebar prop), `onSessionRemoved={(id) => onSessionDelete?.(id)}` (Sidebar prop), `onRenameSession={(id, s) => updateSessionSummary('', id, s, 'claude')}` (controller :957-980; its first and last arguments are ignored by the implementation).
- `src/modules/sidebar/SidebarSimpleListRow.tsx` (new): one row — link to `/session/:id`, title, project display name as a muted secondary label, spinner when running, an `ActionMenu` with Rename and Remove, inline rename input.
- `src/modules/sidebar/SidebarSimpleStopDialog.tsx` (new): the stop confirmation on the shared `Dialog`.
- `src/modules/sidebar/SidebarContent.tsx`: `SidebarContentProps` (line 84-129) gains `simpleList: ReactNode | null` — a slot, so this file never imports `SidebarSimpleList` or its props type. When non-null, `SidebarHeader` receives `simpleMode={simpleList !== null}` and the `ScrollArea` body (the ternary opening at line 210) renders `{simpleList}` as its FIRST arm, ahead of `showConversationSearch`; the footer stays. `ReactNode` is already imported at line 1.
- `src/modules/sidebar/SidebarHeader.tsx`: new optional prop `simpleMode?: boolean`, folded into the existing `showSearchTools` expression at line 103 (`... && !isLoading && !simpleMode`). That one expression already gates the search input and `SearchModeChips` in BOTH the desktop block (line 201) and the mobile block (line 271), so no second conditional is added. Logo, collapse, refresh and new-project controls stay.
- `data-testid` hooks the probes read: `simple-chat-list` (root), `simple-chat-project` (the `<select>`/Select trigger), `simple-chat-new`, `simple-chat-empty`, `simple-chat-row` (each row root, also carrying `data-session-id`), `simple-chat-running` (spinner), `simple-chat-menu` (row ActionMenu trigger), `simple-chat-rename`, `simple-chat-rename-input`, `simple-chat-remove`, `simple-chat-load-more`, `simple-chat-stop-dialog`, `simple-chat-stop-confirm`, `simple-chat-stop-cancel`.
- Settings: `src/modules/settings/tabs/AppearanceSettingsTab.tsx` gains a `projects?: AgentSettingsProject[]` prop and a `SettingsSection` titled `t('appearance.sidebar.title')` after the workspace-tabs section (line 56-67) holding a `SettingsRow` + `SettingsToggle` (ariaLabel = the label text) for `simpleChatList` and a `SettingsRow` + shared `Select` (`ariaLabel` = the label text, options `{ value: project.name, label: project.displayName ?? project.name }` sorted by label, value = `projectId ?? ''`, placeholder = the label) for `simpleChatProjectId`. `src/modules/settings/Settings.tsx` passes `projects={projects}` to `AppearanceSettingsTab` exactly as it does to `AgentsSettingsTab` at line 194. `AgentSettingsProject.name` IS the projectId (see `normalizeProjectForSettings`, `src/modules/sidebar/utils/sidebarProjectFormatting.ts:187-209`).
- i18n, `en` values (all 11 locales get the same keys; values translated): `sidebar.json` → `simpleList.project` "Project", `simpleList.newChat` "New chat", `simpleList.empty` "No chats yet. Start one with New chat.", `simpleList.loadMore` "Show more", `simpleList.rename` "Rename", `simpleList.renamePlaceholder` "Chat name", `simpleList.remove` "Remove", `simpleList.running` "Running", `simpleList.stopTitle` "This chat is still running", `simpleList.stopBody` "Stop it and remove?" (the value ends with a question mark; the key does not), `simpleList.stopConfirm` "Stop and remove", `simpleList.removeFailed` "Could not remove this chat."; cancel reuses the existing `actions.cancel`. `settings.json` → `appearance.sidebar.title` "Sidebar", `appearance.sidebar.simpleChatList.label` "Simple chat list", `appearance.sidebar.simpleChatList.description` "Replace the project tree with a flat list of the chats you start here.", `appearance.sidebar.simpleChatProject.label` "Project for new chats", `appearance.sidebar.simpleChatProject.description` "New chats in the simple list start in this project."
- Harness: `.verify/lib/console.mjs` `openConsole` PATCHes `{"simpleChatList": false}` through the page's own token immediately after sign-in and reloads before it waits for `PROJECT_ROW`, so every existing phase keeps opening on the tree. `.verify/probe-simple-view.mjs` (Phase 4), `.verify/phase-17.mjs` (Phase 5) and `.verify/phase-18.mjs` (Phase 6) flip it to `true` themselves (PATCH + reload) and back to `false` in their `finally`.

## Project Constraints

- No unit tests, ever: no `*.test.ts(x)`, no `tests/` additions, no vitest config edits. `.agents/skills/*/SKILL.md` asks for module tests — the operator's global rule overrides it. Verification is the `check`/`verify` commands in this plan against the running dev server.
- Never commit, push, branch, stash, checkout or restore inside the run; the tree accumulates and the checkpoint happens after the run, outside this plan. A probe is undone by deleting what it created through the API, never through git.
- The dev server is two systemd units (`cloudcli-server-dev` on 127.0.0.1:3011, `cloudcli-client-dev` on :5183). Never restart either by hand and never run `npm run dev`/`server:dev`. Every save under `server/` restarts the API through `tsx watch` (1-2 s) and drops live Claude runs: make ALL server edits of a phase in one consecutive pass, file after file, without running typecheck or curl between them; run checks only after the last server file is saved. Vite reloads `src/` instantly.
- Backend law (`.agents/skills/backend-module-standards/SKILL.md`): TypeScript only under `server/modules/`, imports across modules only through the module's `index.ts`, `@/` alias with `.js` suffix, `type` over `interface`, routes parse and delegate only, exports at declaration with a consumer comment. Frontend law (`.agents/skills/frontend-module-standards/SKILL.md`): `@/...` imports only (no `../`), `type` never `interface`, shared types in `src/shared/types.ts`, shared hooks in `src/shared/hooks/`, module-private hooks in `src/modules/<feature>/hooks/`, a comment above every new state declaration, a consumer comment on every exported component, `import type` for types.
- Module size (operator-global doctrine; this repo has no CLAUDE.md of its own): default ceiling 300 LOC per new file; never add more than ~40 lines to a file already over 300 (`provider.routes.ts` 908, `sessions.service.ts` 663, `sessions.db.ts` 714, `useChatComposerState.ts` 1258, `SidebarContent.tsx` 696, `SidebarHeader.tsx` 285, `Sidebar.tsx` 348). Split a NEW file by cohesion before it passes 300. `provider.routes.ts` is already over the 800 hard ceiling: this plan adds a handful of lines to it and names it as the next split, outside this plan.
- `npm run typecheck` must exit 0 and `npm run lint` must exit 0 with at most 123 warnings (re-measured 2026-09-08 on the live tree; `.verify/baseline.txt` still says 130 and is stale). The count moved 122 → 123 while Phase 2 ran because a CONCURRENT session added `RunningSessionsContext` to `src/shared/context/SessionProtectionContext.tsx` (+2 warnings: `only-export-components`, `set-state-in-effect`) and deleted `src/modules/sidebar/hooks/useGitHubStars.ts` (−1). None of the three are this plan's files. The ratchet still binds: a change of THIS plan's may lower the count, never raise it.
- Every user-facing string is an i18n key present in all 11 locales (`de en es fr it ja ko ru tr zh-CN zh-TW`); a key missing from a locale silently falls back to English, so parity is checked mechanically in this plan — over THIS PLAN'S OWN KEYS, never whole-file. Measured 2026-09-08: every non-English locale already misses keys that predate this plan (`settings.json` 17-84 each — `voiceSettings.*`, `pluginSettings.*`, `mcpServers.*`, `notifications.desktop.*`, `agents.authStatus.*`; `sidebar.json` 6-14 each), so a whole-file `diff` can never come back clean and would block every phase that adds a string.
- Healed means deleted: no commented-out code, no "old" variants, no compatibility shims.
- Standing stop rule: when reality diverges from this plan — a file or symbol not where an anchor says, a signature that differs, a check failing for a reason the plan did not name — stop, report the divergence verbatim with `RESULT: BLOCKED`, and do not improvise a fix.

## Phase 1 — Server: tagged insert and the simple-list filter on the recents feed
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "sonnet"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "server/modules/database/schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/database/repositories/sessions.db.ts",
  "server/modules/providers/services/sessions.service.ts",
  "server/modules/providers/provider.routes.ts",
  "server/modules/providers/README.md",
]
forbidden = [
  "server/modules/providers/services/sessions-watcher.service.ts",
  "server/modules/providers/services/session-synchronizer.service.ts",
  "server/modules/websocket",
  "server/modules/providers/index.ts",
  "server/modules/database/index.ts",
  "src",
]
athena = [
  "createAppSession binds a JavaScript boolean into better-sqlite3 (which throws) instead of 1/0, or writes simple_list_at through a JS Date string that sorts differently from CURRENT_TIMESTAMP",
  "GET /sessions/recent WITHOUT the flag now filters or re-orders (the tree's recents mode must be byte-identical), or the COUNT query and the SELECT no longer share the same visibility clause so total disagrees with the rows",
  "getRecentSessionsPage was cloned into a second function instead of taking an option, or SESSION_ROW_COLUMNS was not extended so a SELECT that lists columns drops simple_list_at",
  "The migration is not idempotent on the live database (runs ALTER TABLE on every boot) or is missing from SESSIONS_TABLE_SCHEMA_SQL so a fresh install lacks the column",
  "A POST body with simpleList as the string 'true' or 1 is accepted as tagged (only the boolean true may tag), or the recent route accepts simpleList=yes as true",
  "The watcher's createSession upsert or assignProviderSessionId merge path was edited and now nulls simple_list_at on an existing row",
]

[[steps]]
kind = "edit"
path = "server/modules/database/schema.ts"
what = "Add `simple_list_at DATETIME,` to SESSIONS_TABLE_SCHEMA_SQL directly after `forked_from_session_id TEXT,` (Interfaces, sessions table), with the same one-line comment style its neighbours use."
check = "grep -c 'simple_list_at DATETIME' server/modules/database/schema.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/database/migrations.ts"
what = "Add addSimpleListAtColumn(db) cloned from addForkedFromSessionIdColumn (line 428-431) with column 'simple_list_at' type 'DATETIME'; call it right after addForkedFromSessionIdColumn(db) inside runMigrations; add the idx_sessions_simple_list_at index line beside idx_sessions_is_archived (Interfaces, sessions table)."
check = "echo $(grep -c 'addSimpleListAtColumn' server/modules/database/migrations.ts) $(grep -c 'idx_sessions_simple_list_at ON sessions(simple_list_at)' server/modules/database/migrations.ts)"
expect = "2 1"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/sessions.db.ts"
what = "Extend SessionRow and SESSION_ROW_COLUMNS with simple_list_at; add the 5th parameter simpleList = false to createAppSession and write simple_list_at via CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END bound with simpleList ? 1 : 0; give getRecentSessionsPage the 3rd parameter options: { simpleListOnly?: boolean } = {} and, when set, extend its visibilityClause with AND sessions.simple_list_at IS NOT NULL and switch the ORDER BY to sessions.simple_list_at DESC, sessions.session_id DESC per Interfaces. No second page function."
check = "echo $(awk '/simple_list_at/{n++} END{print (n>=5)?\"db-ok\":\"db-short \" n}' server/modules/database/repositories/sessions.db.ts) $(grep -c 'getSimpleListSessionsPage' server/modules/database/repositories/sessions.db.ts) $(grep -c 'simpleListOnly' server/modules/database/repositories/sessions.db.ts)"
expect_re = "^db-ok 0 [1-9]$"

[[steps]]
kind = "edit"
path = "server/modules/providers/services/sessions.service.ts"
what = "Add simpleList: boolean to CreateAppSessionResult; add the 4th parameter simpleList = false to createAppSession, pass it to sessionsDb.createAppSession and echo it; give listRecentSessions (line 145-171) the 3rd parameter options: { simpleListOnly?: boolean } = {} and pass it through to sessionsDb.getRecentSessionsPage. The mapper and page shape do not change; no second list function."
check = "echo $(grep -c 'simpleListOnly' server/modules/providers/services/sessions.service.ts) $(grep -c 'listSimpleListSessions' server/modules/providers/services/sessions.service.ts) $(grep -c 'simpleList' server/modules/providers/services/sessions.service.ts | awk '{print ($1>=3)?\"ok\":\"short\"}')"
expect_re = "^[1-9] 0 ok$"

[[steps]]
kind = "edit"
path = "server/modules/providers/provider.routes.ts"
what = "In POST /sessions parse `const simpleList = body.simpleList === true;` and pass it as the 4th argument to sessionsService.createAppSession; in GET /sessions/recent parse `const simpleListOnly = parseOptionalBooleanQuery(req.query.simpleList, 'simpleList') ?? false;` and pass `{ simpleListOnly }` as the 3rd argument to sessionsService.listRecentSessions. Add NO new route."
check = "echo $(grep -c 'req.query.simpleList' server/modules/providers/provider.routes.ts) $(grep -c \"'/sessions/simple-list'\" server/modules/providers/provider.routes.ts) $(grep -c 'body.simpleList === true' server/modules/providers/provider.routes.ts)"
expect = "1 0 1"

[[steps]]
kind = "edit"
path = "server/modules/providers/README.md"
what = "Document the optional simpleList boolean on POST /api/providers/sessions (tags the row for the simple chat list) and the optional simpleList=true query on GET /api/providers/sessions/recent (tagged rows only, creation order), in the section that lists the session routes; two or three lines, no new section."
check = "grep -c 'simpleList' server/modules/providers/README.md"
expect_re = "^[1-9]$"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = "npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL"
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = "npm run lint 2>&1 | grep -c ': warning ' | awk '{print ($1<=123)?\"LINT_OK\":\"LINT_UP \"$1}'"
expect = "LINT_OK"
timeout_s = 300

[[verify]]
cmd = "sleep 4; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3011/api/auth/status"
expect = "200"

[[verify]]
cmd = "node -e \"const D=require('better-sqlite3');const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const cols=db.prepare('pragma table_info(sessions)').all().map(c=>c.name);const idx=db.prepare(\\\"select name from sqlite_master where type='index' and name='idx_sessions_simple_list_at'\\\").get();console.log('column='+cols.includes('simple_list_at')+' index='+Boolean(idx))\""
expect = "column=true index=true"

[[verify]]
cmd = '''
API=http://127.0.0.1:3011
TOKEN=$(curl -s -X POST $API/api/auth/login -H 'content-type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | jq -r .token)
H="authorization: Bearer $TOKEN"
P=/home/lyphe/.claude/claudecodeui_lyphe
A=$(curl -s -X POST $API/api/providers/sessions -H "$H" -H 'content-type: application/json' -d "{\"provider\":\"claude\",\"projectPath\":\"$P\",\"initialMessage\":\"simple-list probe tagged\",\"simpleList\":true}" | jq -r .data.sessionId)
B=$(curl -s -X POST $API/api/providers/sessions -H "$H" -H 'content-type: application/json' -d "{\"provider\":\"claude\",\"projectPath\":\"$P\",\"initialMessage\":\"simple-list probe plain\",\"simpleList\":\"true\"}" | jq -r .data.sessionId)
node -e "const D=require('better-sqlite3');const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const g=id=>db.prepare('select simple_list_at from sessions where session_id=?').get(id);const a=g('$A'),b=g('$B');console.log('tagged='+Boolean(a&&a.simple_list_at!==null)+' plain='+Boolean(b&&b.simple_list_at===null))"
curl -s "$API/api/providers/sessions/recent?simpleList=true&limit=20&offset=0" -H "$H" | jq -r --arg a "$A" --arg b "$B" '.data as $d | "first=\($d.conversations[0].sessionId==$a) plainAbsent=\(([$d.conversations[].sessionId]|index($b))==null) name=\($d.conversations[0].projectDisplayName) total=\($d.total|type) hasMore=\($d.hasMore|type)"'
curl -s "$API/api/providers/sessions/recent?limit=100&offset=0" -H "$H" | jq -r --arg a "$A" --arg b "$B" '"treeListsBoth=\((([.data.conversations[].sessionId]|index($a))!=null) and (([.data.conversations[].sessionId]|index($b))!=null))"'
curl -s "$API/api/providers/sessions/recent?simpleList=true&limit=1&offset=0" -H "$H" | jq -r '"page1=\(.data.conversations|length) hasMoreType=\(.data.hasMore|type)"'
curl -s -o /dev/null -X DELETE "$API/api/providers/sessions/$A" -H "$H"
ABS=$(curl -s "$API/api/providers/sessions/recent?simpleList=true&limit=20&offset=0" -H "$H" | jq -r --arg a "$A" '([.data.conversations[].sessionId]|index($a))==null')
node -e "const D=require('better-sqlite3');const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const r=db.prepare('select isArchived, simple_list_at from sessions where session_id=?').get('$A');console.log('afterArchive absent=$ABS isArchived='+r.isArchived+' stillTagged='+(r.simple_list_at!==null))"
curl -s -o /dev/null -X DELETE "$API/api/providers/sessions/$A?force=true" -H "$H"
curl -s -o /dev/null -X DELETE "$API/api/providers/sessions/$B?force=true" -H "$H"
node -e "const D=require('better-sqlite3');const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});console.log('residue='+db.prepare('select count(*) c from sessions where session_id in (?,?)').get('$A','$B').c)"
'''
expect = """tagged=true plain=true
first=true plainAbsent=true name=claudecodeui_lyphe total=number hasMore=boolean
treeListsBoth=true
page1=1 hasMoreType=boolean
afterArchive absent=true isArchived=1 stillTagged=true
residue=0"""
timeout_s = 120
```

**What to build.** Exactly the six server edits in Interfaces, in this order: `schema.ts`, `migrations.ts`, `sessions.db.ts`, `sessions.service.ts`, `provider.routes.ts`, `README.md`. Save them one after another with nothing in between — each save restarts the API under `tsx watch`; six restarts in a row cost seconds, a restart mid-curl costs you a false failure. Then run the two mechanical steps and the verify block. The three big files (`sessions.db.ts` 714, `sessions.service.ts` 663, `provider.routes.ts` 908) each gain a few lines only: an option threaded through the feed that already exists. They are named as split candidates in the plan's report, not split here.

**Copy targets.** The migration: `migrations.ts:428-431` and the call at `:521`. The insert: `sessions.db.ts:175-192` — its SQL literal names nine columns; add `simple_list_at` as the tenth with its own `?`. The feed query: `sessions.db.ts:543-568` — the `visibilityClause` template literal is where the tag predicate goes, and the `ORDER BY` is the only other line that changes; build both from the option so the no-option SQL is unchanged character for character. The service mapper: `sessions.service.ts:145-171` — note `sessionTitle` is `custom_name?.trim() || session_id`; app-minted sessions always have a `custom_name` (built from the first message by `buildCloudCliSessionName`), which is why "custom_name or summary" is satisfied without reading a transcript. The route: `provider.routes.ts:747-755`; `parseBoundedIntegerQuery` is a local helper at `:378-395` and `parseOptionalBooleanQuery` at `:65`, neither a shared util.

**Sirens.** You will want to clone `getRecentSessionsPage` into `getSimpleListSessionsPage` and `listRecentSessions` into `listSimpleListSessions` and add `GET /sessions/simple-list` — do not: that is three copies of one visibility clause and one mapper, and the archived-project rule would have to be kept in sync by hand forever. One feed, one option. You will see `createSession` (the watcher's upsert, `sessions.db.ts:83-164`) and `assignProviderSessionId` (`:252-287`) and want to teach them about the new column. Do not: neither SET list names it, so an existing row's `simple_list_at` survives every disk resync untouched, and that is the property the feature depends on. You will see `createForkedSession` (`:202-241`) and wonder whether a fork should be tagged. It is not: forks are a tree-view action; leave it. You will notice the barrel comment on `sessionsService` in `modules/providers/index.ts` undersells its consumers; leave it — the barrel is not in your manifest. You will be tempted to type the `chat.send` frame or read `simpleList` off the websocket frame; the row is minted by the POST before any frame exists, so the flag lives on the POST body only. The verify block posts `"simpleList":"true"` (a string) for the plain row on purpose: only boolean `true` tags. `git` is not an act in this phase: the tree accumulates.

**Defaults taken, with reversal.** Sort key = `simple_list_at DESC` (creation order, so rows do not jump while a chat runs); reversal is one `ORDER BY` branch back to `COALESCE(updated_at, created_at)`. Default page size stays the route's 40; the client asks for 20 (reversal: the client argument). Column type `DATETIME` written by `CURRENT_TIMESTAMP` (reversal: none needed — the client never parses it).

## Phase 2 — Client data layer: preference keys, the shared hook, api and the composer tag
Depends on: none

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "sonnet"
code_change = true
doc_sweep = "background"
expected_s = 2400
manifest = [
  "src/shared/userSettings.ts",
  "src/shared/hooks/useSimpleChatListPreferences.ts",
  "src/shared/api.ts",
  "src/modules/chat/hooks/useChatComposerState.ts",
]
forbidden = [
  "src/shared/uiPreferences.ts",
  "src/shared/context/UiPreferencesContext.tsx",
  "src/modules/git-panel",
]
athena = [
  "The two keys were folded into the uiPreferences blob (one stored row, a boolean-only reducer) instead of being flat keys, so a PATCH from Settings drops the other six booleans or the projectId is coerced",
  "The hook returns a fresh object from its snapshot getter so useSyncExternalStore re-renders on every store notification, or it reads once at mount and never subscribes",
  "The composer sends simpleList: true on every createSession call regardless of the preference, or the git-delegation startRun path now tags its sessions",
  "readUserPreference's stored false is treated as absent and the fallback true wins, so turning the toggle off never sticks",
  "LEGACY_STORAGE_KEYS was not extended, so PREFERENCE_KEYS omits the keys and hydration never reconciles them",
  "recentConversations serializes simpleList=false (or a new helper was added) so the tree's recents request URL changed",
  "readLegacyPreference calls localStorage.getItem(null) or throws for the two null-keyed preferences instead of returning undefined",
  "The builder's OWN diff touches src/shared/types.ts (a SimpleListConversation or any new row type belongs nowhere — the rows ARE RecentConversationListItem) or any path under server/ — read the diff, not the working tree: another session writes this repo concurrently and the arbiter serialises those writes, so a foreign change to either path is not this phase's and is not a finding",
]

[[steps]]
kind = "edit"
path = "src/shared/userSettings.ts"
what = "Add simpleChatList: boolean and simpleChatProjectId: string | null to UserPreferences (line 18-29) and the two LEGACY_STORAGE_KEYS entries (line 54-65) per Interfaces; plus the `string | null` widening and the null guard in readLegacyPreference; nothing else in the file changes."
check = "echo $(grep -c 'simpleChatList' src/shared/userSettings.ts) $(grep -c 'simpleChatProjectId' src/shared/userSettings.ts)"
expect = "2 2"

[[steps]]
kind = "edit"
path = "src/shared/hooks/useSimpleChatListPreferences.ts"
what = "Create useSimpleChatListPreferences per Interfaces: two useSyncExternalStore reads over subscribeToUserPreferences/readUserPreference with fallbacks true and null, two setters over writeUserPreference, a consumer comment naming sidebar, settings and chat; under 60 lines."
check = "echo $(grep -c 'export function useSimpleChatListPreferences' src/shared/hooks/useSimpleChatListPreferences.ts) $(grep -c 'useSyncExternalStore' src/shared/hooks/useSimpleChatListPreferences.ts) $(grep -c 'createContext' src/shared/hooks/useSimpleChatListPreferences.ts) $(wc -l < src/shared/hooks/useSimpleChatListPreferences.ts | awk '{print ($1<=60)?\"small\":\"big\"}')"
expect_re = "^1 [1-9] 0 small$"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add simpleList?: boolean to the createSession payload type (line 303-306) and simpleList?: boolean to recentConversations' options (line 204-205), passing it into the existing query({ limit, offset, simpleList }) call per Interfaces. No new helper, no new endpoint path."
check = "echo $(grep -c 'simpleList?: boolean' src/shared/api.ts) $(grep -c 'sessions/simple-list' src/shared/api.ts)"
expect = "2 0"

[[steps]]
kind = "edit"
path = "src/modules/chat/hooks/useChatComposerState.ts"
what = "Call useSimpleChatListPreferences() at the hook's top level and pass simpleList: <enabled> inside the api.providers.createSession payload at line 754-758; no other change."
check = "echo $(grep -c 'useSimpleChatListPreferences' src/modules/chat/hooks/useChatComposerState.ts) $(grep -c 'simpleList' src/modules/chat/hooks/useChatComposerState.ts | awk '{print ($1>=1)?\"tagged\":\"untagged\"}') $(grep -c 'simpleList' src/modules/git-panel/hooks/git-delegation/startRun.ts)"
expect = "2 tagged 0"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = "npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL"
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = "npm run lint 2>&1 | grep -c ': warning ' | awk '{print ($1<=123)?\"LINT_OK\":\"LINT_UP \"$1}'"
expect = "LINT_OK"
timeout_s = 300

[[verify]]
cmd = "curl -s http://127.0.0.1:5183/src/shared/hooks/useSimpleChatListPreferences.ts | grep -c 'useSimpleChatListPreferences' | awk '{print ($1>=1)?\"VITE_SERVES_HOOK\":\"VITE_MISSING\"}'; curl -s http://127.0.0.1:5183/src/modules/chat/hooks/useChatComposerState.ts | grep -c 'simpleList' | awk '{print ($1>=1)?\"COMPOSER_TAGS\":\"COMPOSER_PLAIN\"}'"
expect = """VITE_SERVES_HOOK
COMPOSER_TAGS"""

[[verify]]
cmd = '''
API=http://127.0.0.1:3011
TOKEN=$(curl -s -X POST $API/api/auth/login -H 'content-type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | jq -r .token)
H="authorization: Bearer $TOKEN"
curl -s -o /dev/null -X PATCH $API/api/user/preferences -H "$H" -H 'content-type: application/json' -d '{"simpleChatList":false,"simpleChatProjectId":"4d94a97e-0e62-43ee-981a-0028fec301b9"}'
curl -s $API/api/user/preferences -H "$H" | jq -r '.preferences | "off=\(.simpleChatList) project=\(.simpleChatProjectId) shell=\(.uiPreferences.hideShellTab|type)"'
curl -s -o /dev/null -X PATCH $API/api/user/preferences -H "$H" -H 'content-type: application/json' -d '{"simpleChatList":true,"simpleChatProjectId":null}'
curl -s $API/api/user/preferences -H "$H" | jq -r '.preferences | "on=\(.simpleChatList) project=\(.simpleChatProjectId)"'
'''
expect = """off=false project=4d94a97e-0e62-43ee-981a-0028fec301b9 shell=boolean
on=true project=null"""
```

**What to build.** Four client edits, no server, no new types. The hook is the ONE reader of the two keys everywhere in `src/` from now on. The composer change is three lines: one import, one hook call at the top level of `useChatComposerState` (a hook, so calling a hook there is legal), one payload field. The `useChatComposerState.ts` file is 1258 lines; add nothing else to it.

**Copy targets.** The flat-key idiom: `src/modules/task-master/context/TasksSettingsContext.tsx:1-56` (imports and `readUserPreference('tasksEnabled', DEFAULT)`), but build a hook with `useSyncExternalStore`, not a context — the store already notifies synchronously (`writeUserPreference` updates the in-memory mirror, calls `notifyListeners()`, then debounces the server PATCH 400 ms; `userSettings.ts:156`, `:187`). The api idiom: `api.ts:204-205` (`recentConversations`) and the `query` helper at `:59-69`, which already drops `false` and `undefined`.

**Sirens.** You will see `uiPreferences.ts` and `UiPreferencesContext.tsx` and want to add the keys to that blob — do not: it is a boolean-only reducer stored as ONE row, and `simpleChatProjectId` is a string; the new keys are flat rows like `tasksEnabled` (both files are forbidden here). You will want a `SimpleListConversation` type in `src/shared/types.ts` — do not: the rows ARE `RecentConversationListItem`, and `types.ts` is forbidden here. You will see `startRun.ts:15` also calls `createSession` — leave it untagged. You will want a `getServerSnapshot` third argument; this is a Vite SPA with no SSR, omit it. You will be tempted to thread a "new-session origin" through `ProjectMainRegion → WorkspaceMain → ChatInterface`; the preference at mint time IS the origin (when it is on, the simple view is the only sidebar), so the three-line composer change is the whole wiring. `git` is not an act in this phase.

**Defaults taken, with reversal.** Tagging is decided by the preference value at the moment the composer mints the session (reversal: thread an explicit origin flag from `handleNewSession` through the `newSessionTrigger` prop chain, `useProjectsState.ts:1047-1060` → `ChatInterface.tsx:168`). The verify block parks the dev user's preference at `true`/`null` when done.

## Phase 3 — Settings: the toggle and the project picker
Depends on: Phase 2

```toml
[phase]
id = "3"
builder = "hephaestus"
model = "sonnet"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/modules/settings/tabs/AppearanceSettingsTab.tsx",
  "src/modules/settings/Settings.tsx",
  "src/modules/i18n/locales",
  ".verify/probe-simple-settings.mjs",
]
forbidden = [
  "src/modules/settings/hooks/useSettingsController.ts",
  "src/shared",
  "src/modules/sidebar",
  "server",
]
athena = [
  "The toggle writes through useSettingsController's debounced save (which never flushes on close) or through the uiPreferences blob instead of the shared hook's setter",
  "The Select lists project.displayName but writes displayName instead of project.name (the projectId), so the sidebar can never resolve it",
  "A locale is missing one of the five settings keys or carries the English text untranslated in a non-English locale other than a proper noun",
  "Settings.tsx passes projects to AgentsSettingsTab only, so the new picker renders an empty Select on the real app",
  "The probe asserts what it typed rather than what the server stored (it must read GET /api/user/preferences after each change)",
  "The existing Appearance labels phase-4.mjs clicks by English text (Dark Mode, Tabs in the workspace, Hide the Shell tab) were re-worded",
]

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/settings.json"
what = "Add appearance.sidebar.title, appearance.sidebar.simpleChatList.label/description and appearance.sidebar.simpleChatProject.label/description with the en values from Interfaces, next to appearance.workspaceTabs."
check = "jq -r '.appearance.sidebar | [.title, .simpleChatList.label, .simpleChatProject.label] | join(\"|\")' src/modules/i18n/locales/en/settings.json"
expect = "Sidebar|Simple chat list|Project for new chats"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/de/settings.json"
what = "Add the same five appearance.sidebar keys, translated, to de, es, fr, it, ja, ko, ru, tr, zh-CN and zh-TW settings.json (ten files) so every locale carries the identical key set."
check = "for loc in de es fr it ja ko ru tr zh-CN zh-TW; do for k in title simpleChatList.label simpleChatList.description simpleChatProject.label simpleChatProject.description; do [ \"$(jq -r \".appearance.sidebar.$k // \\\"MISSING\\\"\" src/modules/i18n/locales/$loc/settings.json)\" = MISSING ] && echo \"MISSING $loc $k\"; done; done; echo PARITY_CHECKED"
expect = "PARITY_CHECKED"

[[steps]]
kind = "edit"
path = "src/modules/settings/Settings.tsx"
what = "Pass projects={projects} to AppearanceSettingsTab exactly as AgentsSettingsTab receives it at line 194."
check = "grep -n 'AppearanceSettingsTab' src/modules/settings/Settings.tsx | grep -c 'projects='"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/settings/tabs/AppearanceSettingsTab.tsx"
what = "Add the projects prop and the Sidebar SettingsSection with the SettingsToggle for simpleChatList and the shared Select for simpleChatProjectId, reading and writing through useSimpleChatListPreferences, per Interfaces; keep the file under 170 lines."
check = "echo $(grep -c 'useSimpleChatListPreferences' src/modules/settings/tabs/AppearanceSettingsTab.tsx) $(grep -c 'appearance.sidebar.simpleChatList.label' src/modules/settings/tabs/AppearanceSettingsTab.tsx) $(grep -c 'appearance.sidebar.simpleChatProject.label' src/modules/settings/tabs/AppearanceSettingsTab.tsx) $(wc -l < src/modules/settings/tabs/AppearanceSettingsTab.tsx | awk '{print ($1<=170)?\"small\":\"big\"}')"
expect_re = "^2 [1-9] [1-9] small$"

[[steps]]
kind = "edit"
path = ".verify/probe-simple-settings.mjs"
what = "Write the Playwright probe described in the phase body: opens the console, goes to Settings > Appearance, flips the Simple chat list switch off, picks the claudecodeui_lyphe project, reads GET /api/user/preferences after each change, prints [PASS]/[FAIL] lines and ends with PROBE_SETTINGS_DONE."
check = "echo $(grep -c 'PROBE_SETTINGS_DONE' .verify/probe-simple-settings.mjs) $(grep -c 'openConsole' .verify/probe-simple-settings.mjs)"
expect_re = "^[1-9] [1-9]$"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = "npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL"
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = "npm run lint 2>&1 | grep -c ': warning ' | awk '{print ($1<=123)?\"LINT_OK\":\"LINT_UP \"$1}'"
expect = "LINT_OK"
timeout_s = 300

[[verify]]
cmd = "node .verify/probe-simple-settings.mjs 2>&1 | tail -40"
expect_re = "(?s)\\A(?!.*\\[FAIL\\]).*\\[PASS\\] switch off stored.*\\[PASS\\] project stored.*PROBE_SETTINGS_DONE"
timeout_s = 240

[[verify]]
cmd = '''
API=http://127.0.0.1:3011
TOKEN=$(curl -s -X POST $API/api/auth/login -H 'content-type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | jq -r .token)
H="authorization: Bearer $TOKEN"
# SELF-SUFFICIENT, deliberately: this block asserts nothing about what the probe left
# behind. That the UI's own write reaches the server is gate 9 of probe-simple-settings
# ("project stored", read back from GET /api/user/preferences), which the verify above
# enforces by regex. This one proves the store round-trips BOTH keys and then parks the
# account for Phase 4 — the probe resets the pair at its start and Athena re-runs it during
# her passes, so any assertion here about residue is a coin flip, not a measurement.
curl -s -o /dev/null -X PATCH $API/api/user/preferences -H "$H" -H 'content-type: application/json' -d '{"simpleChatList":true,"simpleChatProjectId":"4d94a97e-0e62-43ee-981a-0028fec301b9"}'
curl -s $API/api/user/preferences -H "$H" | jq -r '.preferences | "enabled=\(.simpleChatList) project=\(.simpleChatProjectId)"'
curl -s -o /dev/null -X PATCH $API/api/user/preferences -H "$H" -H 'content-type: application/json' -d '{"simpleChatList":false,"simpleChatProjectId":null}'
curl -s $API/api/user/preferences -H "$H" | jq -r '.preferences | "parked=\(.simpleChatList) parkedProject=\(.simpleChatProjectId)"'
'''
expect = """enabled=true project=4d94a97e-0e62-43ee-981a-0028fec301b9
parked=false parkedProject=null"""

[[verify]]
cmd = "for loc in de es fr it ja ko ru tr zh-CN zh-TW; do for v in title simpleChatList.label simpleChatProject.label; do t=$(jq -r \".appearance.sidebar.$v\" src/modules/i18n/locales/$loc/settings.json); e=$(jq -r \".appearance.sidebar.$v\" src/modules/i18n/locales/en/settings.json); [ -n \"$t\" ] && [ \"$t\" != null ] || echo \"EMPTY $loc $v\"; [ \"$t\" != \"$e\" ] || echo \"UNTRANSLATED $loc $v\"; done; done; echo LOCALES_CHECKED"
expect = "LOCALES_CHECKED"
```

**What to build.** One new section in the Appearance tab (the tab that already owns the sidebar-adjacent "Tabs in the workspace" group and the project sort order), one prop pass in `Settings.tsx`, five keys in eleven locale files, and the probe. The toggle and the picker read and write ONLY through `useSimpleChatListPreferences()` from Phase 2; the file's existing `useUiPreferences`/`useSetUiPreference` pair stays for `hideShellTab` and is not touched.

**Copy targets.** The switch row: `AppearanceSettingsTab.tsx:58-67` (`SettingsRow` + `SettingsToggle` with `ariaLabel` = the label). The styled dropdown: `src/modules/settings/tabs/agents-settings/sections/content/EditModeContent.tsx:88-93` (`<Select ariaLabel value options onChange />`, `src/shared/ui/Select.tsx:7-14`) — NOT the native `<select>` the sort-order control at `:93-100` uses. The projects prop: `Settings.tsx:25` (`projects?: AgentSettingsProject[]`) and `:194`. The probe skeleton: `.verify/phase-4.mjs:18` (imports), `:40-47` (ok/note), `:57-59` (`settingsTab`, `switchFor` — re-declare them locally, they are not exported), `:139` (`openConsole`), `:176-177` (open Settings, click Appearance), `:277-278` (read prefs through `session.api`), `:501-503` (`finally` close), `:529-530` (print).

**The probe, gate by gate** (`.verify/probe-simple-settings.mjs`, zero Claude turns): (1) `openConsole({ dark: false })`; (2) `openSettings`, click the `Appearance` rail row, assert `switchFor(page, 'Simple chat list')` exists and reads `aria-checked="true"` when `GET /api/user/preferences` has no `simpleChatList` key or `true`, else matches the stored value; (3) click it, wait 900 ms (the store debounces its PATCH 400 ms), read `GET /api/user/preferences` through `session.api` and print `[PASS] switch off stored` when `.preferences.simpleChatList === false`; (4) open the Select whose `aria-label` is `Project for new chats`, assert its option count equals the length of `GET /api/projects`, choose the option labelled `claudecodeui_lyphe`, wait 900 ms, read prefs and print `[PASS] project stored` when `.preferences.simpleChatProjectId === '4d94a97e-0e62-43ee-981a-0028fec301b9'`; (5) `shoot('17-settings-sidebar')`; (6) `closeSettings`; print results; last line `PROBE_SETTINGS_DONE`. The probe leaves the switch OFF and the project set; the second verify entry reads those values independently, then parks the account at `false`/`null` (the harness account stays on the tree until Phase 4's probe flips it itself).

**Sirens.** You will see `useSettingsController.ts` and its 500 ms auto-save and want to route the toggle through `updateSetting`; do not — that hook governs permissions and notification preferences, not these keys, and it is forbidden here. You will want to store `displayName` in the preference for readability; store `project.name` (the projectId) — the sidebar resolves the display name from `projects`. You will want to seed a default project id when the preference is null; leave it null — the sidebar falls back to the first project at render time. Do not re-word any existing Appearance label. `git` is not an act in this phase.

**Defaults taken, with reversal.** Section placement: after "Tabs in the workspace", before the sort-order row (reversal: move one JSX block). Options sorted by display name (reversal: drop the sort). Picker value `''` with placeholder when the preference is null (reversal: pre-select the first option).

## Phase 4 — Sidebar: the simple view, its two hooks, i18n and the harness parking
Depends on: Phase 1, Phase 2, Phase 3

```toml
[phase]
id = "4"
builder = "hephaestus"
model = "sonnet"
code_change = true
doc_sweep = "background"
expected_s = 3000
manifest = [
  "src/modules/sidebar/SidebarSimpleList.tsx",
  "src/modules/sidebar/SidebarSimpleListRow.tsx",
  "src/modules/sidebar/SidebarSimpleStopDialog.tsx",
  "src/modules/sidebar/hooks/useSimpleChatList.ts",
  "src/modules/sidebar/hooks/useSimpleChatRemove.ts",
  "src/modules/sidebar/SidebarContent.tsx",
  "src/modules/sidebar/SidebarHeader.tsx",
  "src/modules/sidebar/Sidebar.tsx",
  "src/modules/i18n/locales",
  ".verify/lib/console.mjs",
  ".verify/probe-simple-view.mjs",
]
forbidden = [
  "src/modules/sidebar/SidebarCollapsed.tsx",
  "src/modules/sidebar/SidebarProjectList.tsx",
  "src/modules/sidebar/SidebarProjectItem.tsx",
  "src/modules/sidebar/SidebarProjectSessions.tsx",
  "src/modules/sidebar/SidebarSessionItem.tsx",
  "src/modules/sidebar/SidebarRecentConversations.tsx",
  "src/modules/sidebar/hooks/useSidebarController.ts",
  "src/modules/project-workspace",
  "src/shared",
  "server",
  "docs",
]
athena = [
  "Selecting a row sets selectedSession without first calling onProjectSelect with the row's project (order must be project first, then session, mirroring Sidebar.tsx:299-322), so Files/Git/Shell keep the previous project",
  "The list shows pre-existing or untagged sessions because the component filters client-side from projects[].sessions instead of calling api.recentConversations with simpleList: true",
  "Remove on an idle row opens the stop dialog anyway, or the archive fires while the busy set still holds the id, or the stop path never sends chat.abort with the row's sessionId",
  "useSimpleChatRemove polls with setInterval or a ref instead of reacting to useBusySessionIdSet() in an effect, or its 15 s fallback timer is not cleared on unmount / on the busy-set success path so a late archive fires on a row already removed",
  "With no chat open, changing the dropdown does not call onProjectSelect, or it calls it in a loop (effect depends on the wrong values) or while a chat IS open",
  "Simple mode still renders the search field or the four chips (simpleMode was not folded into showSearchTools), or hides the collapse/refresh controls or the footer with the settings gear, or SidebarCollapsed changed",
  "openConsole in console.mjs no longer parks simpleChatList at false before waiting for PROJECT_ROW, so every older phase hangs",
  "A new file exceeds its ceiling (list 200, row 200, hook 170, remove hook 150, dialog 80), or SidebarContent/SidebarHeader/Sidebar grew by more than ~40 lines each",
  "A locale is missing one of the twelve sidebar keys",
  "SidebarContent imports SidebarSimpleList or a type from it (the slot exists so the body composer stays ignorant of the mode), or SidebarSimpleListProps is exported or declared anywhere but SidebarSimpleList.tsx",
  "On mobile, removing the OPEN chat whose project differs from the dropdown project fires the follow effect and closes the drawer (app handleProjectSelect sets sidebarOpen false) — measured, not assumed: the effect must fire at most once per selectedSession transition and never while a chat is open",
]

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/sidebar.json"
what = "Add the twelve simpleList.* keys with the en values from Interfaces, then the same keys translated in de, es, fr, it, ja, ko, ru, tr, zh-CN and zh-TW sidebar.json."
check = "jq -r '.simpleList | [.newChat, .remove, .stopTitle, .stopConfirm] | join(\"|\")' src/modules/i18n/locales/en/sidebar.json; for loc in de es fr it ja ko ru tr zh-CN zh-TW; do for k in project newChat empty loadMore rename renamePlaceholder remove running stopTitle stopBody stopConfirm removeFailed; do [ \"$(jq -r \".simpleList.$k // \\\"MISSING\\\"\" src/modules/i18n/locales/$loc/sidebar.json)\" = MISSING ] && echo \"MISSING $loc $k\"; done; done; echo PARITY_CHECKED"
expect = """New chat|Remove|This chat is still running|Stop and remove
PARITY_CHECKED"""

[[steps]]
kind = "edit"
path = "src/modules/sidebar/hooks/useSimpleChatList.ts"
what = "Create useSimpleChatList(selectedSessionId) per Interfaces: paginated fetch through api.recentConversations({ limit, offset, simpleList: true }), reload on mount / session_upserted (debounced 500 ms, via useWebSocket().subscribe) / a selected id missing from rows, loadMore, renameLocal, removeLocal; rows typed RecentConversationListItem; a comment above every state declaration; under 170 lines."
check = "echo $(grep -c 'export function useSimpleChatList' src/modules/sidebar/hooks/useSimpleChatList.ts) $(grep -c 'session_upserted' src/modules/sidebar/hooks/useSimpleChatList.ts) $(grep -c 'simpleList: true' src/modules/sidebar/hooks/useSimpleChatList.ts) $(grep -c 'RecentConversationListItem' src/modules/sidebar/hooks/useSimpleChatList.ts) $(wc -l < src/modules/sidebar/hooks/useSimpleChatList.ts | awk '{print ($1<=170)?\"small\":\"big\"}')"
expect_re = "^1 [1-9] [1-9] [1-9] small$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/hooks/useSimpleChatRemove.ts"
what = "Create useSimpleChatRemove({ onArchived }) per Interfaces: pendingStop / awaiting-idle / failedSessionId state (each with its comment), remove(row) (idle → archive now; busy → pendingStop), confirmStop() (sendMessage chat.abort, mark awaiting), cancelStop(), ONE effect on [busySessionIds, awaitingId] that archives when the busy set drops the id, ONE 15 s fallback timeout cleared on unmount and on success, named STOP_TIMEOUT_MS with a comment that it mirrors the constant of the same name in src/modules/chat/hooks/useRestartOnInstalledCli.ts — same guarantee (the only thing that ends a stop the gateway never answers), different outcome (archive anyway, not abandon), deliberately not hoisted to src/shared/constants.ts, archive() = api.deleteSession(id, false) then onArchived(id) or failedSessionId for 4 s; no setInterval, no ref polling; under 150 lines."
check = "echo $(grep -c 'export function useSimpleChatRemove' src/modules/sidebar/hooks/useSimpleChatRemove.ts) $(grep -c \"'chat.abort'\" src/modules/sidebar/hooks/useSimpleChatRemove.ts) $(grep -c 'deleteSession' src/modules/sidebar/hooks/useSimpleChatRemove.ts) $(grep -c 'useBusySessionIdSet' src/modules/sidebar/hooks/useSimpleChatRemove.ts) $(grep -c 'setInterval' src/modules/sidebar/hooks/useSimpleChatRemove.ts) $(wc -l < src/modules/sidebar/hooks/useSimpleChatRemove.ts | awk '{print ($1<=150)?\"small\":\"big\"}')"
expect_re = "^1 [1-9] [1-9] [1-9] 0 small$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleList.tsx"
what = "Create SidebarSimpleList (props per Interfaces): composes useSimpleChatList and useSimpleChatRemove; the project Select + New chat strip, the rows via SidebarSimpleListRow, empty state, Show more, the dropdown-follow effect, and SidebarSimpleStopDialog bound to the remove hook's pendingStop/confirmStop/cancelStop; every data-testid from Interfaces; no chat.abort and no deleteSession in this file; under 200 lines."
check = "echo $(grep -c 'data-testid=\"simple-chat-list\"' src/modules/sidebar/SidebarSimpleList.tsx) $(grep -c 'simple-chat-new' src/modules/sidebar/SidebarSimpleList.tsx) $(grep -c 'simple-chat-project' src/modules/sidebar/SidebarSimpleList.tsx) $(grep -c 'simple-chat-empty' src/modules/sidebar/SidebarSimpleList.tsx) $(grep -c 'useSimpleChatRemove' src/modules/sidebar/SidebarSimpleList.tsx) $(grep -c \"'chat.abort'\" src/modules/sidebar/SidebarSimpleList.tsx) $(grep -c 'deleteSession' src/modules/sidebar/SidebarSimpleList.tsx) $(wc -l < src/modules/sidebar/SidebarSimpleList.tsx | awk '{print ($1<=200)?\"small\":\"big\"}')"
expect_re = "^1 [1-9] [1-9] [1-9] [1-9] 0 0 small$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleListRow.tsx"
what = "Create SidebarSimpleListRow: link to /session/:id carrying data-testid simple-chat-row and data-session-id, title, muted project label, spinner (simple-chat-running) when running, ActionMenu (simple-chat-menu) with Rename (simple-chat-rename) and Remove (simple-chat-remove), inline rename input (simple-chat-rename-input) saved on Enter and cancelled on Escape, the removeFailed line when the row's id is failedSessionId; 44 px tap target when useCompactSidebar() is true; under 200 lines."
check = "echo $(grep -c 'simple-chat-row' src/modules/sidebar/SidebarSimpleListRow.tsx) $(grep -c 'simple-chat-running' src/modules/sidebar/SidebarSimpleListRow.tsx) $(grep -c 'simple-chat-rename-input' src/modules/sidebar/SidebarSimpleListRow.tsx) $(grep -c 'simple-chat-remove' src/modules/sidebar/SidebarSimpleListRow.tsx) $(wc -l < src/modules/sidebar/SidebarSimpleListRow.tsx | awk '{print ($1<=200)?\"small\":\"big\"}')"
expect_re = "^[1-9] [1-9] [1-9] [1-9] small$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleStopDialog.tsx"
what = "Create SidebarSimpleStopDialog on the shared Dialog/DialogContent/DialogTitle: title simpleList.stopTitle, body simpleList.stopBody, a destructive confirm button (simple-chat-stop-confirm, label simpleList.stopConfirm) and a cancel button (simple-chat-stop-cancel, label actions.cancel); root carries data-testid simple-chat-stop-dialog; under 80 lines."
check = "echo $(grep -c 'simple-chat-stop-dialog' src/modules/sidebar/SidebarSimpleStopDialog.tsx) $(grep -c 'simple-chat-stop-confirm' src/modules/sidebar/SidebarSimpleStopDialog.tsx) $(grep -c 'simple-chat-stop-cancel' src/modules/sidebar/SidebarSimpleStopDialog.tsx) $(grep -c 'createPortal' src/modules/sidebar/SidebarSimpleStopDialog.tsx)"
expect = "1 1 1 0"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarHeader.tsx"
what = "Add the optional simpleMode prop and fold it into the existing showSearchTools expression at line 103 (`&& !simpleMode`); do not add a second conditional — that one flag already gates the search input and SearchModeChips in both the desktop and the mobile block. Everything else in the header stays."
check = "echo $(grep -c 'simpleMode' src/modules/sidebar/SidebarHeader.tsx | awk '{print ($1>=2)?\"wired\":\"thin\"}') $(grep -n 'const showSearchTools' src/modules/sidebar/SidebarHeader.tsx | grep -c 'simpleMode') $(wc -l < src/modules/sidebar/SidebarHeader.tsx | awk '{print ($1<=300)?\"small\":\"big\"}')"
expect = "wired 1 small"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarContent.tsx"
what = "Add simpleList: ReactNode | null to SidebarContentProps; pass simpleMode={simpleList !== null} to SidebarHeader; render {simpleList} as the FIRST arm of the ScrollArea ternary (line 210), ahead of showConversationSearch, when non-null; footer untouched. Import nothing new: SidebarContent must not import SidebarSimpleList or any type from it."
check = "echo $(grep -c 'SidebarSimpleList' src/modules/sidebar/SidebarContent.tsx) $(grep -c 'simpleList' src/modules/sidebar/SidebarContent.tsx | awk '{print ($1>=3)?\"slotted\":\"thin\"}') $(grep -c 'simpleMode=' src/modules/sidebar/SidebarContent.tsx) $(wc -l < src/modules/sidebar/SidebarContent.tsx | awk '{print ($1<=740)?\"small\":\"big\"}')"
expect = "0 slotted 1 small"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/Sidebar.tsx"
what = "Read useSimpleChatListPreferences().enabled; import SidebarSimpleList; pass simpleList={enabled ? <SidebarSimpleList projects={projects} selectedProject={selectedProject} selectedSession={selectedSession} isMobile={isMobile} onProjectSelect={handleProjectSelect} onSessionSelect={handleSessionClick} onNewSession={onNewSession} onSessionRemoved={(id) => onSessionDelete?.(id)} onRenameSession={(id, s) => updateSessionSummary('', id, s, 'claude')} t={t} /> : null} to SidebarContent; SidebarCollapsed branch untouched."
check = "echo $(grep -c 'useSimpleChatListPreferences' src/modules/sidebar/Sidebar.tsx) $(grep -c '<SidebarSimpleList' src/modules/sidebar/Sidebar.tsx) $(grep -c 'simpleList=' src/modules/sidebar/Sidebar.tsx) $(wc -l < src/modules/sidebar/Sidebar.tsx | awk '{print ($1<=400)?\"small\":\"big\"}')"
expect = "2 1 1 small"

[[steps]]
kind = "edit"
path = ".verify/lib/console.mjs"
what = "In openConsole, after sign-in succeeds and before selectFirstProject waits for PROJECT_ROW, PATCH {simpleChatList:false} to /api/user/preferences with the page's own auth-token and reload the page; one helper, a comment saying why (simple mode is the default and hides PROJECT_ROW)."
check = "grep -c 'simpleChatList' .verify/lib/console.mjs | awk '{print ($1>=1)?\"parked\":\"unparked\"}'"
expect = "parked"

[[steps]]
kind = "edit"
path = ".verify/probe-simple-view.mjs"
what = "Write the mount probe described in the phase body: openConsole, PATCH simpleChatList true + reload, assert the simple view mounted and the tree/chips are gone, PATCH false + reload, assert the tree is back; [PASS]/[FAIL] lines, cleanup in finally, last line PROBE_VIEW_DONE."
check = "echo $(grep -c 'PROBE_VIEW_DONE' .verify/probe-simple-view.mjs) $(grep -c 'simple-chat-list' .verify/probe-simple-view.mjs) $(grep -c 'openConsole' .verify/probe-simple-view.mjs)"
expect_re = "^[1-9] [1-9] [1-9]$"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = "npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL"
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = "npm run lint 2>&1 | grep -c ': warning ' | awk '{print ($1<=123)?\"LINT_OK\":\"LINT_UP \"$1}'"
expect = "LINT_OK"
timeout_s = 300

[[verify]]
cmd = "node --input-type=module -e \"const m = await import('./.verify/lib/console.mjs'); const s = await m.openConsole(); const rows = await s.page.locator(m.PROJECT_ROW).count(); await s.browser.close(); console.log('OPEN_CONSOLE_OK rows=' + (rows > 0))\""
expect = "OPEN_CONSOLE_OK rows=true"
timeout_s = 180

[[verify]]
cmd = "node .verify/probe-simple-view.mjs 2>&1 | tail -30"
expect_re = "(?s)\\A(?!.*\\[FAIL\\]).*\\[PASS\\] simple mode hides tree and chips.*\\[PASS\\] simple list mounted.*\\[PASS\\] toggle off restores the tree.*PROBE_VIEW_DONE"
timeout_s = 240

[[verify]]
cmd = "for loc in de es fr it ja ko ru tr zh-CN zh-TW; do for k in project newChat empty loadMore rename renamePlaceholder remove running stopTitle stopBody stopConfirm removeFailed; do [ \"$(jq -r \".simpleList.$k // \\\"MISSING\\\"\" src/modules/i18n/locales/$loc/sidebar.json)\" = MISSING ] && echo \"MISSING sidebar $loc $k\"; done; done; echo PARITY_OK"
expect = "PARITY_OK"
```

**What to build.** Five new sidebar files (list, row, stop dialog, two hooks), three small edits to existing sidebar files, twelve keys in eleven locale files, the harness parking fix and a three-gate mount probe. The tree code is not touched: every file that renders the tree is forbidden. The existing controller is forbidden too — the simple view takes the six handlers it needs as props from `Sidebar.tsx`, where each is already in scope. The full behavioural harness (`phase-17.mjs`) and the docs are Phase 5's sitting, not this one's.

**How the pieces connect** (read these anchors before writing a line). The branch point: `Sidebar.tsx:249-342` renders `SidebarCollapsed` or `SidebarContent`; you add one prop to the latter. The row click MUST mirror `Sidebar.tsx:299-322`: `const project = projects.find(p => p.projectId === row.projectId)`; if found call `onProjectSelect(project)` FIRST, then `onSessionSelect({ id: row.sessionId, __provider: row.provider, __projectId: row.projectId }, project.projectId)`; if not found, call `onSessionSelect(sessionObj, row.projectId ?? '')` only. New chat: `onNewSession(effectiveProject)` — that is the app's `handleNewSession` (`useProjectsState.ts:1047-1060`: sets the project, clears the session, switches to the chat tab, bumps `newSessionTrigger`, navigates to `/`). The dropdown: options from `projects` sorted by `displayName`; effective project = the one whose `projectId` equals the preference, else `projects[0]`; `onChange` → `setProjectId`. The follow effect: `useEffect` on `[effectiveProject?.projectId, selectedSession?.id ?? null, selectedProject?.projectId ?? null]` — when `selectedSession` is null and `effectiveProject` exists and `selectedProject?.projectId !== effectiveProject.projectId`, call `onProjectSelect(effectiveProject)` once. Running: `useBusySessionIdSet()` from `@/shared/context/SessionProtectionContext` (`Sidebar.tsx:79` shows the import) — `busy.has(row.sessionId)` for the spinner. Remove lives entirely in `useSimpleChatRemove`: `remove(row)` → not busy → `archive`; busy → `pendingStop = row`; `confirmStop` → `sendMessage({ type: 'chat.abort', sessionId })` from `useWebSocket()` (`src/shared/context/WebSocketContext.tsx:28`, the frame shape at `useChatComposerState.ts:1121-1124`) and `awaitingId = sessionId`; the effect on `[busySessionIds, awaitingId]` calls `archive` the render after the busy set drops the id (the set is fed by `chat_subscribed`/`complete` frames and re-synced from `GET /sessions/running` every 5 s, so a run that ends for any reason is observed without polling); a `setTimeout` of 15 s set at confirm and cleared on success/unmount archives a hung run anyway. `archive(id)` = `const res = await api.deleteSession(id, false)` (`api.ts:196`); if `res.ok` → `onArchived(id)` (the list's `removeLocal` + the app's `handleSessionDelete`, `useProjectsState.ts:1062-1076`, which clears the selection and navigates home when it was the open chat); else `failedSessionId = id` for 4 s and the row shows `simpleList.removeFailed`. Rename: local edit state in the row; Enter → `onRenameSession(id, draft)` → then `renameLocal`. Empty state: `EmptyState` from `@/shared/ui` with `simpleList.empty`. The list template for markup and the "project · age" subtitle: `SidebarRecentConversations.tsx:102-160` (read it, do not edit it). The pager idiom — request-sequence ref, append dedupe by sessionId, total/hasMore/error — is `useSidebarController.ts:218-267` (read it, do not edit it): carry that guard verbatim; this hook is a second copy of that seam until the controller is split, and the two must stay recognisably one. Spinner markup: `SidebarSessionItem.tsx:461-474`. `ActionMenu` usage: `SidebarSessionItem.tsx:422-500`. `useCompactSidebar` at `hooks/useCompactSidebar.ts:30`.

**The mount probe, gate by gate** (`.verify/probe-simple-view.mjs`, zero Claude turns; skeleton from `.verify/probe-simple-settings.mjs` written in Phase 3, `SIDEBAR` from `phase-15.mjs:71`): (1) `openConsole({ dark: false })` — it parks the account on the tree; (2) `PATCH /api/user/preferences {"simpleChatList": true}` through `session.api`, `page.reload()`, wait for `[data-testid="simple-chat-list"]`; `[PASS] simple mode hides tree and chips` when `PROJECT_ROW` count is 0 AND `${SIDEBAR} button:has-text("Conversations")` count is 0 AND `${SIDEBAR} input[type="search"], ${SIDEBAR} input[placeholder]` count is 0 AND the settings gear (`SidebarFooter`'s `onShowSettings` button, `SidebarFooter.tsx:97-105`) is visible; (3) `[PASS] simple list mounted` when `[data-testid="simple-chat-new"]` and `[data-testid="simple-chat-project"]` are visible and EITHER `[data-testid="simple-chat-empty"]` is visible OR `[data-testid="simple-chat-row"]` count ≥ 1; `shoot('17-simple-mount')`; (4) `PATCH {"simpleChatList": false}`, reload; `[PASS] toggle off restores the tree` when `PROJECT_ROW` count ≥ 1 and `[data-testid="simple-chat-list"]` count is 0; (5) `finally`: `PATCH {"simpleChatList": false, "simpleChatProjectId": null}`, close; print results, last line `PROBE_VIEW_DONE`.

**Sirens.** You will want to filter `projects[].sessions` client-side instead of calling the endpoint — the endpoint is the only source that knows the tag; the tree's session arrays never carry it. You will want to reuse `showDeleteSessionConfirmation`/`confirmDeleteSession` from the controller for Remove — do not: that pair opens the archive-or-delete modal, and the controller is forbidden; the remove hook calls `api.deleteSession(id, false)` directly. You will want to put the remove flow in the component "because it is only forty lines" — it is state plus a frame plus an effect plus a timer, and the component's job is to render; keep it in `useSimpleChatRemove`. You will want to poll the busy set with `setInterval` — do not: React re-renders when the set changes, and an effect on it is the whole wait. You will want to reuse the raw `ReactDOM.createPortal` modal from `SidebarModals.tsx:150-198` — use the shared `Dialog` instead (the step check refuses `createPortal`). You will see `handleSessionClick` sets only the session and be tempted to set the project inside the hook — the order is project first, session second, from the row handler, exactly as `Sidebar.tsx:299-322`. You will see `SidebarSessionItem`'s rich compact bottom-sheet and want to port it — one row design at both widths, with the compact tap target, is the whole mobile story here. You will notice `.verify/phase-0.mjs` fails today on the renamed Source Control tab; that is pre-existing and not yours — note it in your report. `git` is not an act in this phase.

**Defaults taken, with reversal.** Search input hidden along with the chips in simple mode (reversal: keep the input and ignore `searchMode`). Rows for a project that is no longer in `projects` (archived project) are excluded by the server query, matching the recent list (reversal: drop the projects half of the visibility clause in Phase 1's query). The busy wait caps at 15 s and then archives regardless (reversal: the constant). `simple-chat-project` is the shared `Select` (reversal: a native `<select>` — the probe reads the option count either way, so it selects by visible label).

## Phase 5 — Proof of the flat list: new chat, rename, project-follow, idle remove, toggle-off
Depends on: Phase 4

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "sonnet"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  ".verify/phase-17.mjs",
  "docs/simple-chat-list.md",
  "docs/verification.md",
]
forbidden = [
  "src",
  "server",
  ".verify/lib/console.mjs",
  ".verify/probe-simple-view.mjs",
]
athena = [
  "phase-17 spends a Claude turn (an unsealed chat.send), or the canary is not re-proven after a reload",
  "phase-17 reads only what it typed instead of the server's list, the PUT/DELETE requests on the wire and the archived list",
  "The project-follow gate reads a /api/projects/<id>/ request that was already in flight before the row click, so a stale id passes",
  "The [PASS] names drift from the verify regex, or cleanup in finally skips an id that was created after a failed gate",
  "docs/simple-chat-list.md restates the route table or the preference store already documented elsewhere instead of cross-referencing (one canonical home per fact)",
]

[[steps]]
kind = "edit"
path = ".verify/phase-17.mjs"
what = "Write the phase-17 harness described in the phase body: seal, canary, simple mode on, empty state, dropdown, sealed New chat whose POST carries simpleList true, row appears, rename via PUT, project-follow via the Files tab request, idle Remove via DELETE without force, toggle off restores PROJECT_ROW, cleanup in finally, artifacts file with the created ids."
check = "echo $(grep -c 'addInitScript' .verify/phase-17.mjs) $(grep -c 'simple-chat-new' .verify/phase-17.mjs) $(grep -c 'simple-chat-remove' .verify/phase-17.mjs) $(grep -c 'phase-17-session' .verify/phase-17.mjs) $(grep -c 'force=true' .verify/phase-17.mjs)"
expect_re = "^[1-9] [1-9] [1-9] [1-9] [1-9]$"

[[steps]]
kind = "edit"
path = "docs/simple-chat-list.md"
what = "Write the contract note (under 80 lines) in the shape of docs/git-panel.md: what simple mode is, the tag column and why the POST carries it, the simpleList filter on the recents feed, the preference keys (flat, and why not the uiPreferences blob), the remove flow (abort frame, then archive once the busy set drops the id), and what the transcript on disk is never subject to. Cross-reference server/modules/providers/README.md for the route table and docs/architecture/03-conversation-handoff.md for the merge path rather than restating them."
check = "echo $(grep -c 'simple_list_at' docs/simple-chat-list.md) $(grep -c 'simpleList' docs/simple-chat-list.md) $(grep -c 'simple-chat-list.md' docs/verification.md)"
expect_re = "^[1-9] [1-9] [1-9]$"

[[steps]]
kind = "edit"
path = "docs/verification.md"
what = "Add a Phase 17 paragraph in the style of the Phase 15 one: what is sealed, what is spent (zero turns), that openConsole now parks simpleChatList at false because the default is on, that probe-simple-settings.mjs and probe-simple-view.mjs are the cheap settings/mount smokes; link the contract note."
check = "grep -c 'Phase 17' docs/verification.md"
expect_re = "^[1-9]$"

[[verify]]
cmd = "node .verify/phase-17.mjs 2>&1 | tail -60"
expect_re = "(?s)\\A(?!.*\\[FAIL\\]).*\\[PASS\\] simple mode hides tree and chips.*\\[PASS\\] empty state.*\\[PASS\\] POST carries simpleList true.*\\[PASS\\] row lists the new chat with its project.*\\[PASS\\] chat.send was sealed.*\\[PASS\\] rename stored.*\\[PASS\\] files request follows the row project.*\\[PASS\\] idle remove archived.*\\[PASS\\] toggle off restores the tree.*\\n0 failed"
timeout_s = 420

[[verify]]
cmd = "node -e \"const D=require('better-sqlite3');const fs=require('fs');const ids=JSON.parse(fs.readFileSync('.verify/artifacts/phase-17-session.json','utf8')).sessionIds;const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const left=ids.filter(id=>db.prepare('select 1 from sessions where session_id=?').get(id)).length;console.log('probeIds='+ids.length+' residue='+left)\""
expect_re = "^probeIds=[1-9] residue=0$"

[[verify]]
cmd = "ls .verify/shots/17-simple-empty-light.png .verify/shots/17-simple-rows-light.png .verify/shots/17-simple-off-light.png >/dev/null && echo SHOTS_OK"
expect = "SHOTS_OK"

[[verify]]
cmd = "for loc in de es fr it ja ko ru tr zh-CN zh-TW; do for k in project newChat empty loadMore rename renamePlaceholder remove running stopTitle stopBody stopConfirm removeFailed; do [ \"$(jq -r \".simpleList.$k // \\\"MISSING\\\"\" src/modules/i18n/locales/$loc/sidebar.json)\" = MISSING ] && echo \"MISSING sidebar $loc $k\"; done; for k in title simpleChatList.label simpleChatList.description simpleChatProject.label simpleChatProject.description; do [ \"$(jq -r \".appearance.sidebar.$k // \\\"MISSING\\\"\" src/modules/i18n/locales/$loc/settings.json)\" = MISSING ] && echo \"MISSING settings $loc $k\"; done; done; echo PARITY_OK"
expect = "PARITY_OK"
```

**What to build.** One harness file, one contract note, one paragraph; no application code.

**The harness, gate by gate** (`.verify/phase-17.mjs`, zero Claude turns; copy the seal, canary, injection, `sentFrames`, results and `finally` idioms from `.verify/phase-15.mjs:50-57, 130-195, 420-434, 589-599, 1026-1046`, renaming `__phase15` to `__phase17`; the `Enter`-to-send idiom from `.verify/phase-6.mjs:555-556`; `SIDEBAR` from `phase-15.mjs:71`; `DEV_USER` from `console.mjs:28`). Record `[PASS]`/`[FAIL]` lines with EXACTLY these names where named:
1. `page.addInitScript(WS_HARNESS)` BEFORE `openConsole` navigates — so pass the script through a `context`/`page` you obtain from `openConsole`'s return only if it exposes one; otherwise install the seal with `page.addInitScript` immediately after `openConsole` returns and `page.reload()`. Then prove the seal two-sided with the canary (`SESSION_NOT_FOUND` unsealed, silence sealed).
2. Cleanup first: `GET /api/providers/sessions/recent?simpleList=true&limit=100` through `session.api`; every conversation whose `sessionTitle` starts with `phase-17` is `DELETE ...?force=true`.
3. `PATCH /api/user/preferences {"simpleChatList": true, "simpleChatProjectId": "4d94a97e-0e62-43ee-981a-0028fec301b9"}`, `page.reload()`, wait for `[data-testid="simple-chat-list"]`. `[PASS] simple mode hides tree and chips` when `PROJECT_ROW` count is 0 AND `${SIDEBAR} button:has-text("Conversations")` count is 0 AND `${SIDEBAR} input[type="search"], ${SIDEBAR} input[placeholder]` count is 0 AND the settings gear (`SidebarFooter.tsx:97-105`) is visible.
4. `[PASS] empty state` when `[data-testid="simple-chat-empty"]` is visible and `[data-testid="simple-chat-row"]` count is 0. `shoot('17-simple-empty')`.
5. Dropdown: option count equals `GET /api/projects` length; the selected label reads `claudecodeui_lyphe`.
6. Register `page.on('request')` collectors for `POST /api/providers/sessions`, `PUT /api/providers/sessions/`, `DELETE /api/providers/sessions/` and every `/api/projects/<id>/` GET. Click `[data-testid="simple-chat-new"]`, `page.fill('textarea', 'phase-17 probe chat')`, `keyboard.press('Enter')`. `[PASS] POST carries simpleList true` when the captured POST body parses with `simpleList === true` and `projectPath === '/home/lyphe/.claude/claudecodeui_lyphe'`. Wait for `[data-testid="simple-chat-row"]` count 1; `[PASS] row lists the new chat with its project` when the row text contains `phase-17 probe chat` and `claudecodeui_lyphe` and `location.pathname` is `/session/<id>` for the id the POST answered. `[PASS] chat.send was sealed` when `sentFrames(page, 'chat.send').length === 1` and no `complete` frame ever arrived. Write `{ "sessionIds": [id] }` to `.verify/artifacts/phase-17-session.json` (append later ids). `shoot('17-simple-rows')`.
7. Rename: open `[data-testid="simple-chat-menu"]` on the row, click `[data-testid="simple-chat-rename"]`, fill `[data-testid="simple-chat-rename-input"]` with `phase-17 renamed`, press Enter. `[PASS] rename stored` when a PUT was captured with body `{"summary":"phase-17 renamed"}` AND `GET /api/providers/sessions/recent?simpleList=true` reports that id with `sessionTitle === 'phase-17 renamed'` AND the row text shows it.
8. Second chat in another project: choose `.claude` in the dropdown (`GET /api/user/preferences` now reads `simpleChatProjectId === '2de16261-ae6f-4ba7-9814-1d2c3a58b104'`), New chat, fill `phase-17 second chat`, Enter (sealed); wait for row count 2; the newer row is first. Clear the `/api/projects/<id>/` collector, click the FIRST-created row (`claudecodeui_lyphe`), then the Files tab (`[role=tab]` whose `aria-label` reads `Files`); `[PASS] files request follows the row project` when the next captured `/api/projects/<id>/` request carries `4d94a97e-0e62-43ee-981a-0028fec301b9`. Clear again, click the `.claude` row and the Files tab; the next captured id is `2de16261-ae6f-4ba7-9814-1d2c3a58b104`.
9. Idle remove on the `.claude` row: menu → `[data-testid="simple-chat-remove"]`. `[PASS] idle remove archived` when NO `[data-testid="simple-chat-stop-dialog"]` appeared, a DELETE was captured whose URL does not contain `force=true`, the row count drops to 1, `GET .../recent?simpleList=true` no longer lists the id, and `GET /api/providers/sessions/archived` does.
10. `PATCH {"simpleChatList": false}`, `page.reload()`. `[PASS] toggle off restores the tree` when `PROJECT_ROW` count ≥ 1 and `[data-testid="simple-chat-list"]` count is 0 and `${SIDEBAR} button:has-text("Conversations")` count ≥ 1. `shoot('17-simple-off')`.
11. `finally`: `DELETE ...?force=true` every recorded id, `PATCH {"simpleChatList": false, "simpleChatProjectId": null}`, close the browser. Print results and `N passed, M failed`.

**Docs.** `docs/simple-chat-list.md` is the contract note (shape of `docs/git-panel.md`) and the ONE home for "what simple mode is and how its pieces relate"; the route table stays in `server/modules/providers/README.md`, the merge path in `docs/architecture/03-conversation-handoff.md`, the preference store in `src/shared/userSettings.ts`'s own header — link, do not restate. `docs/verification.md` gets a "Phase 17" paragraph in the style of the Phase 15 one.

**Sirens.** You will want to write the `[PASS]` names loosely; the verify regex matches them verbatim. You will want to inject a `complete` to make the sealed chat "finish" — nothing in this phase needs a run to end; the stop path is Phase 6's. `git` is not an act in this phase.

## Phase 6 — Proof of the stop-and-remove path and the mobile width
Depends on: Phase 5

```toml
[phase]
id = "6"
builder = "hephaestus"
model = "sonnet"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "src/modules/sidebar/SidebarSimpleList.tsx",
  "src/modules/sidebar/SidebarSimpleListRow.tsx",
  ".verify/phase-18.mjs",
  "docs/verification.md",
]
forbidden = [
  "server",
  ".verify/lib/console.mjs",
  ".verify/phase-17.mjs",
  ".verify/probe-simple-view.mjs",
]
athena = [
  "The probe injects the complete frame before asserting that no DELETE was sent while the run was live, so an archive-before-abort bug passes",
  "The chat.abort assertion does not check the frame's sessionId equals the row's id, or the cancel path is not proven to send nothing",
  "The 390 px pass only screenshots and reads no layout fact (the New chat button and each row's tap target must be at least 44 px tall and inside the viewport)",
  "The probe spends a Claude turn: an unsealed chat.send, or a canary that was not re-proven after a reload",
  "The 15-second fallback is asserted with a window so wide that a never-archives bug (probe timeout) reads as a pass",
  "The injected busy state is not re-armed against the 5 s running-sessions sync, so the busy set drops the id on its own and the no-archive-while-live gate passes for the wrong reason",
  "The tap-target fix changed the DESKTOP layout: the New chat button or the row link must keep today's height when useCompactSidebar() is false — the floor is a COMPACT-only minimum, not a resize of the whole control",
  "The row link was given a min-height but not made to fill the row (the parent is `items-center`, so without `self-stretch` the anchor still measures its content), or the fix was applied to the row `div` — which already passes at 44 px — instead of to the `<a>` that actually carries the href and onClick",
  "The builder edited a file outside this phase's four-entry manifest — read the diff: Sidebar.tsx, SidebarContent.tsx, SidebarHeader.tsx, the two hooks and the stop dialog all shipped in Phase 4 and are not this phase's to touch, and a CONCURRENT session writes this repo so a foreign change to any of them is not a finding",
]

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleList.tsx"
what = "Give the New chat button a 44 px minimum tap target in COMPACT mode only. `Button size=\"sm\"` is `h-9` (36 px, `src/shared/ui/Button.tsx:32`), under the floor gate 9 measures. Call useCompactSidebar() (already imported by SidebarSimpleListRow.tsx:8 — same hook, `hooks/useCompactSidebar.ts`) and pass className={isCompact ? 'min-h-11' : undefined} to the button. Desktop keeps h-9 exactly as today. Nothing else in the file changes."
check = "echo $(grep -c 'useCompactSidebar' src/modules/sidebar/SidebarSimpleList.tsx) $(grep -c 'min-h-11' src/modules/sidebar/SidebarSimpleList.tsx) $(wc -l < src/modules/sidebar/SidebarSimpleList.tsx | awk '{print ($1<=200)?\"small\":\"big\"}')"
expect_re = "^[1-9] [1-9] small$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleListRow.tsx"
what = "Make the row's `<a>` fill the row in COMPACT mode so the thing carrying href/onClick is the 44 px target. Today the row `div` reaches 44 px via `min-h-11` but the parent is `items-center`, so the `<a className=\"min-w-0 flex-1\">` (line 77-79) measures only its text (~30 px). Change that className to cn('min-w-0 flex-1', isCompact && 'self-stretch flex flex-col justify-center') — `self-stretch` overrides the parent's items-center so the anchor spans the row's full height, and the flex column keeps the two text lines vertically centred. `isCompact` and `cn` are already in scope (lines 33 and the existing cn import). Desktop is unchanged. Do not touch the row div's own classes."
check = "echo $(grep -c 'self-stretch' src/modules/sidebar/SidebarSimpleListRow.tsx) $(grep -c 'min-h-11' src/modules/sidebar/SidebarSimpleListRow.tsx) $(wc -l < src/modules/sidebar/SidebarSimpleListRow.tsx | awk '{print ($1<=200)?\"small\":\"big\"}')"
expect_re = "^[1-9] [1-9] small$"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = "npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL"
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = "npm run lint 2>&1 | grep -c ': warning ' | awk '{print ($1<=123)?\"LINT_OK\":\"LINT_UP \"$1}'"
expect = "LINT_OK"
timeout_s = 300

[[steps]]
kind = "edit"
path = ".verify/phase-18.mjs"
what = "Write the phase-18 harness described in the phase body: sealed New chat, injected chat_subscribed processing state re-armed every 2 s, stop dialog cancel then confirm, chat.abort captured, no DELETE while live, DELETE after injected complete, the 15 s fallback on a second row, then the 390 px pass with shots, cleanup in finally."
check = "echo $(grep -c 'chat_subscribed' .verify/phase-18.mjs) $(grep -c \"'chat.abort'\" .verify/phase-18.mjs) $(grep -c 'simple-chat-stop-confirm' .verify/phase-18.mjs) $(grep -c 'width: 390' .verify/phase-18.mjs) $(grep -c 'phase-18-session' .verify/phase-18.mjs)"
expect_re = "^[1-9] [1-9] [1-9] [1-9] [1-9]$"

[[steps]]
kind = "edit"
path = "docs/verification.md"
what = "Add a Phase 18 paragraph after the Phase 17 one: what is replayed (a processing ack re-armed against the running-sessions sync, and a terminal complete, over the sealed socket), what is measured (abort frame, order of abort and archive, the fallback window, the 390 px layout facts), and that it spends zero Claude turns."
check = "grep -c 'Phase 18' docs/verification.md"
expect_re = "^[1-9]$"

[[verify]]
cmd = "node .verify/phase-18.mjs 2>&1 | tail -60"
expect_re = "(?s)\\A(?!.*\\[FAIL\\]).*\\[PASS\\] running row shows the spinner.*\\[PASS\\] remove on a running row asks first.*\\[PASS\\] cancel sends nothing.*\\[PASS\\] confirm sends chat.abort for the row.*\\[PASS\\] no archive while the run is live.*\\[PASS\\] archive follows the complete.*\\[PASS\\] fallback archives after the wait.*\\[PASS\\] 390 layout.*\\n0 failed"
timeout_s = 480

[[verify]]
cmd = "node -e \"const D=require('better-sqlite3');const fs=require('fs');const ids=JSON.parse(fs.readFileSync('.verify/artifacts/phase-18-session.json','utf8')).sessionIds;const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const left=ids.filter(id=>db.prepare('select 1 from sessions where session_id=?').get(id)).length;console.log('probeIds='+ids.length+' residue='+left)\""
expect_re = "^probeIds=[2-9] residue=0$"

[[verify]]
cmd = "ls .verify/shots/18-simple-stop-dialog-light.png .verify/shots/18-simple-390-light.png .verify/shots/18-simple-390-dark.png >/dev/null && echo SHOTS_OK"
expect = "SHOTS_OK"
```

**What to build.** Two one-line tap-target fixes, then the harness, then the doc paragraph.

**Why this phase carries application code.** Gate 9 asserts a 44 px floor at 390 px. Measured against the live DOM on 2026-09-08, before a line of the harness was written: `[data-testid="simple-chat-new"]` renders 36 px and the row's `<a>` renders 30 px. Phase 4's own row step asked for "44 px tap target when useCompactSidebar() is true" and the row `div` got `min-h-11` — but the div is not what a finger hits; the `<a>` inside it carries the href and the onClick, and `items-center` leaves it at its content height. So the floor was never true, and a harness written to assert it would either fail forever or be quietly weakened to match the bug. The fix is two className changes, scoped to compact mode, and it lands HERE so the phase that measures the floor is the phase that makes it true. Copy phase-17's seal, canary, collectors and cleanup verbatim (rename the globals to `__phase18`); the injection helpers are `.verify/phase-15.mjs:607-621` (`armLiveRun` injects `chat_subscribed { isProcessing: true }`, `endRun` injects the aborted `complete`).

**The harness, gate by gate** (zero Claude turns):
1. Seal + canary, cleanup of `phase-18*` titles (through `GET .../recent?simpleList=true&limit=100`), `PATCH {"simpleChatList": true, "simpleChatProjectId": "4d94a97e-0e62-43ee-981a-0028fec301b9"}`, reload, wait for `[data-testid="simple-chat-list"]`.
2. New chat, fill `phase-18 live chat`, Enter (sealed); wait for one row; record the id.
3. Inject `chat_subscribed` with `isProcessing: true` for that id, and keep re-injecting it every 2 s until the gate that ends the run: `SessionProtectionContext` re-syncs the busy set from `GET /sessions/running` every 5 s, and with the socket sealed the server has no run for this id, so an un-armed busy state would drop on its own. `[PASS] running row shows the spinner` when `[data-testid="simple-chat-running"]` inside that row becomes visible within 2 s.
4. Menu → Remove. `[PASS] remove on a running row asks first` when `[data-testid="simple-chat-stop-dialog"]` is visible, its text contains `This chat is still running` and `Stop it and remove` and no DELETE was captured. `shoot('18-simple-stop-dialog')`.
5. Click `[data-testid="simple-chat-stop-cancel"]`. `[PASS] cancel sends nothing` when the dialog is gone, the row remains, `sentFrames(page, 'chat.abort').length === 0` and no DELETE was captured.
6. Menu → Remove → `[data-testid="simple-chat-stop-confirm"]`. `[PASS] confirm sends chat.abort for the row` when within 2 s `sentFrames(page, 'chat.abort')` has exactly one frame whose `sessionId` is the row's id. Wait 3 s (still re-arming): `[PASS] no archive while the run is live` when no DELETE has been captured and the row is still present.
7. Stop re-arming and inject the aborted `complete` for the id. `[PASS] archive follows the complete` when a DELETE for that id without `force=true` is captured within 3 s, the row disappears, and `GET /api/providers/sessions/archived` lists the id.
8. Second row: New chat, fill `phase-18 stuck chat`, Enter; inject `chat_subscribed` processing and keep re-arming every 2 s; menu → Remove → confirm; inject no `complete`. `[PASS] fallback archives after the wait` when the DELETE is captured no earlier than 14 s and no later than 20 s after the confirm click (measure with `Date.now()` at the click and at the request event); stop re-arming once it lands.
9. `PATCH` the project back, `resize(page, { width: 390, height: 844 })` (`console.mjs:322-325`; `phase-8.mjs:44` for the viewport), wait 600 ms. Open the sidebar the way the mobile layout does (find the hamburger/menu control; `phase-0.mjs` and `phase-10.mjs` open it at 390 — read how). New chat, fill `phase-18 mobile chat`, Enter (sealed); wait for the row. `[PASS] 390 layout` when `[data-testid="simple-chat-new"]` and the row's link both have bounding boxes with `height >= 44` and `x + width <= 390`, and `PROJECT_ROW` count is 0. `shoot('18-simple-390')`; drive dark through `session.theme` or `ensureTheme` (`console.mjs:239-257`) and `shoot('18-simple-390')` again so the dark file lands; drive light back.
10. `finally`: force-delete every recorded id (write them to `.verify/artifacts/phase-18-session.json` as they are created), `PATCH {"simpleChatList": false, "simpleChatProjectId": null}`, restore light, close.

**Sirens.** You will want to inject `complete` right after `chat.abort` to speed the run up — gate 6's 3-second silence is the whole point; keep the order. You will want to shorten the fallback gate by patching a constant in the app; the app is forbidden here and the 15 s wait is the measurement. You will forget that the 5 s running-sessions sync can flip the injected busy state back to idle — the re-arm loop in gates 3-8 is not optional. You will be tempted to skip the dark shot; the file list in the verify names it. `git` is not an act in this phase.

## Goal

*Goal:* with `simpleChatList` on, the sidebar is a flat list of only the chats started from it, new chats land there tagged at insert time, rename and remove work through the existing routes, the workspace tabs follow the row's project, and with it off the old sidebar is byte-for-byte the old sidebar. *Verify by:* the six phases' verify blocks — Phase 1's curl/DB probe (including the untouched tree feed), Phase 3's settings probe, Phase 4's mount probe, Phase 5's `phase-17.mjs` and Phase 6's `phase-18.mjs`, all green with `residue=0` in the operator's database.

## Decisions

- The tag rides the `POST /api/providers/sessions` body, not the `chat.send` frame: the row is minted by that POST before the first frame exists (`useChatComposerState.ts:750-797`), so tagging at insert time has exactly one home.
- Persistence is `simple_list_at DATETIME NULL` (a timestamp doubles as the sort key). Every write to an app-owned row in `sessions.db.ts` is an `UPDATE ... SET` list that never names the column (the watcher's upsert, `assignProviderSessionId`, the Codex repoint); the only `DELETE`s remove the watcher's provider-keyed duplicate, a fork's pre-indexed row, a whole project or an explicit hard delete. A disk resync therefore cannot clear the tag.
- The simple list is the recents feed filtered to tagged rows: one `simpleListOnly` option on `getRecentSessionsPage`/`listRecentSessions`, one `?simpleList=true` flag on `GET /sessions/recent`, one row type (`RecentConversationListItem`). No cloned query, mapper, route or type — the archived-project visibility rule then has one home.
- Tagging is decided by the preference value at the moment the composer mints the session. Every UI entry point — the simple list's New chat, the command palette's start-new-chat, the `/` route — converges on that one `createSession` call, so "created from the simple view" is read as "minted while the simple view is the sidebar"; the git-delegation caller (`startRun.ts`) is the only other minter and never tags.
- The preferences are two flat rows, never part of the `uiPreferences` blob — that blob is a boolean-only reducer and `simpleChatProjectId` is a string; the pair lives together, like `tasksEnabled` / `projectSortOrder`.
- The Settings home is Appearance (the tab that owns the workspace-tab switches and the sort order).
- The simple view is a first arm inside `SidebarContent`'s existing body ternary, with the header's search and chips suppressed by folding `simpleMode` into the existing `showSearchTools` flag and the footer kept, so the settings gear stays reachable and the collapsed rail is untouched. A sibling view beside `SidebarCollapsed` is possible today — the `simpleMode` fold already makes `SidebarHeader` reusable — but it duplicates the header (13 props) and footer (7 props) wiring in `Sidebar.tsx` or hoists them into prop objects: a `Sidebar.tsx` refactor for another checkpoint. `SidebarContent` takes the view as a `ReactNode` slot so it never imports the mode.
- Remove archives through `DELETE` without `force`; the transcript is never touched. A live run is aborted through the existing `chat.abort` frame first, and the archive is driven by an effect on the client's busy set (the computed running model, fed by frames and re-synced every 5 s), with a 15 s fallback. This diverges from `useRestartOnInstalledCli`, which waits on the `complete` frame and rejects the busy map, on purpose: a restart that misreads "ended" resumes into a live run, whereas a remove that misreads it archives a running row — the fallback's own outcome, already accepted. And `complete` reaches only sockets in the run's audience, so a row that is not the open chat never gets one; the busy set is fed by the 5 s `GET /sessions/running` sync as well, which `handleChatAbort` → `completeRun` empties. A `DELETE ?stop=true` on the server is the cleaner shape (the run belongs to the server) and is the reversal, not the plan. The flow lives in `useSimpleChatRemove`, not in the list component. A server-side "stop and archive" option on `DELETE` was considered and set aside: it would re-implement or export `handleChatAbort`, and the operator capped new server surface at the tag and the list filter.
- The harness's `openConsole` parks the dev account's `simpleChatList` at `false` because the default is `true` and every older phase waits for a project row.
- Forked sessions are not tagged (forking is a tree action).
- The sidebar work is two sittings: the view with a three-gate mount probe (Phase 4), then the eleven-gate behavioural harness and the docs (Phase 5); the stop path and mobile width stay their own sitting (Phase 6).

## Waves

Wave 1: Phase 1, Phase 2 — independent (server-only vs. `src/shared` + the composer); each could run in its own session
Wave 2: Phase 3 — Settings, consumes Phase 2's hook
Wave 3: Phase 4 — the sidebar view, consumes all three
Wave 4: Phase 5 — proof of the flat list + docs, consumes Phase 4
Wave 5: Phase 6 — proof of the stop path and mobile width, consumes Phase 5

## Edge cases

- `simpleChatProjectId` null or naming a project that is gone/archived → the dropdown shows the first project (sorted by display name) and writes nothing until changed; New chat uses what is shown.
- No projects at all → dropdown shows its placeholder, New chat is disabled, empty state shows.
- A tagged session whose project is later archived → excluded by the server query (same rule as the recent list); it returns when the project is restored.
- A removed (archived) chat that later receives transcript writes → the watcher's upsert (`sessions.db.ts createSession`, `isArchived = 0` in its UPDATE) resurfaces the row; this is today's archive semantics for every session and is not changed here. Waiting for the busy set to drop the id before archiving narrows the window but cannot close it: the provider process may flush its last transcript line after the run completes. Closing it means the watcher must not un-archive a row archived after the file's last write — a change to every session's semantics, outside this plan (see Exclusions).
- Remove fails (non-2xx) → the row stays, `simpleList.removeFailed` shows under it for 4 s, nothing else changes.
- The abort never produces a `complete` (a hung run) → after 15 s the archive proceeds anyway.
- The user opens `/session/<id>` of an untagged session while simple mode is on → the chat opens; the list does not show it; the tabs follow that chat's project because selection went through the app's URL effect as today.
- Simple mode turned off in Settings mid-draft, then the draft is sent → the session is untagged (the preference at mint time decides).
- Rename to an empty string → `updateSessionSummary` returns without a request; the row keeps its title.
- Pagination: 20 per page; "Show more" appends; a `session_upserted` reload refetches `max(20, rows.length)` from offset 0 so loaded pages are not lost.

## Exclusions

- No migration of pre-existing sessions into the list (the operator's words: it starts empty).
- No search inside the simple list, no fork action on its rows, no drag ordering.
- No change to `SidebarCollapsed.tsx`, the tree, the chips code, `useSidebarController.ts` or the watcher.
- The watcher's un-archive-on-reindex (`createSession`'s `isArchived = 0`) is the root of the Remove-while-running race and of the tree's own archive-a-running-session behaviour; curing it is a semantics change for every session and belongs to Asclepius as its own card, not to this plan.
- Splitting `provider.routes.ts` (908 — over the 800 hard ceiling), `sessions.service.ts` (663), `sessions.db.ts` (714), `useSidebarController.ts` (1093) or `useChatComposerState.ts` (1258): named as follow-up candidates, not done here. This plan adds a handful of lines to the first three (an option threaded through an existing feed) and three lines to the last. The split's first cut is named now: the session gateway routes (`POST /sessions`, `/recent`, `/running`, `/archived`, `DELETE /:sessionId`, `/fork`, `/messages`, `/provider-id` — the concern this plan touched) into `provider.routes.ts`'s sibling `sessions.routes.ts`, a pure move with the barrel unchanged; it is the checkpoint immediately after this plan, before the next server feature re-anchors to line numbers.
- `useSimpleChatList` duplicates the recents pager in `useSidebarController.ts:218-283` (seq guard, append dedupe, page shape). The cure — a module-private `hooks/useRecentConversationsFeed.ts` taking `{ simpleListOnly, pageSize }` that both compose — is part of the controller split, not this plan.
- `.verify/phase-0.mjs` fails today on the renamed Source Control tab (four gates plus the shot count) — pre-existing, outside this plan's manifests.
- `src/modules/sidebar/tests/sidebarRowProps.test.tsx` and `server/shared/tests/` exist against the operator's no-tests rule — surfaced, not deleted here.
- The pre-existing i18n gaps (every non-English locale misses 17-84 `settings.json` keys and 6-14 `sidebar.json` keys, baked in at commit `abe5220`): surfaced, not this plan's to close. This plan's checks assert only its own keys in all 11 locales.

## Doctrine citations

- This repo has no `CLAUDE.md` and no `docs/ARCHITECTURE.md`. Its constitution is `AGENTS.md`, which binds `.agents/skills/backend-module-standards/SKILL.md` (barrels, `@/` + `.js`, thin routes, `type` over `interface`, consumer comments, one-use vs. shared placement) and `.agents/skills/frontend-module-standards/SKILL.md` (`@/` imports, no interfaces, shared hooks in `src/shared/hooks/` when several modules consume them, shared types in `src/shared/types.ts`, state comments, consumer comments, "search for an existing equivalent before adding").
- `docs/architecture/README.md` — the five cross-cutting invariants (app id is minted server-side before the first frame; exactly one `complete` per run; a run belongs to the server, not a socket; live and persisted rows stay separate; the persisted transcript is the source of truth) and the glossary entry for the app session id.
- `docs/architecture/03-conversation-handoff.md` §"Transcripts on disk" and §"The provider id column's lifecycle" — the app-session lifecycle: minted by `createAppSession` with a NULL provider id, linked by `assignProviderSessionId`, watcher duplicates merged into the app row.
- `server/modules/providers/README.md` — the providers module contract (`sessions` vs `sessionSynchronizer` are separate concerns); `server/modules/websocket/README.md` — `chat.abort` cancels the run and emits the synthetic `complete`; `session_upserted` is the sidebar delta.
- `docs/verification.md` — the dev server units, `verve` account, the 390 px `PROJECT_ROW` blind spot, one stored `uiPreferences` blob, the sealed-socket technique (Phase 11/15), the warning-count ratchet.
- `docs/hosting.md:35-36` — a server edit restarts the API; `docs/hosting.md:66-69` — probes mutate live state, run them solo.
- `docs/chat-contracts.md §5` — a blob preference is written merged, never replaced (why a raw PATCH must not touch `uiPreferences`).
- Operator global law: no tests, no branches, healed means deleted, root cause before fix, verify against the running system; module size (300 default / 500 soft / 800 hard, two drivers: read-cost and concurrency).

## Open Questions

(none)

## Ship Logs

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-08
- run: simple-chat-list-plan-20260908-072535-ed43 · attempt 1 of 2 · cycle 1 · spawns 7/36 · fix-passes 2 of 2 · cost $4.15 (run $4.15) · resumed 0×
- builder: hephaestus/sonnet · session 42b238b7-1830-4cb1-93bf-9843e8cb37b8 · 343s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 1 · LOW 0 → fix-pass 1 (73s) → pass 2 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 2 (29s) → pass 3 BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 8/8 steps OK · verify 3/3 OK
- forbidden: unchanged (6 declared, 6 present)
- docs: Prometheus returned · 0 files
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-072535-ed43/phase_1/

### Phase 2 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: forbidden-changed: fix-pass 1: src/shared/types.ts, server]
- run: simple-chat-list-plan-20260908-072535-ed43 · attempt 1 of 2 · fix-passes 1 of 2 · spec_sha bde5f9a99ff3 · retry: on-spec-change
- builder: hephaestus/sonnet · session f88c6199-af30-42de-ab7e-d44dddee9f12 · 165s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 1 · MED 0 · LOW 0 → fix-pass 1 (233s)
- forbidden: CHANGED: src/shared/types.ts, server
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-072535-ed43/phase_2/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 2]
- run: simple-chat-list-plan-20260908-072535-ed43 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 2b11e20ebd6f · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-072535-ed43/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 2, Phase 3]
- run: simple-chat-list-plan-20260908-072535-ed43 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha a2b0d2d4e874 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-072535-ed43/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 4]
- run: simple-chat-list-plan-20260908-072535-ed43 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha bebcc967a473 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-072535-ed43/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 5]
- run: simple-chat-list-plan-20260908-072535-ed43 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c15e7f77d9b6 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-072535-ed43/phase_6/

### Run simple-chat-list-plan-20260908-072535-ed43 — COMPLETE 2026-09-08
- shipped: 1
- blocked: 2: forbidden-changed, 3: depends, 4: depends, 5: depends, 6: depends
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/simple-chat-list.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-072535-ed43/resume_brief.md

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-08
- run: simple-chat-list-plan-20260908-080444-6b01 · attempt 1 of 2 · cycle 1 · spawns 3/36 · fix-passes 0 of 2 · cost $1.35 (run $1.35) · resumed 0×
- builder: hephaestus/sonnet · session ab2ddddf-f9b9-4c43-ad0b-44a0a9f0db10 · 93s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 6/6 steps OK · verify 2/2 OK
- forbidden: unchanged (3 declared, 3 present)
- docs: dispatched · background · returned · 0 files
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-080444-6b01/phase_2/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: builder-blocked: step 2's check (`for loc in de es fr it ja ko ru tr zh-CN zh-TW; do diff <(...) <(...) >/dev/null || echo "MISMATCH $loc"; done; echo PARITY_CHECKED`) cannot output bare `PARITY_CHECKED` no matter what I add for `appearance.sidebar`: run today it prints `MISMATCH de (84-missing) MISMATCH es (17-miss]
- run: simple-chat-list-plan-20260908-080444-6b01 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha f98519570ab6 · retry: on-spec-change
- builder: hephaestus/sonnet · session 9ae20610-486e-4172-9b8c-b2b52c8b799d · 192s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-080444-6b01/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 3]
- run: simple-chat-list-plan-20260908-080444-6b01 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 8c8a130dd0b3 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-080444-6b01/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 4]
- run: simple-chat-list-plan-20260908-080444-6b01 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha bebcc967a473 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-080444-6b01/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 5]
- run: simple-chat-list-plan-20260908-080444-6b01 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c15e7f77d9b6 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-080444-6b01/phase_6/

### Run simple-chat-list-plan-20260908-080444-6b01 — COMPLETE 2026-09-08
- shipped: 2
- blocked: 3: builder-blocked, 4: depends, 5: depends, 6: depends
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/simple-chat-list.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-080444-6b01/resume_brief.md

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: verify: grep -n 'AppearanceSettingsTab' src/modules/settings/Settings.tsx | grep -c 'projects=' → exit 1 '0']
- run: simple-chat-list-plan-20260908-081917-6f0e · attempt 1 of 2 · fix-passes 2 of 2 · spec_sha 16e19f107d9a · retry: on-spec-change
- builder: hephaestus/sonnet · session 3263b8ce-08a6-4f78-aa77-19f82fd83a54 · 224s · RESULT: DONE
- athena: pass 1 BLOCKING 1 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1 (163s) → pass 2 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 2 (56s) → pass 3 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 — BOUND REACHED
- checks: 6/7 steps OK · verify 3/3 OK
- forbidden: unchanged (4 declared, 4 present)
- residue: MED 0 · LOW 1 (Athena pass 3)
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-081917-6f0e/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 3]
- run: simple-chat-list-plan-20260908-081917-6f0e · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 39d1a15d9f4b · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-081917-6f0e/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 4]
- run: simple-chat-list-plan-20260908-081917-6f0e · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 17f8e2ae7aa5 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-081917-6f0e/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: depends: not SHIPPED: Phase 5]
- run: simple-chat-list-plan-20260908-081917-6f0e · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c15e7f77d9b6 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-081917-6f0e/phase_6/

### Run simple-chat-list-plan-20260908-081917-6f0e — ALL-BLOCKED 2026-09-08
- shipped: none
- blocked: 3: verify, 4: depends, 5: depends, 6: depends
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/simple-chat-list.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-081917-6f0e/resume_brief.md

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-08
- run: simple-chat-list-plan-20260908-084247-c3ef · attempt 1 of 2 · cycle 1 · spawns 3/36 · fix-passes 0 of 2 · cost $2.13 (run $2.13) · resumed 0×
- builder: hephaestus/sonnet · session 1490c84e-6b77-4252-b7d8-90cd0f03497d · 202s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 7/7 steps OK · verify 3/3 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 0 files
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-084247-c3ef/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-08
- run: simple-chat-list-plan-20260908-084247-c3ef · attempt 1 of 2 · cycle 3 · spawns 11/36 · fix-passes 2 of 2 · cost $5.29 (run $7.41) · resumed 1×
- builder: hephaestus/sonnet · session 53501d7b-42e5-4add-a6bb-6dcd2f80c9a8 · 757s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1 (87s) → pass 2 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 2 (43s) → pass 3 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 — BOUND REACHED
- checks: 13/13 steps OK · verify 3/3 OK
- forbidden: unchanged (11 declared, 11 present)
- docs: dispatched · background · returned · 0 files
- residue: MED 0 · LOW 1 (Athena pass 3)
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-084247-c3ef/phase_4/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-08
- run: simple-chat-list-plan-20260908-084247-c3ef · attempt 1 of 2 · cycle 4 · spawns 16/36 · fix-passes 1 of 2 · cost $13.90 (run $21.59) · resumed 1×
- builder: hephaestus/sonnet · session 727f1bd3-0cd0-4a3d-8e83-98b90c34bcda · 1880s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1 (269s) → pass 2 BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 3/3 steps OK · verify 4/4 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 1 files
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-084247-c3ef/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-08
- [BLOCKED: builder-blocked: reality diverges from the brief: at 390px the real DOM gives `[data-testid="simple-chat-new"]` height=36px and the row's `<a>` link height=30px, both under the 44px the phase body requires gate 9 to assert, and the only fix (Button size / row-link sizing in `src/modules/sidebar/SidebarSimpleList.tsx]
- run: simple-chat-list-plan-20260908-084247-c3ef · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha c15e7f77d9b6 · retry: on-spec-change
- builder: hephaestus/sonnet · session 55dd24b9-9a4b-4b55-bfc2-3117f3f484c1 · 239s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-084247-c3ef/phase_6/

### Run simple-chat-list-plan-20260908-084247-c3ef — COMPLETE 2026-09-08
- shipped: 4, 5
- blocked: 6: builder-blocked
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/simple-chat-list.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-084247-c3ef/resume_brief.md

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-08
- run: simple-chat-list-plan-20260908-104147-25a6 · attempt 1 of 2 · cycle 1 · spawns 5/36 · fix-passes 1 of 2 · cost $10.12 (run $10.12) · resumed 0×
- builder: hephaestus/sonnet · session 2efeeb19-8c29-40f8-8599-cbc5fe0e841a · 1774s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1 (188s) → pass 2 BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 6/6 steps OK · verify 3/3 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 1 files
- evidence: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-104147-25a6/phase_6/

### Run simple-chat-list-plan-20260908-104147-25a6 — COMPLETE 2026-09-08
- shipped: 6
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-104147-25a6/resume_brief.md

### Run simple-chat-list-plan-20260908-121727-d2df — COMPLETE 2026-09-08
- shipped: none
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-121727-d2df/resume_brief.md

### Run simple-chat-list-plan-20260908-121746-28b1 — COMPLETE 2026-09-08
- shipped: none
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/simple-chat-list-plan-20260908-121746-28b1/resume_brief.md
