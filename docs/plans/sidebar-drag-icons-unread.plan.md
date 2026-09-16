# Simple chat list — drag to reorder, a custom icon per chat, and a green dot for a finished unread chat

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> Can we please add the drag-and-drop ability for the simple chats and also add the ability for icons on the left side that I can customize via the extended dropdown menu for each session? Can we also add notifications for when a chat is done and unread? That can just be a simple green dot notification but when it's read or when I switch to it, it should be removed.

**THIS PLAN DELIVERS:**
Three additions to the **simple chat list** sidebar. The project tree sidebar does not change.

- **Drag and drop.** On desktop you press on a chat row, drag it up or down, and let go. A line shows where it will land. On a phone, dragging from a row would fight with scrolling, so there you drag by the row's icon instead. The new order is saved on the server, so it survives a reload and shows on your other devices. A brand-new chat still appears at the top. A plain click on a row still opens the chat.
- **An icon on the left of every row.** Each row gets an icon on its left. Until you pick one it is a chat bubble. The row's "..." menu gets a new **Change icon** item. It opens a small grid of 24 icons plus **Default**, and your pick is saved on the server for that chat.
- **A green dot when a chat is done and unread.** The dot appears on a row when that chat's run finishes while you are not looking at it. It appears live, with no reload needed, including for a chat that crashed or was stopped.
  - It disappears when that chat is open and on screen in any of your browser tabs, on any device.
  - A chat that is already open and on screen when it finishes never gets a dot.
  - "On screen" is the same report the app already uses to skip phone pushes for a chat you are watching, so it works the same in the project-tree sidebar mode too.
- **Proof.** Three probes prove it against the running app, and none of them spends a Claude turn: one for the server, one browser probe for icons and the dot, and one browser probe for drag at desktop width and with touch at phone width.

**OPERATOR VERDICT:** CONFIRMED -- 2026-09-15 -- Scott: "Accept"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = ["/home/lyphe/.cloudcli"]

[budget]
max_cycles = 30
max_spawns = 120
max_fix_passes = 2
max_attempts = 2
max_replans = 3
```

## Interfaces

Server (paths relative to `server/`; imports use the `@/` alias = `server/` and end in `.js`):

- **Four new nullable columns on `sessions`**, declared in `modules/database/schema.ts` `SESSIONS_TABLE_SCHEMA_SQL` directly after `simple_list_at DATETIME,` (line 148), in this order: `simple_list_rank REAL,` · `icon TEXT,` · `last_completed_at TEXT,` · `last_read_at TEXT,`.
  - `simple_list_rank`: the simple list's manual sort key. A higher value sits nearer the top; `NULL` when the session is not tagged `simple_list_at`.
  - `icon`: a kebab-case icon name; `NULL` = default.
  - `last_completed_at` / `last_read_at`: ISO-8601 UTC text with milliseconds, always written as `strftime('%Y-%m-%dT%H:%M:%fZ','now')`. With the format fixed, a string comparison is a correct time comparison.
  - The table has no user column (the full column list is `session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, model, effort, forked_from_session_id, simple_list_at, isArchived, created_at, updated_at`), so all four columns are per session, not per user.
- `modules/database/migrations.ts`: one new `addSessionUserStateColumns(db)`, cloned from `addSimpleListAtColumn` (line 440-443).
  - It adds the four columns through `addColumnToTableIfNotExists` (types `REAL`, `TEXT`, `TEXT`, `TEXT`).
  - It then runs the idempotent backfill `UPDATE sessions SET simple_list_rank = julianday(simple_list_at) WHERE simple_list_at IS NOT NULL AND simple_list_rank IS NULL`, in the shape of `addProviderSessionIdMapping` (line 398-408).
  - It is called in `runMigrations` on the line after `addSimpleListAtColumn(db);` (line 534).
  - A new index `CREATE INDEX IF NOT EXISTS idx_sessions_simple_list_rank ON sessions(simple_list_rank)` sits beside `idx_sessions_simple_list_at` (line 546).
- `modules/database/repositories/session-user-state.db.ts` (**new**, ≤ 170 lines), module-internal to the database module except for the barrel export below. It exports three things at declaration, each with a consumer comment.
  - `export const SESSION_UNREAD_SQL = "sessions.last_completed_at IS NOT NULL AND (sessions.last_read_at IS NULL OR sessions.last_read_at < sessions.last_completed_at)";` This is **the one written form of the unread rule**. It is table-qualified, so it is valid both in the page query's `LEFT JOIN` and in a single-table `UPDATE sessions … WHERE`.
  - `export const NEXT_TOP_SIMPLE_LIST_RANK_SQL = "MAX(julianday('now'), COALESCE((SELECT MAX(top_rank.simple_list_rank) FROM sessions AS top_rank WHERE top_rank.simple_list_at IS NOT NULL), 0) + 0.000001)";` This is **the one written form of "the rank above every tagged row, never below now"**.
  - `export const sessionUserStateDb`, with every method opening `const db = getConnection();` as `setSessionModel` (sessions.db.ts:421-428) does:
    - `markRunCompleted(sessionId: string, alsoRead: boolean): void` — ONE statement: `UPDATE sessions SET last_completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_read_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_read_at END WHERE session_id = ?`, bound `(alsoRead ? 1 : 0, sessionId)`. SQLite gives every `'now'` in one statement the same value, so a completion stamped with `alsoRead` reads as read (`last_read_at < last_completed_at` is false).
    - `markReadIfCompleted(sessionId: string): boolean` — `UPDATE sessions SET last_read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE session_id = ? AND (${SESSION_UNREAD_SQL})`; returns `changes > 0`. A read session is never written again.
    - `setIcon(sessionId: string, icon: string | null): boolean` — `UPDATE sessions SET icon = ? WHERE session_id = ?`; returns `changes > 0`.
    - `moveInSimpleList(sessionId: string, afterSessionId: string | null): boolean` — all inside ONE `db.transaction(() => { … })()`, the IIFE form of sessions.db.ts:227.
      - It returns `false` when the moving row, or the `afterSessionId` row when one is given, does not exist or has `simple_list_at IS NULL`.
      - **To top** (`afterSessionId === null`): `UPDATE sessions SET simple_list_rank = ${NEXT_TOP_SIMPLE_LIST_RANK_SQL} WHERE session_id = ?`.
      - **Below a row**: `after` = that row's rank; `below` = `MAX(simple_list_rank)` over tagged rows with `simple_list_rank < after`, excluding the moving row and the after row. `rank = below IS NULL ? after - 0.000001 : (after + below) / 2`.
      - **Collapse guard**: if the computed rank is not strictly between its neighbours (`rank >= after`, or `below` exists and `rank <= below`), renumber instead. Read every tagged row except the moving one, ordered `simple_list_rank DESC, session_id DESC`. Splice the moving id in directly after `afterSessionId`. Write `simple_list_rank = top - i * 0.000001` for index `i`, where `top` is the current maximum rank.
      - It returns `true`.
- `modules/database/index.ts` re-exports `sessionUserStateDb`, in the same form as its `sessionsDb` export. The two SQL constants are NOT re-exported: only `sessions.db.ts` and `session-user-state.db.ts` read them, and both sit inside the database module.
- `modules/database/repositories/sessions.db.ts` (786 lines; ≤ 15 added):
  - `SessionRow` (line 5-23) gains `simple_list_rank: number | null; icon: string | null; last_completed_at: string | null; last_read_at: string | null; unread?: number;`. Comment `unread`: present only on rows read through `getRecentSessionsPage`, as `1`/`0`.
  - `SESSION_ROW_COLUMNS` (line 30-31) gains `simple_list_rank, icon, last_completed_at, last_read_at` after `simple_list_at`.
  - It imports `NEXT_TOP_SIMPLE_LIST_RANK_SQL` and `SESSION_UNREAD_SQL` from `@/modules/database/repositories/session-user-state.db.js`.
  - `createAppSession` (SQL line 192-195) also writes `simple_list_rank` as `CASE WHEN ? = 1 THEN ${NEXT_TOP_SIMPLE_LIST_RANK_SQL} ELSE NULL END`, bound with the same `simpleList ? 1 : 0` value used for `simple_list_at`.
  - `getRecentSessionsPage` (line 598-645): its page SELECT (line 624) becomes `SELECT sessions.*, (${SESSION_UNREAD_SQL}) AS unread`. The simpleListOnly `orderByClause` (line 618-621) becomes `sessions.simple_list_rank DESC, sessions.session_id DESC`. The non-simple ORDER BY and both WHERE clauses are byte-identical to today's.
- `modules/notifications/services/session-presence.service.ts`: new `export function isSessionOnScreen(sessionId: string): boolean`, placed beside `isSessionWatched`, with a consumer comment naming the run registry.
  - It answers true iff ANY socket's recorded presence names `sessionId` with `visible === true` within the same freshness window `isSessionWatched` uses (90 s, `docs/notifications.md` L211-214).
  - It has no user filter, because sessions carry no user. It reads the same presence store; it never keeps a second one.
- `modules/notifications/index.ts` re-exports `isSessionOnScreen`, in the same form as its other exports.
- `modules/websocket/services/chat-run-registry.service.ts` (338 lines; ≤ 25 added).
  - Imports: line 1 becomes `import { sessionUserStateDb, sessionsDb } from '@/modules/database/index.js';`, plus `import { isSessionOnScreen } from '@/modules/notifications/index.js';`.
  - New file-local `function recordRunCompletion(appSessionId: string): void`, placed directly after `recordProviderSessionId` (line 141-166) and shaped exactly like it. Inside `try`, it runs `sessionUserStateDb.markRunCompleted(appSessionId, isSessionOnScreen(appSessionId))` and then `void broadcastSessionUpserted(appSessionId).catch(<log>)`. Every failure is logged with `console.error('[ChatRunRegistry] …', { appSessionId, error })` and never thrown.
  - It is called as `recordRunCompletion(run.appSessionId);` on the line after `run.completedAt = Date.now();` (line 120), inside `decorateAndRecordEvent`'s `if (message.kind === 'complete')` block. That block is the one place every run's single `complete` passes: every provider, natural, aborted, crashed and re-adopted, with duplicates already dropped at line 99-101.
- `modules/websocket/services/chat-websocket.service.ts` (≤ 20 added).
  - New file-local `function markReadIfCompleted(sessionId: string): void`: `if (sessionUserStateDb.markReadIfCompleted(sessionId)) void broadcastSessionUpserted(sessionId).catch(<log>)`, all inside `try/catch` with a `console.error('[Chat] …')` log, never thrown.
  - `sessionUserStateDb` joins this file's existing import from `@/modules/database/index.js` (line 5). `broadcastSessionUpserted` is imported from `@/modules/websocket/services/session-upsert-broadcast.service.js`, as the registry does.
  - `handleChatPresence` (line 538-544, the `chat.presence` handler that records the socket's presence) calls `markReadIfCompleted(sessionId)` right after the presence is recorded, when the frame's `visible === true` and its `sessionId` is a non-empty string.
- `server/shared/utils.ts`: `parseSessionId` (today `provider.routes.ts:45-55`) moves here, together with every file-local symbol it references (`SESSION_ID_PATTERN`, `readPathParam`). Each is exported at declaration with a doc comment naming its consumers (`provider.routes.ts`, `session-user-state.routes.ts`), inside one `//----------------- ROUTE PARAMETER PARSING ------------` group. `provider.routes.ts` imports them back from `@/shared/utils.js` and no longer declares them.
- `modules/providers/services/session-user-state.service.ts` (**new**, ≤ 100 lines). It exports `sessionUserStateService`, with a consumer comment naming `session-user-state.routes.ts`. Its imports: `sessionUserStateDb` from `@/modules/database/index.js`, `broadcastSessionUpserted` from `@/modules/websocket/index.js` (the barrel `sessions.service.ts:6` uses), and `AppError` from `@/shared/utils.js`.
  - `setIconById(sessionId: string, icon: string | null): { sessionId: string; icon: string | null }`
  - `moveInSimpleListById(sessionId: string, afterSessionId: string | null): { sessionId: string; afterSessionId: string | null }`
  - Each calls its DB method. On `false` it throws `new AppError('Session "<id>" was not found.', { code: 'SESSION_NOT_FOUND', statusCode: 404 })`, the shape of `renameSessionById` (sessions.service.ts:740-743). On success it fires `void broadcastSessionUpserted(sessionId).catch(<log>)` and returns the result object.
- `modules/providers/session-user-state.routes.ts` (**new**, ≤ 110 lines): `export const sessionUserStateRoutes = Router()`, with a consumer comment naming `provider.routes.ts`. Each route follows the shape of `POST /sessions/:sessionId/fork` (provider.routes.ts:837-844):
  - `PUT /sessions/:sessionId/icon`, body `{ icon: string | null }`, answers `200 { sessionId, icon }`.
  - `PUT /sessions/:sessionId/simple-list-position`, body `{ afterSessionId: string | null }`, answers `200 { sessionId, afterSessionId }`.
  - File-local parsers in the shape of `parseSessionRenameSummary` (provider.routes.ts:338-363):
    - `parseSessionIconBody(payload: unknown): string | null` accepts `icon === null`, or a string matching `/^[a-z0-9-]{1,40}$/`. Anything else, including a missing key, throws AppError 400 `INVALID_SESSION_ICON`.
    - `parseSimpleListPositionBody(payload: unknown, sessionId: string): string | null` accepts `afterSessionId === null`, or a string passing `parseSessionId` and not equal to `sessionId`. Anything else throws AppError 400 `INVALID_SIMPLE_LIST_POSITION`.
  - Its `Router`, `Request`/`Response`, `asyncHandler`, `AppError` and `createApiSuccessResponse` imports copy `provider.routes.ts`'s own import lines.
- `modules/providers/provider.routes.ts` (939 lines; net lines go DOWN): the moved parser block is deleted; one import line is added for the moved symbols and one for `sessionUserStateRoutes`; one mount line `router.use(sessionUserStateRoutes);` goes directly after the `PUT /sessions/:sessionId` route (line 846-854). No route is added here.
- `modules/providers/services/sessions.service.ts` (749 lines; ≤ 8 added).
  - `RecentSessionListItem` (line 40-43) becomes that same `Pick<…>` `& { icon: string | null; unread: boolean }`.
  - The `listRecentSessions` mapper (line 214-221) gains `icon: session.icon ?? null,` and `unread: Boolean(session.unread),`.

Client (`@/` = `src/`; `type`, never `interface`; `import type` for types):

- `src/shared/types.ts` `RecentConversationListItem` (line 1536-1539) becomes `Pick<ArchivedSessionListItem, 'sessionId' | 'provider' | 'projectId' | 'projectDisplayName' | 'sessionTitle' | 'lastActivity'> & { icon: string | null; unread: boolean }`. Its comment gains one sentence: `icon` is the chat's chosen icon name or null for default, and `unread` means its last run finished while it was not on screen and it has not been on screen since.
- `src/shared/api.ts`: two helpers directly after `renameSession` (line 286-287), in its style. Each returns the `Response`.
  - `setSessionIcon: (sessionId: string, icon: string | null) => put(\`/api/providers/sessions/${encodeURIComponent(sessionId)}/icon\`, { icon })`
  - `moveSimpleListSession: (sessionId: string, afterSessionId: string | null) => put(\`/api/providers/sessions/${encodeURIComponent(sessionId)}/simple-list-position\`, { afterSessionId })`
- `src/modules/sidebar/hooks/useSimpleChatList.ts` (156 lines; `patchLocal` lands in Phase 5, `moveLocal` in Phase 7).
  - `renameLocal` (line 144-148) is **replaced** by `patchLocal: (sessionId: string, patch: Partial<Pick<RecentConversationListItem, 'sessionTitle' | 'icon'>>) => void`, which merges `patch` into the matching row.
  - It gains `moveLocal: (sessionId: string, afterSessionId: string | null) => void`. Null puts the row first. Otherwise the row goes directly after `afterSessionId`, and the rows stay unchanged when either id is not loaded.
  - The return type (line 36-46) and the return object (line 155) are updated to match. Its one consumer, `SidebarSimpleList.tsx:140`, becomes `patchLocal(sessionId, { sessionTitle: title })`.
  - `unread` is never patched locally: it changes only on the server, and the list reloads on the `session_upserted` the server broadcasts.
- `src/modules/sidebar/SidebarSessionIcon.tsx` (**new**, ≤ 80 lines).
  - `export const SIMPLE_CHAT_ICONS: Readonly<Record<string, LucideIcon>>`, with exactly these 24 entries in this order: `bot` Bot · `code` Code · `terminal` Terminal · `bug` Bug · `rocket` Rocket · `lightbulb` Lightbulb · `book-open` BookOpen · `pen-line` PenLine · `wrench` Wrench · `database` Database · `globe` Globe · `shield` Shield · `star` Star · `heart` Heart · `flame` Flame · `zap` Zap · `music` Music · `camera` Camera · `briefcase` Briefcase · `house` House · `calendar` Calendar · `flask-conical` FlaskConical · `sparkles` Sparkles · `palette` Palette.
  - `export function SimpleChatIconGlyph({ icon, className }: { icon: string | null; className?: string })` renders `SIMPLE_CHAT_ICONS[icon]`, or `MessageSquare` when `icon` is null or not in the map, with `aria-hidden`.
  - Both carry consumer comments naming `SidebarSimpleListRow.tsx` and `SidebarSimpleIconPicker.tsx`, the only two readers.
- `src/modules/sidebar/SidebarSimpleIconPicker.tsx` (**new**, ≤ 110 lines): `export default function SidebarSimpleIconPicker({ open, currentIcon, onPick, onCancel, t }: { open: boolean; currentIcon: string | null; onPick: (icon: string | null) => void; onCancel: () => void; t: TFunction })`. It is a shared `Dialog` in the exact shape of `SidebarSimpleStopDialog.tsx`, holding:
  - the title `t('simpleList.iconTitle')`;
  - a 6-column grid of 25 `Button variant="ghost" size="icon"` options. The first is **Default** (`data-icon="default"`, glyph `MessageSquare`, `aria-label={t('simpleList.iconDefault')}`); the rest follow `SIMPLE_CHAT_ICONS` order (imported from `@/modules/sidebar/SidebarSessionIcon`) with `data-icon={name}` and `aria-label={t('simpleList.iconOption', { name: name.replace(/-/g, ' ') })}`.
  - The current choice carries `aria-pressed="true"` and `ring-2 ring-primary`. Clicking an option calls `onPick(name)`, or `onPick(null)` for Default.
  - `data-testid`s: `simple-chat-icon-dialog` on `DialogContent`, and `simple-chat-icon-option` on every option.
- `src/modules/sidebar/hooks/useSimpleChatReorder.ts` (**new**, module-private, ≤ 200 lines): `export function useSimpleChatReorder(input: { rows: RecentConversationListItem[]; onMove: (sessionId: string, afterSessionId: string | null) => void }): { draggingId: string | null; dropTarget: { sessionId: string; edge: 'before' | 'after' } | null; rowDragProps: (sessionId: string) => { onPointerDown: (event: React.PointerEvent<HTMLElement>) => void; onClickCapture: (event: React.MouseEvent<HTMLElement>) => void; onDragStart: (event: React.DragEvent<HTMLElement>) => void } }`. It uses pointer events and never HTML5 drag and drop.
  - **Start:** `pointerdown` arms a drag for primary-button mouse or pen presses anywhere on the row. A **touch** press arms one only when `event.target.closest('[data-drag-handle]')` matches. A press inside `button, input, [data-no-drag]` never arms.
  - **Threshold:** window `pointermove`/`pointerup`/`pointercancel` listeners are added on arm and removed on end and on unmount. The drag starts (`draggingId` set, selection cleared with `window.getSelection()?.removeAllRanges()`) after 5 px of movement.
  - **Target:** while dragging, the target row is found from the `[data-testid="simple-chat-row"]` elements under the closest `[data-testid="simple-chat-list"]`, by `clientY` against each rect's vertical midpoint. The result is `dropTarget`.
  - **Drop:** on `pointerup`, the drop order is computed by removing the dragged id and inserting it at the target (`after` → index + 1). `afterSessionId` is the id before it, or `null` at index 0. `onMove` is called only when that order differs from `rows`.
  - **After a drag:** the next click is swallowed once by `onClickCapture` (`preventDefault` + `stopPropagation`), so a drop never opens the chat.
  - **Cancel:** `pointercancel` and the `Escape` key cancel with no move.
  - **Native drag:** `onDragStart` calls `event.preventDefault()`, so the browser's own link or image drag never starts.
- `src/modules/sidebar/SidebarSimpleListRow.tsx` (160 lines; ends ≤ 240). The props type gains `onChooseIcon: () => void; dragProps: Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'> | null;` (with `import type { HTMLAttributes } from 'react'`) ` isDragging: boolean; dropEdge: 'before' | 'after' | null;`. The row (outer div, line 55-67) changes as follows.
  - **Outer div:** gains `relative`, spreads `dragProps` when non-null, and carries `data-dragging={isDragging ? 'true' : 'false'}` and `data-drop-edge={dropEdge ?? undefined}`.
    - `opacity-50` applies while dragging.
    - When `dropEdge` is set, a `pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary` bar is drawn at `top-0` (before) or `bottom-0` (after).
  - **Leading icon:** the new first child, before the rename/link branch (line 68), is `<span data-testid="simple-chat-icon" data-drag-handle data-icon={row.icon ?? 'default'} title={t('simpleList.dragHandle')} className="flex h-7 w-6 flex-shrink-0 touch-none cursor-grab items-center justify-center text-muted-foreground"><SimpleChatIconGlyph icon={row.icon} className="h-4 w-4" /></span>`, with `SimpleChatIconGlyph` imported from `@/modules/sidebar/SidebarSessionIcon`.
  - **Link:** the `<a>` (line 83-105) gains `draggable={false}`.
  - **Unread dot:** placed where the running spinner sits (line 108-117) and rendered only when `row.unread && !isSelected && !isRunning && !isEditing`: `<span data-testid="simple-chat-unread" role="img" aria-label={t('simpleList.unread')} title={t('simpleList.unread')} className="mx-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />`.
  - **Menu:** the ActionMenu `items` (line 130-154) gain, directly after `simple-chat-rename`: `{ key: 'simple-chat-icon', label: t('simpleList.changeIcon'), icon: Smile, onSelect: onChooseIcon }`.
- `src/modules/sidebar/SidebarSimpleList.tsx` (226 lines; ends ≤ 280).
  - The row wrapper `<div className="flex flex-col gap-1">` (line 179) gains `data-testid="simple-chat-list-rows"`, plus `select-none` while `draggingId !== null`. The `simple-chat-list` root testid already exists and is not moved.
  - It calls `useSimpleChatReorder({ rows, onMove: handleMove })`. `handleMove(id, after)` runs `moveLocal(id, after)` and then `api.moveSimpleListSession(id, after)`; a non-ok response or a throw runs `reload()`.
  - It owns one state `iconTarget: RecentConversationListItem | null`, commented, for the row whose picker is open.
    - `handlePickIcon(icon)` closes the picker, runs `patchLocal(target.sessionId, { icon })` and then `api.setSessionIcon`. Failure reverts with `patchLocal(target.sessionId, { icon: target.icon })`.
    - `<SidebarSimpleIconPicker open={iconTarget !== null} currentIcon={iconTarget?.icon ?? null} onPick={handlePickIcon} onCancel={() => setIconTarget(null)} t={t} />` renders beside the two existing dialogs (line 208-223).
  - Each `SidebarSimpleListRow` (line 181-192) additionally receives `onChooseIcon={() => setIconTarget(row)}`, `dragProps={rowDragProps(row.sessionId)}`, `isDragging={draggingId === row.sessionId}` and `dropEdge={dropTarget?.sessionId === row.sessionId ? dropTarget.edge : null}`.
- i18n, `sidebar.json` → `simpleList.*`, all 11 locales (`de en es fr it ja ko ru tr zh-CN zh-TW`) with translated values. The `en` values:
  - `changeIcon` "Change icon"
  - `iconTitle` "Choose an icon"
  - `iconDefault` "Default"
  - `iconOption` "{{name}} icon" (every locale keeps the `{{name}}` placeholder)
  - `unread` "Finished, not read yet"
  - `dragHandle` "Drag to reorder"

Proof files (`.verify/` is git-ignored; Playwright from `/opt/shadow-connector/node_modules/playwright/index.js`):

- `.verify/probe-sidebar-state-api.mjs` (Phase 2): final line `SIDEBAR-STATE-API PASS` or `SIDEBAR-STATE-API FAIL`; gates `[PASS] A1` … `[PASS] A8`; artifacts `.verify/artifacts/sidebar-state-api.json` = `{ "sessionIds": [...] }`.
- `.verify/probe-simple-icons-unread.mjs` (Phase 5): final line `SIMPLE-ICONS-UNREAD PASS|FAIL`; gates `[PASS] B1` … `[PASS] B8`; artifacts `.verify/artifacts/simple-icons-unread.json`.
- `.verify/probe-simple-reorder.mjs` (Phase 7): final line `SIMPLE-REORDER PASS|FAIL`; gates `[PASS] C1` … `[PASS] C7`; artifacts `.verify/artifacts/simple-reorder.json`.

## Project Constraints

- **No unit tests, ever.** Add no `*.test.ts(x)` file, no `tests/` addition and no vitest config edit. `.agents/skills/*/SKILL.md` asks for module tests; the operator's global rule overrides it. Verification is this plan's `check`/`verify` commands, run against the running dev server.
- **Never commit, push, branch, stash, checkout, restore or reset inside the run;** the tree accumulates.
  - Other sessions may have uncommitted edits in any file here. Edit files where they stand.
  - Never revert or "clean up" a change that is not yours, and never treat one as a fence.
  - A probe is undone by deleting what it created (API `DELETE …?force=true`, removing files it wrote), never through git.
- **The dev server is two systemd units:** `cloudcli-server-dev` (API, 127.0.0.1:3011) and `cloudcli-client-dev` (Vite, :5183).
  - Never restart either by hand. Never run `npm run dev`, `server:dev` or `npm run build`.
  - A save under `server/` hands the API over to a freshly booted server, which runs migrations on boot. Make ALL of a phase's server edits in one consecutive pass, and run checks only after the last server file is saved.
  - Vite hot-reloads `src/`.
- **Backend law** (`.agents/skills/backend-module-standards/SKILL.md`):
  - TypeScript only under `server/modules/`.
  - "Import another feature module only through that module's `index.ts`. Never deep-import another module's routes, services, repositories, adapters, or internal files" (L22). Use the `@/` alias with a `.js` suffix.
  - "Move a utility used in two or more locations to `server/shared/utils.ts`" (L33), with "a detailed doc comment" (L35) and the grouping-comment format (L36).
  - `type` over `interface`.
  - Routes: "Parse and validate transport input in the route, convert it to the service's expected typed input, call one or more services, and translate the result to the response" (L48). "Keep business logic, persistence, filesystem work, subprocess execution, and orchestration out of routes" (L49).
  - "Export a function or variable at its declaration" (L40), with a comment naming its consumers (L42).
- **Frontend law** (`.agents/skills/frontend-module-standards/SKILL.md`):
  - `@/...` imports only, never `./` or `../`; `import type` for every type-only import (L19-23).
  - `type`, never `interface` (L66-72).
  - "Define a type directly in its sole owning component or implementation file when only that file uses it", and a type used by two or more files goes in `src/shared/types.ts` (L76-77).
  - Module-private hooks live in `src/modules/sidebar/hooks/` (L114).
  - "For every exported component, add a brief comment at its definition naming the consuming module or modules" (L52).
  - "Add a brief comment immediately above every newly introduced state declaration explaining why the state is essential" (L144). No module-local `types.ts`, `utils.ts` or `constants.ts`.
- **Verve** (`src/shared/ui/verve/README.md`):
  - "Colour reaches a screen through Tailwind, never as a literal … not hex, not `var(--…)`" (L29-34).
  - "a green WORD is `text-accent-ink`, a green SHAPE is `text-primary`" (L37-38). So the unread dot is `bg-primary` and the drop bar is `bg-primary`; never `bg-green-*` or `bg-emerald-*`.
  - Compose library components from the barrel `@/shared/ui` (`Button`, `Dialog`, `DialogContent`, `DialogTitle`, `Tooltip`, `ActionMenu`), and add no file under `src/shared/ui/`.
  - Icons come from `lucide-react` (already a dependency, `^0.515.0`).
  - Colour is never the whole signal: the dot carries `aria-label` and `title` text.
- **No new npm dependency.** Specifically, no `@dnd-kit/*`, `react-dnd`, `sortablejs` or `framer-motion`.
- **Module size:** a new file stays within the LOC named in Interfaces. Files already over 300 lines take only what Interfaces names:
  - `provider.routes.ts`: net lines down, and no route added
  - `sessions.db.ts` ≤ 15
  - `sessions.service.ts` ≤ 8
  - `chat-run-registry.service.ts` ≤ 25
  - `chat-websocket.service.ts` ≤ 20
  - `src/shared/types.ts` and `src/shared/api.ts` only the lines named
- **Checks:** `npm run typecheck` must exit 0, and `npm run lint` must exit 0 with no warning naming a file this plan CREATES. The whole-repo warning count moves with other sessions and is not a gate.
- **i18n:** every new user-facing string is an i18n key present in all 11 locales. Parity is checked over this plan's six `simpleList.*` keys only; several locales already lack older keys, which is not this plan's to close.
- **Screenshots:** the operator asked that screenshots not be posted in chat. A probe may write screenshots under `.verify/shots/`; a report names their paths only and never attaches, embeds or pastes an image.
- **Healed means deleted:** no commented-out code, no "old" variants and no compatibility shims. `renameLocal` is replaced, not kept beside `patchLocal`, and `parseSessionId` is moved, not copied.
- **Scaffold and fill** (`PLAN_FORMAT_V2.md` §5 `kind`; `~/.claude/charters/iris/SKILL.md` §"The scaffold"): each UI change is two phases.
  - **The scaffold** (Iris) writes the composition only.
  - **Markers.** Every handler, state or hook the composition needs is a placeholder: a standalone `// FILL: <name>` line in statement position, directly above exactly ONE placeholder line written with `as` (`const x = null as T | null;`). A marker never sits inside JSX.
  - **The snapshot.** The scaffold's last verify copies its files to `.verify/scaffolds/<name>/<file>.snap`.
  - **The fill** (Hephaestus) replaces each marker line and its one placeholder line. It may add lines only at a marker site, or as whole import lines inside the import block, and it edits, deletes or reorders no other line of the scaffold files. A scaffold line the fill must change (an import it extends, a dependency array) carries its own marker.
  - **Its verify proves three things.** Zero `FILL:` remain. The files render (Vite answers 200 and the probe passes). Aligned with `difflib`, the snapshot minus its marker+placeholder pairs matches the shipped file line for line, except insertions at a marker site or import lines in the import block. The first other difference is printed with its shipped line number.
- **Standing stop rule:** when reality diverges from this plan, stop. That covers a file or symbol not where an anchor says, a signature that differs, or a check failing for a reason the plan did not name. Report the divergence verbatim with `RESULT: BLOCKED`, and do not improvise a fix.

## Phase 1 — Server: the four columns, completion and read from presence, icon and order routes
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "server/modules/database/schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/database/repositories/sessions.db.ts",
  "server/modules/database/repositories/session-user-state.db.ts",
  "server/modules/database/index.ts",
  "server/modules/notifications/services/session-presence.service.ts",
  "server/modules/notifications/index.ts",
  "server/modules/providers/services/sessions.service.ts",
  "server/modules/providers/services/session-user-state.service.ts",
  "server/modules/providers/session-user-state.routes.ts",
  "server/modules/providers/provider.routes.ts",
  "server/modules/providers/README.md",
  "server/shared/utils.ts",
  "server/modules/websocket/services/chat-run-registry.service.ts",
  "server/modules/websocket/services/chat-websocket.service.ts",
  "server/modules/websocket/README.md",
]
forbidden = [
  "src",
  "server/modules/websocket/services/session-upsert-broadcast.service.ts",
  "server/modules/providers/services/sessions-watcher.service.ts",
  "server/modules/notifications/services/notification-orchestrator.service.js",
]
athena = [
  "recordRunCompletion is called outside the `message.kind === 'complete'` block, or before the duplicate-complete early return at line 99-101, so a second complete stamps twice or a non-terminal event stamps",
  "A throw from markRunCompleted, isSessionOnScreen or a rejected broadcast escapes decorateAndRecordEvent or handleChatPresence and drops the complete frame or the presence record",
  "markRunCompleted with alsoRead writes last_read_at with a separate strftime call in a separate statement, so read can land a millisecond before completed and the on-screen chat reads unread",
  "markReadIfCompleted writes or broadcasts on every 30 s presence heartbeat for an already-read session (the unread guard or the changes>0 guard missing), or a presence frame with visible false marks read",
  "isSessionOnScreen keeps a user filter (registry runs carry no user, so it would always answer false), ignores visible, or ignores the freshness window isSessionWatched uses, or keeps a second presence store",
  "The unread rule or the next-top-rank rule is written out again anywhere instead of reading SESSION_UNREAD_SQL / NEXT_TOP_SIMPLE_LIST_RANK_SQL",
  "moveInSimpleList's collapse guard never triggers or the renumber loses, duplicates or reorders a row other than the moved one",
  "The non-simple ORDER BY or either WHERE of getRecentSessionsPage changed, so the project tree's recents feed moved",
  "parseSessionId is copied rather than moved, or a symbol it references is left behind and provider.routes.ts no longer compiles its other parsers",
  "A new route landed in provider.routes.ts instead of session-user-state.routes.ts, or the sibling router is mounted after a catch-all so its routes never match",
]

[[steps]]
kind = "edit"
path = "server/modules/database/schema.ts"
what = "Add the four columns `simple_list_rank REAL,` `icon TEXT,` `last_completed_at TEXT,` `last_read_at TEXT,` to SESSIONS_TABLE_SCHEMA_SQL directly after `simple_list_at DATETIME,` in that order (Interfaces, four new nullable columns), each with a one-line comment in its neighbours' style."
check = '''echo $(grep -c 'simple_list_rank REAL' server/modules/database/schema.ts) $(grep -c 'icon TEXT' server/modules/database/schema.ts) $(grep -c 'last_completed_at TEXT' server/modules/database/schema.ts) $(grep -c 'last_read_at TEXT' server/modules/database/schema.ts)'''
expect = "1 1 1 1"

[[steps]]
kind = "edit"
path = "server/modules/database/migrations.ts"
what = "Add addSessionUserStateColumns(db) per Interfaces (four addColumnToTableIfNotExists calls, then the idempotent simple_list_rank backfill from julianday(simple_list_at)); call it on the line after addSimpleListAtColumn(db); add the idx_sessions_simple_list_rank index beside idx_sessions_simple_list_at."
check = '''echo $(grep -c 'addSessionUserStateColumns' server/modules/database/migrations.ts) $(grep -c 'idx_sessions_simple_list_rank' server/modules/database/migrations.ts) $(grep -c 'julianday(simple_list_at)' server/modules/database/migrations.ts)'''
expect_re = "^[2-9] 1 1$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/session-user-state.db.ts"
what = "Create SESSION_UNREAD_SQL, NEXT_TOP_SIMPLE_LIST_RANK_SQL and sessionUserStateDb (markRunCompleted(sessionId, alsoRead) as ONE UPDATE, markReadIfCompleted guarded by SESSION_UNREAD_SQL, setIcon, moveInSimpleList in one db.transaction IIFE whose move-to-top reads NEXT_TOP_SIMPLE_LIST_RANK_SQL, with the midpoint rule and the renumber collapse guard) exactly per Interfaces, each exported at declaration with a consumer comment."
check = '''f=server/modules/database/repositories/session-user-state.db.ts; echo $(grep -c 'export const SESSION_UNREAD_SQL' $f) $(grep -c 'export const NEXT_TOP_SIMPLE_LIST_RANK_SQL' $f) $(grep -c 'export const sessionUserStateDb' $f) $(grep -c '${SESSION_UNREAD_SQL}' $f) $(grep -c '${NEXT_TOP_SIMPLE_LIST_RANK_SQL}' $f) $(grep -c 'db.transaction' $f) $(wc -l < $f | awk '{print ($1<=170)?"small":"big"}')'''
expect_re = "^1 1 1 [1-9] [1-9] [1-9] small$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/sessions.db.ts"
what = "Extend SessionRow (four columns plus optional unread) and SESSION_ROW_COLUMNS; import the two SQL constants from session-user-state.db.js; write simple_list_rank in createAppSession as CASE WHEN ? = 1 THEN ${NEXT_TOP_SIMPLE_LIST_RANK_SQL} ELSE NULL END; make the page SELECT `sessions.*, (${SESSION_UNREAD_SQL}) AS unread`; change ONLY the simpleListOnly ORDER BY to `sessions.simple_list_rank DESC, sessions.session_id DESC`."
check = '''f=server/modules/database/repositories/sessions.db.ts; echo $(grep -c 'NEXT_TOP_SIMPLE_LIST_RANK_SQL' $f) $(grep -c 'SESSION_UNREAD_SQL' $f) $(grep -c 'AS unread' $f) $(grep -c 'sessions.simple_list_rank DESC' $f) $({ grep -c 'last_read_at < ' $f || true; })'''
expect_re = "^[2-9] [2-9] 1 1 0$"

[[steps]]
kind = "edit"
path = "server/modules/database/index.ts"
what = "Re-export sessionUserStateDb beside the existing sessionsDb export, in exactly the same form as that export line. Do not re-export the two SQL constants."
check = '''echo $(grep -c 'sessionUserStateDb' server/modules/database/index.ts) $({ grep -c 'SESSION_UNREAD_SQL' server/modules/database/index.ts || true; })'''
expect_re = "^[1-9] 0$"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/session-presence.service.ts"
what = "Add isSessionOnScreen(sessionId) beside isSessionWatched per Interfaces: any socket's recorded presence naming the session, visible, inside the same freshness window isSessionWatched uses; no user filter; the same presence store; exported at declaration with a consumer comment naming the run registry."
check = '''f=server/modules/notifications/services/session-presence.service.ts; echo $(grep -c 'export function isSessionOnScreen' $f) $(grep -c 'isSessionWatched' $f | awk '{print ($1>=1)?"sibling":"missing"}')'''
expect = "1 sibling"

[[steps]]
kind = "edit"
path = "server/modules/notifications/index.ts"
what = "Re-export isSessionOnScreen from the barrel in the same form as its other exports."
check = '''grep -c 'isSessionOnScreen' server/modules/notifications/index.ts'''
expect_re = "^[1-9]$"

[[steps]]
kind = "edit"
path = "server/shared/utils.ts"
what = "Move parseSessionId and every file-local symbol it references (SESSION_ID_PATTERN, readPathParam) here from provider.routes.ts, each exported at declaration with a detailed doc comment naming provider.routes.ts and session-user-state.routes.ts, inside one ROUTE PARAMETER PARSING group comment in this file's grouping format."
check = '''f=server/shared/utils.ts; echo $(grep -c 'export const parseSessionId\|export function parseSessionId' $f) $(grep -c 'ROUTE PARAMETER PARSING' $f)'''
expect = "1 1"

[[steps]]
kind = "edit"
path = "server/modules/providers/services/session-user-state.service.ts"
what = "Create sessionUserStateService with setIconById and moveInSimpleListById per Interfaces: DB call, AppError 404 SESSION_NOT_FOUND on false (shape of renameSessionById), then void broadcastSessionUpserted(sessionId).catch(log) on success; imports only through the database and websocket barrels."
check = '''f=server/modules/providers/services/session-user-state.service.ts; echo $(grep -c 'export const sessionUserStateService' $f) $(grep -c 'broadcastSessionUpserted' $f | awk '{print ($1>=2)?"broadcasts":"silent"}') $(grep -c "from '@/modules/websocket/index.js'" $f) $(grep -c 'SESSION_NOT_FOUND' $f | awk '{print ($1>=1)?"404":"no404"}')'''
expect = "1 broadcasts 1 404"

[[steps]]
kind = "edit"
path = "server/modules/providers/session-user-state.routes.ts"
what = "Create sessionUserStateRoutes (Router) with PUT /sessions/:sessionId/icon and PUT /sessions/:sessionId/simple-list-position, the file-local parseSessionIconBody and parseSimpleListPositionBody (400 INVALID_SESSION_ICON / INVALID_SIMPLE_LIST_POSITION), parseSessionId imported from @/shared/utils.js; each route parses, calls sessionUserStateService, answers createApiSuccessResponse."
check = '''f=server/modules/providers/session-user-state.routes.ts; echo $(grep -c "'/sessions/:sessionId/icon'" $f) $(grep -c "'/sessions/:sessionId/simple-list-position'" $f) $(grep -c 'INVALID_SESSION_ICON' $f | awk '{print ($1>=1)?"icon400":"none"}') $(grep -c 'INVALID_SIMPLE_LIST_POSITION' $f | awk '{print ($1>=1)?"pos400":"none"}') $(wc -l < $f | awk '{print ($1<=110)?"small":"big"}')'''
expect = "1 1 icon400 pos400 small"

[[steps]]
kind = "edit"
path = "server/modules/providers/provider.routes.ts"
what = "Delete the moved parseSessionId, SESSION_ID_PATTERN and readPathParam declarations and import them from @/shared/utils.js; import sessionUserStateRoutes; add router.use(sessionUserStateRoutes); directly after the PUT /sessions/:sessionId route. Add no route here."
check = '''f=server/modules/providers/provider.routes.ts; echo $({ grep -c 'const parseSessionId' $f || true; }) $(grep -c 'router.use(sessionUserStateRoutes)' $f) $({ grep -c '/icon\|simple-list-position' $f || true; }) $(wc -l < $f | awk '{print ($1<=939)?"shrunk":"grew"}')'''
expect = "0 1 0 shrunk"

[[steps]]
kind = "edit"
path = "server/modules/providers/services/sessions.service.ts"
what = "Widen RecentSessionListItem with `& { icon: string | null; unread: boolean }` and add `icon: session.icon ?? null,` and `unread: Boolean(session.unread),` to the listRecentSessions mapper."
check = '''f=server/modules/providers/services/sessions.service.ts; echo $(grep -c 'unread: boolean' $f) $(grep -c 'unread: Boolean(session.unread)' $f) $({ grep -c 'last_read_at' $f || true; })'''
expect = "1 1 0"

[[steps]]
kind = "edit"
path = "server/modules/websocket/services/chat-run-registry.service.ts"
what = "Import sessionUserStateDb on line 1 beside sessionsDb and isSessionOnScreen from @/modules/notifications/index.js; add file-local recordRunCompletion(appSessionId) after recordProviderSessionId, shaped like it: markRunCompleted(appSessionId, isSessionOnScreen(appSessionId)) then broadcastSessionUpserted, try/catch, never throws; call recordRunCompletion(run.appSessionId) on the line after run.completedAt = Date.now()."
check = '''f=server/modules/websocket/services/chat-run-registry.service.ts; echo $(grep -c 'recordRunCompletion' $f) $(grep -c 'markRunCompleted(appSessionId, isSessionOnScreen(appSessionId))' $f) $(grep -c "from '@/modules/notifications/index.js'" $f) $(awk '/run.completedAt = Date.now\(\);/{getline; print}' $f | grep -c 'recordRunCompletion(run.appSessionId)')'''
expect = "2 1 1 1"

[[steps]]
kind = "edit"
path = "server/modules/websocket/services/chat-websocket.service.ts"
what = "Add file-local markReadIfCompleted(sessionId) per Interfaces (sessionUserStateDb.markReadIfCompleted, broadcast only when it returns true, try/catch, never throws) and call it from handleChatPresence right after the presence is recorded, only when the frame's visible is true and its sessionId is a non-empty string."
check = '''f=server/modules/websocket/services/chat-websocket.service.ts; echo $(grep -c 'markReadIfCompleted' $f | awk '{print ($1>=3)?"wired":"partial"}') $(grep -c 'sessionUserStateDb' $f | awk '{print ($1>=2)?"imported":"missing"}')'''
expect = "wired imported"

[[steps]]
kind = "edit"
path = "server/modules/providers/README.md"
what = "Beside the existing prose about POST /api/providers/sessions simpleList and GET /sessions/recent (around line 108-109), add a short paragraph naming the two routes in session-user-state.routes.ts, their bodies and answers, the icon and unread fields on the recent feed, and that the simple list orders by simple_list_rank."
check = '''echo $(grep -c 'simple-list-position' server/modules/providers/README.md) $(grep -c 'session-user-state.routes.ts' server/modules/providers/README.md)'''
expect_re = "^[1-9] [1-9]$"

[[steps]]
kind = "edit"
path = "server/modules/websocket/README.md"
what = "In the Service Map rows for chat-run-registry.service.ts and chat-websocket.service.ts and in 'Shared Client Registry and Broadcasts', state that the registry stamps last_completed_at once per run end (and last_read_at with it when the chat is on screen) and broadcasts session_upserted, and that a visible chat.presence marks an unread session read and broadcasts only when a row changed."
check = '''echo $(grep -c 'last_completed_at' server/modules/websocket/README.md) $(grep -c 'markReadIfCompleted\|last_read_at' server/modules/websocket/README.md)'''
expect_re = "^[1-9] [1-9]$"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL'''
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = '''out=$(npm run lint 2>&1); code=$?; n=$(printf '%s\n' "$out" | { grep -c 'session-user-state' || true; }); echo "exit=$code new_file_warnings=$n"'''
expect = "exit=0 new_file_warnings=0"
timeout_s = 300

[[verify]]
cmd = '''awk '/SESSIONS_TABLE_SCHEMA_SQL/{f=1} f{print} f&&/`;/{exit}' server/modules/database/schema.ts | { grep -ci 'user' || true; }'''
expect = "0"

[[verify]]
cmd = '''for i in $(seq 1 45); do n=$(node -e "const D=require('better-sqlite3');const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const c=db.prepare('PRAGMA table_info(sessions)').all().map(r=>r.name);console.log(['simple_list_rank','icon','last_completed_at','last_read_at'].filter(x=>c.includes(x)).length)"); [ "$n" = 4 ] && break; sleep 1; done; echo "columns=$n"'''
expect = "columns=4"
timeout_s = 90

[[verify]]
cmd = '''T=$(curl -s http://127.0.0.1:3011/api/auth/login -H 'content-type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token'); U=00000000-0000-4000-8000-000000000000; B="http://127.0.0.1:3011/api/providers/sessions/$U"; b=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"icon":"rocket"}' "$B/icon"); c=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"afterSessionId":null}' "$B/simple-list-position"); d=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"icon":"Bad Name!"}' "$B/icon"); echo "$b $c $d"'''
expect = "404 404 400"
timeout_s = 60
```

**What to build.** Everything under "Server" in Interfaces, in the order of the steps. Save every server file in one pass before running any check: each save hands the API over, and migrations run on the new server's boot.

**Anchors to copy.**
- The migration shape: `addSimpleListAtColumn` (migrations.ts:440-443), and the backfill in `addProviderSessionIdMapping` (migrations.ts:398-408).
- A single-column setter: `setSessionModel` (sessions.db.ts:421-428).
- The transaction IIFE: sessions.db.ts:227.
- A route: `POST /sessions/:sessionId/fork` (provider.routes.ts:837-844). A body parser: `parseSessionRenameSummary` (provider.routes.ts:338-363).
- The 404: `renameSessionById` (sessions.service.ts:737-748).
- The try/catch + broadcast: `recordProviderSessionId` (chat-run-registry.service.ts:141-166).
- The presence handler: `handleChatPresence` (chat-websocket.service.ts:538-544). The watched-session check and its 90 s window: `isSessionWatched` in `session-presence.service.ts` (`docs/notifications.md` L210-221).

**Sirens.**
- **Rows that drop fields.** You will see `normalizeSessionRows` applied to the page rows. If it rebuilds rows field by field and drops the new columns or `unread`, add those fields to it and name the line in your report. Do not select them a second way.
- **Keeping the user filter.** You will want `isSessionOnScreen` to take a user id "for safety", like `isSessionWatched`. A `ChatRun` carries no user (chat-run-registry.service.ts:34-46), and `sessions` has no user column (this phase's first verify proves it), so a user filter would answer false for every run. No user filter.
- **Wrong session ids.** If the presence store is keyed by something other than the app session id the chat sends, stop and report the store's shape verbatim with `RESULT: BLOCKED`. The same applies if `handleChatPresence` is not at chat-websocket.service.ts:538-544 or not in this file.
- **The sibling notifier.** You will be tempted to stamp completion inside each provider runtime, next to `notifyRunStopped`. Do not. `decorateAndRecordEvent` is the one choke point.
- **Two presence stores.** You will want to keep a second "on screen" set in the websocket module. Presence has one store; read it through the notifications barrel.
- **Writing a rule out again.** You will want to inline the unread comparison in the mapper or the rank expression in the move. Both rules are written once, as the two exported constants; the mapper reads `Boolean(session.unread)`.
- **Parser leftovers.** When you move `parseSessionId`, you may find that another parser in `provider.routes.ts` also calls `readPathParam`. It still moves; `provider.routes.ts` imports it back.
- **The file size.** You will notice `provider.routes.ts` is over the 800-line ceiling. Do not split it; this phase only shrinks it.
- **A failed hand-over.** If the second verify prints `columns=` below 4 after 45 s, read `journalctl -u cloudcli-server-dev -n 60 --no-pager`. Report the `[supervisor] boot failed` line verbatim with `RESULT: BLOCKED`.

## Phase 2 — Proof of the server: order, icon, completion, and read from a real presence frame, for zero turns
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "opus"
code_change = false
doc_sweep = "foreground"
expected_s = 2400
manifest = [".verify/probe-sidebar-state-api.mjs", ".verify/artifacts/sidebar-state-api.json"]
forbidden = ["src", "server", ".verify/lib", ".verify/ntfy"]
athena = [
  "A7 passes on the DB column alone without observing the session_upserted frame after the complete, so a registry that stamps but never broadcasts passes",
  "A8's hidden-presence half is read before the server could have acted (no wait), or the visible half passes without checking that a repeated visible frame broadcasts nothing",
  "The order gates compare against rows the probe did not create, or read the order from the probe's own list instead of GET /recent?simpleList=true",
  "The stress gate never reaches the renumber path (fewer than 40 alternating moves into the same gap), so the collapse guard is unproven",
  "Cleanup skips the untagged session or the cursor session's project row, leaving residue in the operator's database",
  "The probe spends a Claude turn: any chat.send to a claude session",
]

[[steps]]
kind = "edit"
path = ".verify/probe-sidebar-state-api.mjs"
what = "Write the Node API probe described in the phase body: sign-in and cursor-run helpers from .verify/lib/ntfy.mjs as run-failed-probe.mjs uses them, gates A1-A8 printing [PASS]/[FAIL] An, real chat.presence frames in A8, artifacts file, cleanup in finally, final line SIDEBAR-STATE-API PASS or FAIL."
check = '''node --check .verify/probe-sidebar-state-api.mjs && echo $(grep -c 'A[1-8]' .verify/probe-sidebar-state-api.mjs | awk '{print ($1>=8)?"gates":"few"}') $(grep -c 'chat.presence' .verify/probe-sidebar-state-api.mjs | awk '{print ($1>=1)?"presence":"none"}') $(grep -c 'force=true' .verify/probe-sidebar-state-api.mjs | awk '{print ($1>=1)?"cleanup":"none"}')'''
expect = "gates presence cleanup"

[[steps]]
kind = "run"
cmd = "node .verify/probe-sidebar-state-api.mjs"
check = '''node .verify/probe-sidebar-state-api.mjs 2>&1 | tail -1'''
expect = "SIDEBAR-STATE-API PASS"
timeout_s = 300

[[verify]]
cmd = '''node .verify/probe-sidebar-state-api.mjs 2>&1 | grep -c '^\[PASS\] A[1-8]' '''
expect = "8"
timeout_s = 300

[[verify]]
cmd = '''node -e "const D=require('better-sqlite3');const fs=require('fs');const ids=JSON.parse(fs.readFileSync('.verify/artifacts/sidebar-state-api.json','utf8')).sessionIds;const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const left=ids.filter(id=>db.prepare('select 1 from sessions where session_id=?').get(id)).length;console.log('probeIds='+ids.length+' residue='+left)"'''
expect_re = "^probeIds=([5-9]|[1-9][0-9]) residue=0$"
```

**What to build.** One Node ESM script. It opens no browser and spends zero Claude turns.

**Header.**
- Read `.verify/ntfy/run-failed-probe.mjs` in full first. Import the same helpers it imports from `.verify/lib/ntfy.mjs`: sign-in, `createSession(provider, projectPath)` (ntfy.mjs:143-153) and `openChatSocket(token)` (ntfy.mjs:159-221, whose object has `subscribe(sessionId)` and `send(sessionId, content, options)`). Use them exactly as run-failed-probe.mjs:83-88 does, including its project registration for `/tmp/cloudcli-ntfy-probe` and its cleanup of that project row.
- A raw frame such as `chat.presence` goes over the same socket if the helper's object exposes the underlying `ws` or a raw sender. Otherwise, open a second socket to `ws://…/ws?token=` exactly as ntfy.mjs:159-221 does, and send the frame on it.
- Open the DB read-only the way `.verify/keepalive-lib.mjs` `createProbeSession` (lines 90-108) imports `better-sqlite3`, pointed at `~/.cloudcli/auth.db`.
- Every HTTP call goes to `http://127.0.0.1:3011` with the Bearer token.
- `ids()` = the `sessionId`s of `GET /api/providers/sessions/recent?simpleList=true&limit=100` in answer order, filtered to this probe's ids. Unwrap `data` when the envelope has it.
- `recentItem(id)` = that id's item in `GET /api/providers/sessions/recent?limit=100`, paging `offset` by 100 up to 500 until found.
- Every created session id is pushed to `created` and written to `.verify/artifacts/sidebar-state-api.json` as `{ "sessionIds": created }` immediately.

**Gates** (each prints `[PASS] An <what>` or `[FAIL] An <reason with the observed value>`):
1. **A1 columns.** `PRAGMA table_info(sessions)` lists `simple_list_rank`, `icon`, `last_completed_at` and `last_read_at`.
2. **A2 new chats on top.**
   - `POST /api/providers/sessions` with `{ provider: 'claude', projectPath: '/home/lyphe/.claude/claudecodeui_lyphe', simpleList: true }` three times, 50 ms apart → S1, S2, S3. Never send a chat frame to them.
   - `ids()` equals `[S3, S2, S1]`, and each row has `icon === null` and `unread === false`.
3. **A3 icon.**
   - `PUT …/S2/icon {"icon":"rocket"}` → 200, and the S2 row reads `icon === 'rocket'`.
   - `{"icon":null}` → 200 and `icon === null`.
   - `{"icon":"Bad Name!"}` → 400, `{}` → 400 and `{"icon":7}` → 400.
4. **A4 position.**
   - `PUT …/S1/simple-list-position {"afterSessionId":null}` → `ids()` `[S1, S3, S2]`.
   - `S3 after S2` → `[S1, S2, S3]`.
   - `S2 after S2` → 400.
   - A fourth session U created with `simpleList: false`: `S1 after U` → 404, and `U after null` → 404.
5. **A5 collapse guard.** Sixty times, alternately, move S3 `after S1` and S2 `after S1`. After every move, `ids()` has the moved id directly after S1 and holds exactly S1, S2, S3 once each. Pass iff all 60 hold; the `[FAIL]` line prints the iteration and the order.
6. **A6 new chat beats a moved top.** Move S2 `after null`, then create S4 (tagged). `ids()[0] === S4` and `ids()[1] === S2`.
7. **A7 a real run end, for zero turns.**
   - Create C through the same helper and project run-failed-probe.mjs uses (a **cursor** session in `/tmp/cloudcli-ntfy-probe`). Open the chat socket, subscribe to C, and record every frame with its arrival time. This socket never sends `chat.presence` before A8, so C is not on screen.
   - Send one chat turn to C. Cursor's CLI is absent on this box, so the run crashes in `dispatchRun` and ends through the registry.
   - Pass iff, within 20 s, a `complete` frame for C arrived AND after it a `session_upserted` frame whose `sessionId` is C arrived.
   - Also, the DB row for C has a non-null `last_completed_at` matching `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/`, and `recentItem(C).unread === true`.
8. **A8 read comes from presence.**
   - **Hidden changes nothing.** Send `{ type: 'chat.presence', sessionId: C, visible: false }` and wait 2 s. Pass half one iff `recentItem(C).unread === true`, the DB `last_read_at` for C is still null, and no `session_upserted` for C arrived after the frame.
   - **Visible reads it.** Send `{ type: 'chat.presence', sessionId: C, visible: true }`. Pass half two iff within 5 s `recentItem(C).unread === false` and a `session_upserted` for C arrived after the frame.
   - **A repeat is silent.** Send the visible frame again and wait 2 s. Pass half three iff no further `session_upserted` for C arrived, which proves the heartbeat never re-writes.

**`finally`, always.** `DELETE /api/providers/sessions/<id>?force=true` for every created id, and the cursor session's project cleanup exactly as run-failed-probe.mjs does it. Close the socket(s). Print the results, then `SIDEBAR-STATE-API PASS` iff all eight passed, else `SIDEBAR-STATE-API FAIL` with `process.exitCode = 1`. A thrown error prints `[FAIL] <gate> <message>` and still runs `finally`.

**Sirens.**
- **A product failure.** A gate fails because the server is wrong: order, a missing broadcast, a presence frame that reads nothing or reads when hidden. Do not edit `server/`; it is forbidden. Report the `[FAIL]` lines verbatim with `RESULT: BLOCKED`.
- **A real turn.** You will want a claude session for A7 because it "really" answers. That spends a turn. Cursor is the free run end, measured in `docs/verification.md` §"The ntfy probes" (L1685-1687).
- **The presence frame shape.** If the server answers the frame with a `protocol_error`, read how `src/modules/chat/hooks/useSessionPresence.ts` builds `chat.presence` and send exactly that shape. If it still errors, report the error frame verbatim with `RESULT: BLOCKED`.
- **The run-failed push.** A7 raises a real `run.failed` notification to the dev account's channels, exactly as the existing run-failed probe does. That is expected; do not disable notifications to avoid it.

## Phase 3 — Client data layer: the row fields, two api helpers, and the strings
Depends on: none

```toml
[phase]
id = "3"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 1800
manifest = [
  "src/shared/types.ts",
  "src/shared/api.ts",
  "src/modules/i18n/locales/de/sidebar.json",
  "src/modules/i18n/locales/en/sidebar.json",
  "src/modules/i18n/locales/es/sidebar.json",
  "src/modules/i18n/locales/fr/sidebar.json",
  "src/modules/i18n/locales/it/sidebar.json",
  "src/modules/i18n/locales/ja/sidebar.json",
  "src/modules/i18n/locales/ko/sidebar.json",
  "src/modules/i18n/locales/ru/sidebar.json",
  "src/modules/i18n/locales/tr/sidebar.json",
  "src/modules/i18n/locales/zh-CN/sidebar.json",
  "src/modules/i18n/locales/zh-TW/sidebar.json",
]
forbidden = ["server", "src/modules/sidebar"]
athena = [
  "A locale's iconOption value lost the {{name}} placeholder, or a key landed outside the simpleList block",
  "A RecentConversationListItem object literal elsewhere in src was 'fixed' with invented icon/unread values instead of being reported",
  "A read helper was added to api.ts although read comes from the chat's presence report on the server",
]

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "Widen RecentConversationListItem to the Pick & { icon: string | null; unread: boolean } per Interfaces, and extend its doc comment with one sentence on the two fields."
check = '''grep -A4 'export type RecentConversationListItem' src/shared/types.ts | grep -c 'unread: boolean' '''
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add setSessionIcon and moveSimpleListSession directly after renameSession, exactly as Interfaces writes them. Add no read helper."
check = '''echo $(grep -c 'setSessionIcon:' src/shared/api.ts) $(grep -c 'moveSimpleListSession:' src/shared/api.ts) $({ grep -c 'markSessionRead' src/shared/api.ts || true; })'''
expect = "1 1 0"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/sidebar.json"
what = "Add the six simpleList keys changeIcon, iconTitle, iconDefault, iconOption, unread, dragHandle with the en values from Interfaces inside the existing simpleList block; then add the same six keys, translated, inside the simpleList block of de es fr it ja ko ru tr zh-CN zh-TW sidebar.json, keeping {{name}} in iconOption."
check = '''for loc in de en es fr it ja ko ru tr zh-CN zh-TW; do for k in changeIcon iconTitle iconDefault iconOption unread dragHandle; do v=$(jq -r ".simpleList.$k // \"MISSING\"" src/modules/i18n/locales/$loc/sidebar.json); [ "$v" = MISSING ] && echo "MISSING $loc $k"; done; done; echo PARITY_DONE'''
expect = "PARITY_DONE"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL'''
expect = "TYPECHECK_OK"
timeout_s = 400

[[verify]]
cmd = '''for loc in de en es fr it ja ko ru tr zh-CN zh-TW; do jq -r '.simpleList.iconOption' src/modules/i18n/locales/$loc/sidebar.json; done | grep -c '{{name}}' '''
expect = "11"

[[verify]]
cmd = '''curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5183/src/shared/api.ts'''
expect = "200"

[[verify]]
cmd = '''out=$(npm run lint 2>&1); echo "exit=$?"'''
expect = "exit=0"
timeout_s = 300
```

**What to build.** The client contracts the later phases consume. No sidebar file changes here: `patchLocal` lands in Phase 5 and `moveLocal` in Phase 7, each inside the fill phase that consumes it.

**Sirens.**
- **A read call.** You will want a client "mark read" helper because the dot must clear. It must not exist: read comes from the chat's own `chat.presence` report on the server, and the list reloads on the broadcast.
- **Other literals.** If `npm run typecheck` fails because a `RecentConversationListItem` object literal now lacks `icon`/`unread`, stop. Report the file:line verbatim with `RESULT: BLOCKED`. Do not invent values.
- **Untranslated locales.** You will want to copy English into the ten other locales. Translate; the Verve README (L164) says a new string is a translated string.
- **Existing gaps.** You will see older keys missing from `de/sidebar.json` (`archive`, `delete`, `deleteTitle`, …). Not this phase's; do not add them.

## Phase 4 — Scaffold: the leading icon, the icon picker and the unread dot
Depends on: Phase 1, Phase 3

```toml
[phase]
id = "4"
builder = "iris"
model = "opus"
kind = "scaffold"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/modules/sidebar/SidebarSessionIcon.tsx",
  "src/modules/sidebar/SidebarSimpleIconPicker.tsx",
  "src/modules/sidebar/SidebarSimpleListRow.tsx",
  "src/modules/sidebar/SidebarSimpleList.tsx",
]
forbidden = ["server", "src/shared", "src/modules/chat", "src/modules/sidebar/hooks", "src/modules/sidebar/Sidebar.tsx", "src/modules/sidebar/SidebarContent.tsx", ".verify/lib", ".verify/ntfy"]
athena = [
  "A FILL: marker is not a standalone `// FILL: <name>` line directly above exactly one placeholder line, or a marker sits inside JSX or a type literal, so the fill phase's composition check cannot tell composition from placeholder",
  "The scaffold wires behaviour: a useState, a useEffect, an api call, a hook call, or a real handler body anywhere in the four files",
  "The dot is a literal green (bg-green-*, bg-emerald-*, a hex or var(--...)) instead of bg-primary, carries no aria-label text, or shows on the selected, running or editing row",
  "The picker duplicates the icon map instead of importing SIMPLE_CHAT_ICONS from SidebarSessionIcon, or its Default option is not first, or the pressed state is colour-only",
  "The leading icon is not the row's first child, changes the compact min-h-11 / self-stretch rules, or lacks data-drag-handle and touch-none",
  "A placeholder is written in a form TypeScript narrows (`const x: T | null = null`) instead of `null as T | null`, so a composition comparison fails to typecheck",
]

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSessionIcon.tsx"
what = "Create SIMPLE_CHAT_ICONS (24 entries, Interfaces order) and SimpleChatIconGlyph per Interfaces, both exported at declaration with a consumer comment naming SidebarSimpleListRow.tsx and SidebarSimpleIconPicker.tsx. No FILL markers: this file is complete composition."
check = '''f=src/modules/sidebar/SidebarSessionIcon.tsx; echo $(grep -c 'export const SIMPLE_CHAT_ICONS' $f) $(grep -c 'export function SimpleChatIconGlyph' $f) $(grep -Ec "^\s*'[a-z-]+': [A-Z][A-Za-z]+,$" $f) $({ grep -c 'FILL:' $f || true; }) $(wc -l < $f | awk '{print ($1<=80)?"small":"big"}')'''
expect = "1 1 24 0 small"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleIconPicker.tsx"
what = "Create the default-exported presentational SidebarSimpleIconPicker dialog in the shape of SidebarSimpleStopDialog.tsx per Interfaces: its open, currentIcon, onPick and onCancel arrive as props, so it holds no FILL markers; import SIMPLE_CHAT_ICONS from @/modules/sidebar/SidebarSessionIcon; testids simple-chat-icon-dialog and simple-chat-icon-option (data-icon, 'default' first); aria-pressed plus ring-2 ring-primary on the current choice."
check = '''f=src/modules/sidebar/SidebarSimpleIconPicker.tsx; echo $(grep -c 'simple-chat-icon-dialog' $f) $(grep -c 'simple-chat-icon-option' $f) $(grep -c "from '@/modules/sidebar/SidebarSessionIcon'" $f) $({ grep -Ec "^\s*'[a-z-]+': [A-Z][A-Za-z]+,$" $f || true; }) $({ grep -c 'FILL:' $f || true; }) $(wc -l < $f | awk '{print ($1<=110)?"small":"big"}')'''
expect_re = "^[1-9] [1-9] 1 0 0 small$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleListRow.tsx"
what = "Add the onChooseIcon prop, the leading simple-chat-icon span (data-drag-handle, data-icon, touch-none, SimpleChatIconGlyph), the simple-chat-unread dot (bg-primary, aria-label and title from simpleList.unread, rendered when row.unread && !isSelected && !isRunning && !isEditing), and the Change icon ActionMenu item after rename, per Interfaces. The row's props carry everything, so this file holds no FILL markers. Do NOT add drag props in this phase."
check = '''f=src/modules/sidebar/SidebarSimpleListRow.tsx; echo $(grep -c 'data-testid="simple-chat-icon"' $f) $(grep -c 'data-testid="simple-chat-unread"' $f) $(grep -c 'row.unread && !isSelected && !isRunning && !isEditing' $f) $(grep -c "simple-chat-icon'" $f) $({ grep -Ec 'bg-(green|emerald)-|FILL:' $f || true; }) $(wc -l < $f | awk '{print ($1<=215)?"small":"big"}')'''
expect = "1 1 1 1 0 small"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleList.tsx"
what = "Compose the picker and the row's icon hook-up with placeholders: render <SidebarSimpleIconPicker open={iconTarget !== null} currentIcon={iconTarget?.icon ?? null} onPick={handlePickIcon} onCancel={() => setIconTarget(null)} t={t} /> beside the existing dialogs and pass onChooseIcon={() => setIconTarget(row)} to each row. Declare the three placeholders exactly as the phase body writes them, each under its own FILL marker, put a `// FILL: patchLocal` line directly above each of the three lines that name renameLocal (the hook destructure, the call inside handleRename, and handleRename's dependency array), and put a `// FILL: reactImport` line directly above the react import line."
check = '''f=src/modules/sidebar/SidebarSimpleList.tsx; echo $(grep -c 'FILL:' $f) $(awk '/FILL:/{if ((getline n) > 0 && n !~ /FILL:/ && n !~ /^[[:space:]]*$/) c++} END{print c+0}' $f) $(grep -c '<SidebarSimpleIconPicker' $f) $(grep -c 'onChooseIcon={() => setIconTarget(row)}' $f) $({ grep -Ec 'useState<RecentConversationListItem|api\.setSessionIcon' $f || true; }) $({ grep -c '{/\* FILL:' $f || true; })'''
expect = "7 7 1 1 0 0"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL'''
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = '''out=$(npm run lint 2>&1); code=$?; n=$(printf '%s\n' "$out" | { grep -Ec 'SidebarSessionIcon|SidebarSimpleIconPicker' || true; }); echo "exit=$code new_file_warnings=$n"'''
expect = "exit=0 new_file_warnings=0"
timeout_s = 300

[[verify]]
cmd = '''for f in SidebarSessionIcon SidebarSimpleIconPicker SidebarSimpleListRow SidebarSimpleList; do printf '%s ' $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5183/src/modules/sidebar/$f.tsx); done; echo'''
expect = "200 200 200 200"

[[verify]]
cmd = '''d=.verify/scaffolds/sidebar-icons; mkdir -p $d && for f in SidebarSessionIcon SidebarSimpleIconPicker SidebarSimpleListRow SidebarSimpleList; do cp src/modules/sidebar/$f.tsx $d/$f.tsx.snap; done && ls $d | grep -c '\.tsx\.snap$' '''
expect = "4"
```

**What to compose.** The icon, the picker and the dot, exactly per Interfaces, as composition only. The picker, the icon module and the row take everything through props, so they are finished composition with no markers. The list is where state and handlers live, so it carries the markers.

**The scaffold contract, for `SidebarSimpleList.tsx`.**
- **Placeholders.** Put them after the existing hook calls and before `return`, each a standalone marker line directly above exactly ONE placeholder line:

  ```ts
  // FILL: iconTarget
  const iconTarget = null as RecentConversationListItem | null;
  // FILL: setIconTarget
  const setIconTarget = (_row: RecentConversationListItem | null): void => undefined;
  // FILL: handlePickIcon
  const handlePickIcon = (_icon: string | null): void => undefined;
  ```

- **Renamed calls.** Also put `// FILL: patchLocal` directly above each of the three existing lines that name `renameLocal`: the hook destructure line, the call inside `handleRename`, and `handleRename`'s dependency array (`}, [onRenameSession, renameLocal]);`). If the destructure spans several lines, the marker goes above the one line containing `renameLocal`. Change nothing else on those lines.
- **The react import.** Put `// FILL: reactImport` directly above the file's `import { … } from 'react';` line (line 1), and change nothing on it. The fill adds `useState` to that line; a second react import would pass the check but trip oxlint's `import/no-duplicates`.
- **Composition references only placeholders.** The JSX reads `iconTarget`, `setIconTarget` and `handlePickIcon`, never a `useState` or an api call. The fill phase replaces each marker+placeholder pair and may add lines only there, or as whole new import lines inside the import block; every other line of these four files must survive byte-for-byte. The fill phase checks exactly that against the snapshot this phase's last verify takes.

**Layout.**
- The leading icon is the row's first child, left of the title block. It is `h-7 w-6`, muted, and centred vertically.
- The dot sits where the running spinner sits, to the left of the "..." trigger. It is `h-2 w-2 rounded-full bg-primary`, with `mx-1.5` so it aligns with the spinner's centre.
- Keep the compact-mode `min-h-11` on the row and the `self-stretch` on the `<a>` exactly as they are.

**Sirens.**
- **Wiring.** You will want to write the `useState` and the api call because they are "only two lines". They are the fill phase's; the check refuses both words here.
- **JSX markers.** You will want a `{/* FILL: … */}` marker inside the JSX. Markers live only in statement position, above one placeholder `const`, so the composition check can strip exactly two lines per marker.
- **Green literals.** You will see `bg-emerald-500` dots elsewhere in the app. They are drift from Verve rule 3; the dot is `bg-primary`.
- **A test id per menu item.** You will want to add a `data-testid` to the ActionMenu item. `ActionMenuItem` (`src/shared/ui/ActionMenu.tsx:11-22`) has no such key and `src/shared` is forbidden; the probe finds the item by its text.

## Phase 5 — Fill: icon state and picking, the patchLocal hook, proven in the browser with the live dot
Depends on: Phase 4

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "opus"
kind = "fill"
scaffold_of = "4"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "src/modules/sidebar/SidebarSimpleList.tsx",
  "src/modules/sidebar/hooks/useSimpleChatList.ts",
  ".verify/probe-simple-icons-unread.mjs",
  ".verify/artifacts/simple-icons-unread.json",
]
forbidden = ["server", "src/shared", "src/modules/chat", "src/modules/sidebar/SidebarSessionIcon.tsx", "src/modules/sidebar/SidebarSimpleIconPicker.tsx", "src/modules/sidebar/SidebarSimpleListRow.tsx", ".verify/scaffolds", ".verify/lib", ".verify/ntfy"]
athena = [
  "A line of the scaffold outside a marker+placeholder pair was edited, reformatted or reordered, so the composition check should fail",
  "Any client code calls a read endpoint, sends its own chat.presence, or patches unread locally; read must come only from the chat's existing presence report and the server's broadcast",
  "Picking an icon writes the server but not the row (or the reverse), or a failed PUT leaves the optimistic icon in place",
  "patchLocal replaces the row instead of merging, dropping projectId or lastActivity, or its patch type admits unread; renameLocal survives anywhere",
  "B5 or B6 passes because the page was reloaded or the probe injected a frame, not because the real session_upserted broadcast reached the list",
  "The picker's Default option sends the string 'default' instead of null",
  "The iconTarget state has no comment above it (frontend standard L144), or a FILL marker was left in place",
]

[[steps]]
kind = "edit"
path = "src/modules/sidebar/hooks/useSimpleChatList.ts"
what = "Replace renameLocal with patchLocal (patch type Partial<Pick<RecentConversationListItem, 'sessionTitle' | 'icon'>>, merge semantics) per Interfaces; update the return type and the return object."
check = '''f=src/modules/sidebar/hooks/useSimpleChatList.ts; echo $(grep -c 'patchLocal' $f) $(grep -c "'sessionTitle' | 'icon'>" $f) $({ grep -c 'renameLocal' $f || true; })'''
expect_re = "^[3-9] [1-9] 0$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleList.tsx"
what = "Fill the seven markers and nothing else: the reactImport line becomes the same react import with useState added; the three patchLocal lines (destructure patchLocal; call patchLocal(sessionId, { sessionTitle: title }); the dependency array names patchLocal); the iconTarget + setIconTarget pairs become one commented useState<RecentConversationListItem | null>(null); handlePickIcon closes the picker, patchLocal(target.sessionId, { icon }), then api.setSessionIcon, reverting with patchLocal(target.sessionId, { icon: target.icon }) on a non-ok response or a throw. Delete each marker line; the api import is a whole new line inside the import block."
check = '''f=src/modules/sidebar/SidebarSimpleList.tsx; echo $({ grep -c 'FILL:' $f || true; }) $(grep -c 'useState<RecentConversationListItem | null>(null)' $f) $(grep -c 'api.setSessionIcon' $f) $(grep -c 'patchLocal(sessionId, { sessionTitle: title })' $f) $(grep -rn 'renameLocal' src | wc -l)'''
expect = "0 1 1 1 0"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL'''
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = '''out=$(npm run lint 2>&1); echo "exit=$?"'''
expect = "exit=0"
timeout_s = 300

[[steps]]
kind = "edit"
path = ".verify/probe-simple-icons-unread.mjs"
what = "Write the browser probe described in the phase body: gates B1-B8 printing [PASS]/[FAIL] Bn, the cursor session driven from Node through .verify/lib/ntfy.mjs, artifacts, shots under .verify/shots/siu-*, cleanup in finally, final line SIMPLE-ICONS-UNREAD PASS or FAIL."
check = '''node --check .verify/probe-simple-icons-unread.mjs && echo $(grep -c 'B[1-8]' .verify/probe-simple-icons-unread.mjs | awk '{print ($1>=8)?"gates":"few"}') $(grep -c 'simple-chat-unread' .verify/probe-simple-icons-unread.mjs | awk '{print ($1>=1)?"dot":"none"}')'''
expect = "gates dot"

[[verify]]
cmd = '''cat src/modules/sidebar/SidebarSessionIcon.tsx src/modules/sidebar/SidebarSimpleIconPicker.tsx src/modules/sidebar/SidebarSimpleListRow.tsx src/modules/sidebar/SidebarSimpleList.tsx | { grep -c 'FILL:' || true; }'''
expect = "0"

[[verify]]
cmd = '''python3 - .verify/scaffolds/sidebar-icons <<'PY'
import difflib, os, re, sys
d = sys.argv[1]; out = []
for snap in sorted(os.listdir(d)):
    name = snap[:-len('.snap')]
    keep, sites, skip = [], set(), False
    for line in open(os.path.join(d, snap)).read().split('\n'):
        if skip:
            skip = False; continue
        if 'FILL:' in line:
            sites.add(len(keep)); skip = True; continue
        keep.append(line)
    imports_end = max([k + 1 for k, line in enumerate(keep) if line.startswith('import ')] or [0])
    shipped = open('src/modules/sidebar/' + name).read().split('\n')
    bad = None
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, keep, shipped, autojunk=False).get_opcodes():
        if tag == 'equal':
            continue
        if tag == 'insert':
            block = shipped[j1:j2]
            if i1 <= imports_end and all(re.match(r'import ', line) for line in block):
                continue
            ok = False
            for step in (-1, 1):
                b, p = list(block), i1
                while not ok:
                    if p in sites:
                        ok = True
                    elif step < 0 and p > 0 and b[-1] == keep[p - 1]:
                        b, p = [keep[p - 1]] + b[:-1], p - 1
                    elif step > 0 and p < len(keep) and b[0] == keep[p]:
                        b, p = b[1:] + [keep[p]], p + 1
                    else:
                        break
            if ok:
                continue
        text = shipped[j1] if j1 < j2 else keep[i1]
        bad = 'CHANGED %s line %d (%s): %r' % (name, j1 + 1, tag, text.strip()[:70])
        break
    out.append(bad or 'kept')
print(' '.join(out))
PY'''
expect = "kept kept kept kept"

[[verify]]
cmd = '''node .verify/probe-simple-icons-unread.mjs 2>&1 | tail -1'''
expect = "SIMPLE-ICONS-UNREAD PASS"
timeout_s = 480

[[verify]]
cmd = '''node .verify/probe-simple-icons-unread.mjs 2>&1 | grep -c '^\[PASS\] B[1-8]' '''
expect = "8"
timeout_s = 480

[[verify]]
cmd = '''node -e "const D=require('better-sqlite3');const fs=require('fs');const ids=JSON.parse(fs.readFileSync('.verify/artifacts/simple-icons-unread.json','utf8')).sessionIds;const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const left=ids.filter(id=>db.prepare('select 1 from sessions where session_id=?').get(id)).length;console.log('probeIds='+ids.length+' residue='+left)"'''
expect_re = "^probeIds=[3-9] residue=0$"
```

**What to build.** Fill Phase 4's seven markers in `SidebarSimpleList.tsx`, and the `patchLocal` hook change they call, then the probe.

**The fill contract.**
- **What you may change.** Each `// FILL: <name>` line and the ONE placeholder line under it are yours to replace, with as many lines as the fill needs, and the marker line is deleted. New lines may go only at a marker site (in place of its pair, comments included) or, as whole new import lines, inside the import block. A line added anywhere else, even one JSX prop, fails the check. You may not edit, reformat, reorder or delete any other line of the four scaffold files.
- **How it is checked.** The second verify compares the four files against Phase 4's snapshot in `.verify/scaffolds/sidebar-icons/` and names the first line you changed.
- **Placeholder mapping.**
  - `iconTarget` + `setIconTarget` → one `useState<RecentConversationListItem | null>(null)`, with a comment above it saying it holds the row whose picker is open.
  - `handlePickIcon` → the handler Interfaces describes.
  - `reactImport` → the same react import line with `useState` added to its names.
  - Each `patchLocal` marker's line (the destructure, the call, the dependency array) → the same line with `renameLocal` renamed to `patchLocal`, and the call's argument written `{ sessionTitle: title }`.

**The probe** (`.verify/probe-simple-icons-unread.mjs`, zero Claude turns). Harness conventions: `docs/verification.md` L89-123.
- **Page:** `openConsole()` from `.verify/lib/console.mjs` gives `{ browser, page, api, shoot, errors }` (console.mjs:454). `api(path, init)` is the bearer fetch (console.mjs:435-452).
- **Node side:** import the sign-in, `createSession` and `openChatSocket` helpers from `.verify/lib/ntfy.mjs`, exactly as `.verify/ntfy/run-failed-probe.mjs` does (read it first). Its project registration and cleanup for `/tmp/cloudcli-ntfy-probe` are copied too. The Node socket never sends `chat.presence`; only the page does, through the app's own chat view.
- **Selectors:** `ROW(id)` = `[data-testid="simple-chat-row"][data-session-id="<id>"]`; `DOT(id)` = `ROW(id) [data-testid="simple-chat-unread"]`; `ICON(id)` = `ROW(id) [data-testid="simple-chat-icon"]`.
- **Artifacts:** record every created id into `.verify/artifacts/simple-icons-unread.json` as `{ "sessionIds": [...] }` the moment it exists.

Setup:
1. Through `api`, `POST /api/providers/sessions` `{ provider: 'claude', projectPath: '/home/lyphe/.claude/claudecodeui_lyphe', simpleList: true }` twice → S1, S2. `PUT` each name as `siu-one`, `siu-two` (body `{ summary }`). No chat frame is ever sent to S1 or S2.
2. **The cursor session C.** Make the same request run-failed-probe.mjs makes to create its cursor session in `/tmp/cloudcli-ntfy-probe`, but add `simpleList: true` to the body. The ntfy `createSession` helper does not pass that flag; send the POST yourself with the helper's token, after the same project-registration step. Rename C to `siu-cursor`. Open a Node chat socket with `openChatSocket(token)` and `subscribe(C)`.
3. `PATCH /api/user/preferences {"simpleChatList": true}`, `page.reload()`, and wait up to 20 s for `ROW(S1)`, `ROW(S2)` and `ROW(C)`.

Register a `page.on('request')` collector for `PUT …/icon` (URL + parsed body). Each gate prints `[PASS] Bn <what>` or `[FAIL] Bn <observed>`:
- **B1 leading icons.** `ICON(S1)`, `ICON(S2)` and `ICON(C)` are each visible with `data-icon="default"` and contain an `svg`.
- **B2 picker.**
  - Click the button inside `ROW(S1) [data-testid="simple-chat-menu"]`, then the visible button whose trimmed text is `Change icon`.
  - `[data-testid="simple-chat-icon-dialog"]` is visible and holds 25 `[data-testid="simple-chat-icon-option"]`. `shoot('siu-picker')`.
  - Click the one with `data-icon="rocket"`. Pass iff a PUT to `/S1/icon` with body `{"icon":"rocket"}` is captured, the dialog is gone within 2 s, and `ICON(S1)` reads `data-icon="rocket"`.
- **B3 persists.** `page.reload()` → `ICON(S1)` reads `data-icon="rocket"`, and the S1 item of `GET /api/providers/sessions/recent?simpleList=true&limit=100` has `icon === 'rocket'`.
- **B4 default.** Open the picker on S1 again and click `data-icon="default"`. Pass iff the captured body is `{"icon":null}` and `ICON(S1)` reads `data-icon="default"`.
- **B5 live dot, no reload.**
  - Click `ROW(S1) a`, wait until `location.pathname === '/session/<S1>'`, then wait 1 s.
  - From Node, `send(C, 'probe', {})` (cursor is not installed: the run crashes for free), and wait for C's `complete` frame on the Node socket.
  - With NO reload and no injected frame, pass iff `DOT(C)` becomes visible within 8 s and `DOT(S1)` count is 0.
  - Also, `DOT(C)` has `aria-label` equal to `en` `simpleList.unread` (read the locale file), and its computed `background-color` equals that of an element with class `bg-primary` (create one hidden probe span in the page to read it). `shoot('siu-dot')`.
- **B6 opening clears it, and it stays cleared.**
  - Click `ROW(C) a` and wait for `location.pathname === '/session/<C>'`. Pass half one iff within 6 s the recent feed's C item has `unread === false`. The chat view's own `chat.presence` report does this, with no client read call.
  - Then click `ROW(S1) a`, wait for its path, and sample `DOT(C)` every 250 ms for 4 s. Pass half two iff `DOT(C)` count stayed 0 throughout and the recent feed's C item is still `unread === false`.
- **B7 the open chat never dots.**
  - Click `ROW(C) a` and wait for its path, then 2 s. With C open and the page visible, `send(C, 'probe again', {})` from Node, wait for C's `complete`, then wait 5 s.
  - Pass iff `DOT(C)` count stayed 0 throughout (sample every 250 ms) and the recent feed's C item has `unread === false`.
  - Then click `ROW(S1) a` and wait 3 s. `DOT(C)` count is still 0: the completion was stamped read because C was on screen.
- **B8 phone width.**
  - With S1 open, `resize(page, { width: 390, height: 844 })` (console.mjs:346-349), then open the sidebar the way `.verify/phase-18.mjs` gate 9 does.
  - `send(C, 'probe mobile', {})` from Node and wait for `complete`.
  - Pass iff `DOT(C)` is visible within 8 s, and `ICON(C)` and `DOT(C)` both have bounding boxes with `x >= 0` and `x + width <= 390`. `shoot('siu-390')`.
  - Resize back to 1440×900.

**`finally`, always.**
- `DELETE /api/providers/sessions/<id>?force=true` for every recorded id, and the cursor project cleanup exactly as run-failed-probe.mjs does it.
- `PATCH {"simpleChatList": false}`, close the Node socket and the browser.
- Print the results, then `SIMPLE-ICONS-UNREAD PASS` iff all eight passed, else `SIMPLE-ICONS-UNREAD FAIL` with `process.exitCode = 1`.

**Sirens.**
- **Restyling.** You will see something in the scaffold you would lay out differently. It is Iris's composition; the second verify refuses any change outside the markers.
- **Forcing the dot or its clearing.** You will want to inject a `session_upserted` frame, or reload, to make the dot appear or go. B5 and B6 exist to prove the real broadcast reaches the list: never inject, never reload before those readings.
- **A client read path.** You will want the list to call something when a row is opened, so the dot clears faster. It must not; the chat view already reports presence (`src/modules/chat` is forbidden here), and the server reads from that.
- **Server-side failures.** If B5, B6 or B7 fails because the server never stamps, never reads from presence, or never broadcasts (the recent feed's `unread` is wrong while the page shows the chat), that is Phase 1's surface, forbidden here. Report the `[FAIL]` lines and the last 40 lines of `journalctl -u cloudcli-server-dev --no-pager` verbatim with `RESULT: BLOCKED`.
- **Composition failures.** If a gate fails because of the scaffold's composition (a missing testid, a dot drawn in the wrong condition), the scaffold files are forbidden here. Report the `[FAIL]` line and the scaffold file:line verbatim with `RESULT: BLOCKED`.
- **A later re-verify.** This phase's composition verify compares against Phase 4's snapshot, and Phase 6 edits the same two files. A re-verify of this phase after Phase 6 has run reports `CHANGED` on a correct tree; that is Phase 6's composition, not a regression here. Do not edit the snapshot.
- **Screenshots.** Never attach one; name paths only.

## Phase 6 — Scaffold: drag affordances on the row and the list
Depends on: Phase 5

```toml
[phase]
id = "6"
builder = "iris"
model = "opus"
kind = "scaffold"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/modules/sidebar/SidebarSimpleListRow.tsx",
  "src/modules/sidebar/SidebarSimpleList.tsx",
]
forbidden = ["server", "src/shared", "src/modules/sidebar/hooks", "src/modules/sidebar/SidebarSessionIcon.tsx", "src/modules/sidebar/SidebarSimpleIconPicker.tsx", "src/modules/chat-gutters", ".verify/lib", ".verify/ntfy"]
athena = [
  "A FILL: marker is not a standalone `// FILL: <name>` line directly above exactly one placeholder line, or a marker sits inside JSX, so the fill phase's composition check cannot tell composition from placeholder",
  "The scaffold wires behaviour: a pointer listener, a useState, a useEffect, an api call or a hook call",
  "The drop bar is a literal colour, or is drawn without pointer-events-none so it steals the drop target's pointer events",
  "The row's <a> lacks draggable={false}, or the outer div does not spread dragProps, so the fill has nowhere to attach the drag",
  "The select-none class applies always instead of only while draggingId is non-null, or the row wrapper lost its flex flex-col gap-1 layout",
  "The dragProps prop type is a hook-derived type the scaffold cannot see instead of the Pick<HTMLAttributes<HTMLElement>, ...> Interfaces names",
]

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleListRow.tsx"
what = "Add the dragProps (Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'> | null, import type { HTMLAttributes } from 'react'), isDragging and dropEdge props per Interfaces: spread dragProps ?? {} on the outer row div, add relative, data-dragging, data-drop-edge, opacity-50 while dragging, the pointer-events-none bg-primary drop bar at top-0/bottom-0, and draggable={false} on the <a>. The props carry everything: no FILL markers in this file."
check = '''f=src/modules/sidebar/SidebarSimpleListRow.tsx; echo $(grep -c 'data-drop-edge' $f) $(grep -c 'data-dragging' $f) $(grep -c 'draggable={false}' $f) $(grep -c "'onPointerDown' | 'onClickCapture' | 'onDragStart'" $f) $({ grep -Ec 'FILL:|addEventListener' $f || true; }) $(wc -l < $f | awk '{print ($1<=240)?"small":"big"}')'''
expect = "1 1 1 1 0 small"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleList.tsx"
what = "Compose the drag hook-up with placeholders: the row wrapper gains data-testid simple-chat-list-rows and select-none only while draggingId !== null; each row receives dragProps={rowDragProps(row.sessionId)}, isDragging={draggingId === row.sessionId} and dropEdge={dropTarget?.sessionId === row.sessionId ? dropTarget.edge : null}. Declare the three placeholders exactly as the phase body writes them, each under its own FILL marker, and put `// FILL: moveLocal` directly above the one line of the useSimpleChatList destructure that names patchLocal."
check = '''f=src/modules/sidebar/SidebarSimpleList.tsx; echo $(grep -c 'FILL:' $f) $(awk '/FILL:/{if ((getline n) > 0 && n !~ /FILL:/ && n !~ /^[[:space:]]*$/) c++} END{print c+0}' $f) $(grep -c 'simple-chat-list-rows' $f) $(grep -c 'dragProps={rowDragProps(row.sessionId)}' $f) $({ grep -Ec 'useSimpleChatReorder|moveSimpleListSession' $f || true; }) $({ grep -c '{/\* FILL:' $f || true; })'''
expect = "4 4 1 1 0 0"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL'''
expect = "TYPECHECK_OK"
timeout_s = 400

[[verify]]
cmd = '''for f in SidebarSimpleListRow SidebarSimpleList; do printf '%s ' $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5183/src/modules/sidebar/$f.tsx); done; echo'''
expect = "200 200"

[[verify]]
cmd = '''out=$(npm run lint 2>&1); echo "exit=$?"'''
expect = "exit=0"
timeout_s = 300

[[verify]]
cmd = '''d=.verify/scaffolds/sidebar-drag; mkdir -p $d && for f in SidebarSimpleListRow SidebarSimpleList; do cp src/modules/sidebar/$f.tsx $d/$f.tsx.snap; done && ls $d | grep -c '\.tsx\.snap$' '''
expect = "2"
```

**What to compose.** The drag affordances, exactly per Interfaces, as composition only. The row takes everything through props, so it is finished composition with no markers. The list carries the markers.

**The scaffold contract, for `SidebarSimpleList.tsx`.**
- **Placeholders.** Put them after the existing hook calls and before `return`, each a standalone marker line directly above exactly ONE placeholder line:

  ```ts
  // FILL: draggingId
  const draggingId = null as string | null;
  // FILL: dropTarget
  const dropTarget = null as { sessionId: string; edge: 'before' | 'after' } | null;
  // FILL: rowDragProps
  const rowDragProps = (_sessionId: string) => null as Parameters<typeof SidebarSimpleListRow>[0]['dragProps'];
  ```

- **The destructure.** Also put `// FILL: moveLocal` directly above the one existing line of the `useSimpleChatList(...)` destructure that names `patchLocal`, and change nothing on that line.
- **No `as T` narrowing traps.** Each placeholder is written with `as`, never a type annotation, so TypeScript does not narrow it to `null` and the comparisons in the JSX typecheck.
- **The wrapper class.** Write it as a ternary on `draggingId !== null` between `'flex flex-col gap-1 select-none'` and `'flex flex-col gap-1'`.

**Sirens.**
- **Wiring the drag.** You will want to write the pointer listeners because the affordance "needs them to look right". They are the fill phase's; the row is drawn from `isDragging` and `dropEdge` alone.
- **HTML5 drag.** You will want `draggable` on the row, because the gutter widgets use it. The only `draggable` in this phase is `draggable={false}` on the `<a>`.
- **JSX markers.** You will want a `{/* FILL: … */}` marker inside the JSX. Markers live only in statement position, above one placeholder `const`.

## Phase 7 — Fill: the reorder hook, moveLocal and the move call, proven with mouse and touch
Depends on: Phase 6

```toml
[phase]
id = "7"
builder = "hephaestus"
model = "opus"
kind = "fill"
scaffold_of = "6"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "src/modules/sidebar/hooks/useSimpleChatReorder.ts",
  "src/modules/sidebar/hooks/useSimpleChatList.ts",
  "src/modules/sidebar/SidebarSimpleList.tsx",
  ".verify/probe-simple-reorder.mjs",
  ".verify/artifacts/simple-reorder.json",
]
forbidden = ["server", "src/shared", "src/modules/sidebar/SidebarSimpleListRow.tsx", "src/modules/sidebar/SidebarSessionIcon.tsx", "src/modules/sidebar/SidebarSimpleIconPicker.tsx", "src/modules/chat-gutters", ".verify/scaffolds", ".verify/lib", ".verify/ntfy"]
athena = [
  "A plain click on a row no longer opens the chat (the click is swallowed without a drag), or a drop DOES navigate because onClickCapture was not armed by the drag",
  "A touch press on the row title starts a drag and blocks list scrolling, or a touch press on the icon handle scrolls instead of dragging",
  "The window pointermove/pointerup listeners leak: added per render, or not removed on drop, cancel or unmount",
  "afterSessionId is computed from the pre-drop order (an off-by-one when dragging downwards), so the server order differs from what the DOM showed",
  "onMove fires when the drop lands where the row already was, sending a needless PUT",
  "A pressed ActionMenu trigger or the rename input starts a drag",
  "moveLocal with an afterSessionId that is not loaded silently moves the row to the top instead of leaving rows unchanged",
  "The list reorders but a failed PUT is not followed by reload, leaving a local order the server does not have",
  "A line of the scaffold outside a marker+placeholder pair was edited, reformatted or reordered",
]

[[steps]]
kind = "edit"
path = "src/modules/sidebar/hooks/useSimpleChatReorder.ts"
what = "Create useSimpleChatReorder exactly per Interfaces: pointer-event drag with a 5 px threshold, touch only from [data-drag-handle], never from button/input/[data-no-drag], window listeners added on arm and removed on end/cancel/unmount, midpoint target detection over simple-chat-row elements, afterSessionId from the post-drop order, onMove only on a real change, one swallowed click after a drag, Escape and pointercancel cancel, onDragStart preventDefault; rowDragProps returns Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'>."
check = '''f=src/modules/sidebar/hooks/useSimpleChatReorder.ts; echo $(grep -c 'data-drag-handle' $f) $(grep -c 'removeEventListener' $f | awk '{print ($1>=3)?"cleans":"leaks"}') $(grep -c 'pointercancel' $f | awk '{print ($1>=1)?"cancel":"nocancel"}') $({ grep -Ec 'draggable|dataTransfer' $f || true; }) $(wc -l < $f | awk '{print ($1<=200)?"small":"big"}')'''
expect_re = "^[1-9] cleans cancel 0 small$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/hooks/useSimpleChatList.ts"
what = "Add moveLocal per Interfaces (null after = first; unknown id = rows unchanged) and include it in the return type and the return object."
check = '''grep -c 'moveLocal' src/modules/sidebar/hooks/useSimpleChatList.ts'''
expect_re = "^[3-9]$"

[[steps]]
kind = "edit"
path = "src/modules/sidebar/SidebarSimpleList.tsx"
what = "Fill the four markers and nothing else: the moveLocal marker's line also destructures moveLocal; the draggingId, dropTarget and rowDragProps pairs become one `const { draggingId, dropTarget, rowDragProps } = useSimpleChatReorder({ rows, onMove: handleMove });`, with handleMove added above it (moveLocal(id, after), then api.moveSimpleListSession(id, after), reload() on a non-ok response or a throw). Delete each marker line; add the import."
check = '''f=src/modules/sidebar/SidebarSimpleList.tsx; echo $({ grep -c 'FILL:' $f || true; }) $(grep -c 'useSimpleChatReorder({ rows, onMove: handleMove })' $f) $(grep -c 'api.moveSimpleListSession' $f) $(grep -c 'moveLocal' $f | awk '{print ($1>=2)?"wired":"missing"}')'''
expect = "0 1 1 wired"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1 && echo TYPECHECK_OK || echo TYPECHECK_FAIL'''
expect = "TYPECHECK_OK"
timeout_s = 400

[[steps]]
kind = "run"
cmd = "npm run lint"
check = '''out=$(npm run lint 2>&1); code=$?; n=$(printf '%s\n' "$out" | { grep -c 'useSimpleChatReorder' || true; }); echo "exit=$code new_file_warnings=$n"'''
expect = "exit=0 new_file_warnings=0"
timeout_s = 300

[[steps]]
kind = "edit"
path = ".verify/probe-simple-reorder.mjs"
what = "Write the browser probe described in the phase body: gates C1-C7 printing [PASS]/[FAIL] Cn, mouse drags through page.mouse, touch drags through CDP Input.dispatchTouchEvent in a hasTouch 390 px context, artifacts, shots under .verify/shots/sre-*, cleanup in finally, final line SIMPLE-REORDER PASS or FAIL."
check = '''node --check .verify/probe-simple-reorder.mjs && echo $(grep -c 'C[1-7]' .verify/probe-simple-reorder.mjs | awk '{print ($1>=7)?"gates":"few"}') $(grep -c 'Input.dispatchTouchEvent' .verify/probe-simple-reorder.mjs | awk '{print ($1>=1)?"touch":"notouch"}') $(grep -c 'mouse.down' .verify/probe-simple-reorder.mjs | awk '{print ($1>=1)?"mouse":"nomouse"}')'''
expect = "gates touch mouse"

[[verify]]
cmd = '''cat src/modules/sidebar/SidebarSimpleListRow.tsx src/modules/sidebar/SidebarSimpleList.tsx | { grep -c 'FILL:' || true; }'''
expect = "0"

[[verify]]
cmd = '''python3 - .verify/scaffolds/sidebar-drag <<'PY'
import difflib, os, re, sys
d = sys.argv[1]; out = []
for snap in sorted(os.listdir(d)):
    name = snap[:-len('.snap')]
    keep, sites, skip = [], set(), False
    for line in open(os.path.join(d, snap)).read().split('\n'):
        if skip:
            skip = False; continue
        if 'FILL:' in line:
            sites.add(len(keep)); skip = True; continue
        keep.append(line)
    imports_end = max([k + 1 for k, line in enumerate(keep) if line.startswith('import ')] or [0])
    shipped = open('src/modules/sidebar/' + name).read().split('\n')
    bad = None
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, keep, shipped, autojunk=False).get_opcodes():
        if tag == 'equal':
            continue
        if tag == 'insert':
            block = shipped[j1:j2]
            if i1 <= imports_end and all(re.match(r'import ', line) for line in block):
                continue
            ok = False
            for step in (-1, 1):
                b, p = list(block), i1
                while not ok:
                    if p in sites:
                        ok = True
                    elif step < 0 and p > 0 and b[-1] == keep[p - 1]:
                        b, p = [keep[p - 1]] + b[:-1], p - 1
                    elif step > 0 and p < len(keep) and b[0] == keep[p]:
                        b, p = b[1:] + [keep[p]], p + 1
                    else:
                        break
            if ok:
                continue
        text = shipped[j1] if j1 < j2 else keep[i1]
        bad = 'CHANGED %s line %d (%s): %r' % (name, j1 + 1, tag, text.strip()[:70])
        break
    out.append(bad or 'kept')
print(' '.join(out))
PY'''
expect = "kept kept"

[[verify]]
cmd = '''node .verify/probe-simple-reorder.mjs 2>&1 | tail -1'''
expect = "SIMPLE-REORDER PASS"
timeout_s = 480

[[verify]]
cmd = '''node .verify/probe-simple-reorder.mjs 2>&1 | grep -c '^\[PASS\] C[1-7]' '''
expect = "7"
timeout_s = 480

[[verify]]
cmd = '''node -e "const D=require('better-sqlite3');const fs=require('fs');const ids=JSON.parse(fs.readFileSync('.verify/artifacts/simple-reorder.json','utf8')).sessionIds;const db=new D(process.env.HOME+'/.cloudcli/auth.db',{readonly:true});const left=ids.filter(id=>db.prepare('select 1 from sessions where session_id=?').get(id)).length;console.log('probeIds='+ids.length+' residue='+left)"'''
expect_re = "^probeIds=[5-9] residue=0$"
```

**What to build.** The hook, `moveLocal`, and Phase 6's four markers, then the probe.
- **Why pointer events.** The house's only drag, the chat gutters (`GutterWidgetFrame.tsx:47-61`, `GutterSlot.tsx:69-80`), is HTML5 drag and drop, and HTML5 drag does not fire from touch in mobile browsers. The operator uses this list on a phone, so the list uses pointer events. Do not copy the gutter technique.
- **Handle and press rules.** The leading icon span from Phase 4 already carries `data-drag-handle` and `touch-none`; it is the touch handle. The ActionMenu trigger is a `button`, so it never arms.
- **The fill contract.**
  - **What you may change.** Each `// FILL: <name>` line and the ONE placeholder line under it are yours to replace, with as many lines as the fill needs, and the marker line is deleted. New lines may go only at a marker site (`handleMove` goes at the `draggingId` site, directly above the destructure that replaces it) or, as whole new import lines, inside the import block (the `useSimpleChatReorder` import). A line added anywhere else fails the check. You may not edit, reformat, reorder or delete any other line of the two scaffold files.
  - **How it is checked.** The second verify compares both files against Phase 6's snapshot in `.verify/scaffolds/sidebar-drag/`.
  - **Replacement lines.** The three placeholder pairs may collapse into the one destructuring statement. The `moveLocal` marker's line is replaced by the same destructure line with `moveLocal` added.

**The probe** (`.verify/probe-simple-reorder.mjs`, zero Claude turns). Page from `openConsole()`, `api` as in Phase 5. `ORDER()` = the `data-session-id` values of `[data-testid="simple-chat-list-rows"] [data-testid="simple-chat-row"]` in DOM order, filtered to this probe's ids. `SERVER_ORDER()` = the same filter over `GET /api/providers/sessions/recent?simpleList=true&limit=100`. Record every created id into `.verify/artifacts/simple-reorder.json` the moment it exists.

Setup. Through `api`, create four tagged claude sessions R1, R2, R3, R4 in that order, 50 ms apart (`POST /api/providers/sessions` `{ provider: 'claude', projectPath: '/home/lyphe/.claude/claudecodeui_lyphe', simpleList: true }`), and name them `sre-1` … `sre-4`. Never send a chat frame. `PATCH {"simpleChatList": true}`, `page.reload()`, and wait for all four rows. Register a `page.on('request')` collector for `PUT …/simple-list-position` (URL + parsed body).

`drag(fromLocator, toLocator, edge)` with the mouse:
1. Hover the centre of `fromLocator`'s title span (`a span`), then `page.mouse.down()`.
2. `page.mouse.move` to the target point in 12 steps. The target point is the horizontal centre of `toLocator`, at 25% of its height for `before` or 75% for `after`.
3. Before releasing, read `[data-drop-edge]` count and the dragged row's `data-dragging`.
4. `page.mouse.up()`.

Gates:
- **C1 initial.** `ORDER()` equals `[R4, R3, R2, R1]`.
- **C2 mouse drag upward.**
  - `drag(ROW(R1), ROW(R3), 'before')`.
  - Pass iff, before release, `[data-drop-edge]` count was 1 and R1's `data-dragging` was `"true"`.
  - After release, within 3 s: exactly one PUT to `/R1/simple-list-position` with body `{"afterSessionId":"<R4>"}` was captured, `ORDER()` is `[R4, R1, R3, R2]`, and `location.pathname` did not change. `shoot('sre-dragging')` is taken before release.
- **C3 persisted.** `page.reload()`. `ORDER()` and `SERVER_ORDER()` both equal `[R4, R1, R3, R2]`.
- **C4 to the top, and downward.**
  - `drag(ROW(R2), ROW(R4), 'before')` → body `{"afterSessionId":null}` and `ORDER()` `[R2, R4, R1, R3]`.
  - Then `drag(ROW(R2), ROW(R1), 'after')` → body `{"afterSessionId":"<R1>"}` and `ORDER()` `[R4, R1, R2, R3]`.
  - Then `SERVER_ORDER()` equals the same.
- **C5 a no-op drop sends nothing; a click still opens.**
  - Clear the collector. `drag(ROW(R1), ROW(R1), 'after')`. Pass iff no PUT is captured within 1.5 s and `ORDER()` is unchanged.
  - Then `ROW(R3) a` `.click()` (no drag). Pass iff `location.pathname === '/session/<R3>'` within 3 s.
- **C6 a new chat lands on top.** Create R5 (tagged) through `api` and `page.reload()`. `ORDER()[0] === R5` and `ORDER().slice(1)` equals `[R4, R1, R2, R3]`.
- **C7 touch at 390 px.**
  - `const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })`, then a new page. Sign in through the form exactly as `.verify/empty-rows.mjs` lines 11-17 do (`#username` `verve`, `#password` `verve-dev-2026`). Open the app and the sidebar the way `.verify/phase-18.mjs` gate 9 does, and register the PUT collector on this page.
  - `const cdp = await ctx.newCDPSession(p)`. `touchDrag(fromPoint, toPoint)` sends `Input.dispatchTouchEvent` `touchStart` at `fromPoint`, eight `touchMove`s interpolated to `toPoint` 30 ms apart, then `touchEnd`.
  - **Title press.** `touchDrag` from the centre of `ROW(R3) a span` to 25% of `ROW(R5)`'s height. Pass half one iff no PUT is captured within 1.5 s and `ORDER()` is unchanged.
  - **Handle press.** `touchDrag` from the centre of `ROW(R3) [data-testid="simple-chat-icon"]` to 25% of `ROW(R5)`'s height. Pass half two iff a PUT with `{"afterSessionId":null}` is captured within 3 s and `ORDER()[0] === R3`.
  - `p.screenshot({ path: '.verify/shots/sre-390-light.png' })`, then close `ctx`.

**`finally`, always.** `DELETE /api/providers/sessions/<id>?force=true` for every recorded id, `PATCH {"simpleChatList": false}`, then close the browser. Print the results, then `SIMPLE-REORDER PASS` iff all seven passed, else `SIMPLE-REORDER FAIL` with `process.exitCode = 1`.

**Sirens.**
- **A drag library.** You will want `@dnd-kit`. No new dependency; the hook is pointer events and window listeners.
- **HTML5 drag.** You will want `draggable` plus `dataTransfer` because the gutter does it. The check refuses both words in the hook; touch is the reason.
- **Faking the drop.** You will want to call the API from the probe to "set up" an order, or to dispatch synthetic `PointerEvent`s through `page.evaluate`. Every gate drags through `page.mouse` or CDP touch, so the real event path is what is proven. Setup creates sessions only.
- **The 5 px threshold.** You will be tempted to lower it to 0 so the probe needs fewer steps. A zero threshold turns every click into a drag; keep 5.
- **Row clicks.** If C5's click fails because the drag swallowed it, fix it in the hook, which is in this manifest. If the cause is the scaffold's composition, the row file is forbidden: report the `[FAIL]` line and the file:line verbatim with `RESULT: BLOCKED`.
- **The mobile sidebar.** If it cannot be opened at 390 px the way phase-18 gate 9 does, report the selector you tried and the DOM around the menu control verbatim with `RESULT: BLOCKED`; do not skip C7.

## Phase 8 — Docs: the contract note and the verification paragraph
Depends on: Phase 2, Phase 5, Phase 7

```toml
[phase]
id = "8"
builder = "prometheus"
model = "sonnet"
code_change = false
doc_sweep = "foreground"
manifest = ["docs/simple-chat-list.md", "docs/verification.md"]
forbidden = ["src", "server", ".verify"]
athena = [
  "docs/simple-chat-list.md restates the route table or the column SQL that server/modules/providers/README.md and the Interfaces own, instead of linking",
  "The unread rule is described as a client call or a client-side flag rather than last_completed_at versus last_read_at on the server, stamped at the registry's one complete and read from the chat's chat.presence report",
  "The verification paragraph names a probe, a final PASS line or a gate count that differs from the three probe files",
]

[[steps]]
kind = "edit"
path = "docs/simple-chat-list.md"
what = "Add three short sections after 'Removing a chat': 'Order' (manual order in simple_list_rank, a new chat always on top, drag by row with a mouse and by the icon with touch, the server computes the midpoint and renumbers on collapse); 'Icons' (a name per session, 24 choices plus default, unknown names draw the default); 'Unread' (stamped once per run end in the run registry, already read when the chat was on screen; otherwise read comes from the chat's own chat.presence report when that chat is visible, in either sidebar mode; every change broadcasts session_upserted; the dot never shows on the open chat). Extend 'Proving it' with the three probes. Link server/modules/providers/README.md for the routes and docs/notifications.md for presence."
check = '''echo $(grep -c 'simple_list_rank' docs/simple-chat-list.md) $(grep -c 'chat.presence' docs/simple-chat-list.md) $(grep -c 'probe-simple-reorder.mjs' docs/simple-chat-list.md)'''
expect_re = "^[1-9] [1-9] [1-9]$"

[[steps]]
kind = "edit"
path = "docs/verification.md"
what = "Add one paragraph after the Phase 18 paragraph naming the three probes (probe-sidebar-state-api.mjs ends SIDEBAR-STATE-API PASS with 8 gates; probe-simple-icons-unread.mjs ends SIMPLE-ICONS-UNREAD PASS with 8; probe-simple-reorder.mjs ends SIMPLE-REORDER PASS with 7), that they spend zero Claude turns because the run end comes from a cursor session whose CLI is absent, that the API probe reads unread through real chat.presence frames, that they are not part of all.mjs, and that touch is driven through CDP Input.dispatchTouchEvent."
check = '''echo $(grep -c 'SIDEBAR-STATE-API PASS' docs/verification.md) $(grep -c 'SIMPLE-ICONS-UNREAD PASS' docs/verification.md) $(grep -c 'SIMPLE-REORDER PASS' docs/verification.md)'''
expect_re = "^[1-9] [1-9] [1-9]$"

[[verify]]
cmd = '''echo $(grep -c 'dispatchTouchEvent' docs/verification.md) $(grep -c 'server/modules/providers/README.md' docs/simple-chat-list.md)'''
expect_re = "^[1-9] [1-9]$"
```

**What to write.** `docs/simple-chat-list.md` stays the one home for what the simple list is. Routes stay in `server/modules/providers/README.md`, the registry's stamp and broadcast in `server/modules/websocket/README.md`, and presence in `docs/notifications.md`; link all three, do not restate them. Keep the note under 120 lines.

**Sirens.** You will want to describe the drag mechanics line by line; one sentence each for mouse and touch is the contract. You will want to paste gate lists into `verification.md`; name the probes and what they spend, the probe files hold the gates.

## Goal

*Goal:* in the simple chat list, every row shows a chat icon you can change from its "..." menu. Rows can be dragged into a saved order: whole row with a mouse, icon with touch. A chat whose run finishes while it is not on screen shows a green dot, live, which clears once that chat is on screen.

*Verify by:*
- Phase 2's `node .verify/probe-sidebar-state-api.mjs` ends `SIDEBAR-STATE-API PASS`.
- Phase 5's `node .verify/probe-simple-icons-unread.mjs` ends `SIMPLE-ICONS-UNREAD PASS`.
- Phase 7's `node .verify/probe-simple-reorder.mjs` ends `SIMPLE-REORDER PASS`.
- Each of the three leaves `residue=0` in `~/.cloudcli/auth.db`.
- Phases 5 and 7 each prove their scaffold's composition kept.

## Decisions

Each default is chosen now; its reversal is written beside it.

- **Scope is the simple chat list only.** The operator's message is about "the simple chats", and the simple list is the default sidebar. The project tree, its session rows and the collapsed rail draw nothing new. The server state (`icon`, `unread`, read-from-presence) is per session and works in both sidebar modes, so the tree can adopt the dot later with no server work. Reversal: render `SimpleChatIconGlyph` and the dot in `SidebarSessionItem.tsx` from the same fields.
- **"The extended dropdown menu" is the row's existing "..." `ActionMenu`.** `ActionMenu` has no submenu or custom-item slot (`ActionMenu.tsx:11-40`), so the menu gains a **Change icon** item that opens a small picker dialog. Reversal: give `ActionMenu` a panel slot in `src/shared/ui` and render the grid inline, a library change of its own.
- **The icon set is a fixed 24 plus Default**, in `SidebarSessionIcon.tsx`, which both the row and the picker read. It is stored as a kebab-case name, and an unknown name draws the default. Reversal: edit `SIMPLE_CHAT_ICONS`; the server accepts any `[a-z0-9-]{1,40}` name.
- **Icon option labels** translate the "{{name}} icon" frame but keep the English icon name inside it. Reversal: 24 more keys per locale.
- **Order lives on the server** as `sessions.simple_list_rank` (REAL, higher = nearer the top). A preference-array order was rejected: it grows without bound with deleted chats and cannot keep "a new chat lands on top" without a client rewrite of the array.
  - A moved row gets the midpoint of its new neighbours, computed by the server, so pagination never matters. A collapsed midpoint renumbers the tagged rows in one transaction.
  - "The rank above every tagged row, never below now" is written once, as `NEXT_TOP_SIMPLE_LIST_RANK_SQL`. Both a new tagged chat and a move to the top read it.
  - Reversal: `ORDER BY simple_list_at DESC` restores newest-first without dropping the column.
- **Drag is pointer events, not HTML5 drag and drop.** HTML5 drag never fires from touch in mobile browsers, and the operator uses this list on a phone.
  - A mouse or pen drags the whole row after 5 px of movement.
  - Touch drags only from the leading icon, which carries `touch-none`, so a finger on the title still scrolls the list.
  - Reversal: accept touch from the whole row after a long-press, in `useSimpleChatReorder`.
- **"Done" is the run's one `complete`, whatever the outcome.** A crashed, stopped or successful run all count; the invariant "exactly one complete per run" (`docs/architecture/README.md` L149) makes that one stamp per run. Reversal: stamp only when the complete frame's `success` is true, in `recordRunCompletion`.
- **Unread and read live on the server** as `last_completed_at` vs `last_read_at`, so a phone and a laptop agree, and a chat that finished while no tab was open still dots on the next visit. The unread rule is written once, as `SESSION_UNREAD_SQL`. The page query selects it `AS unread`, the read guard reuses it, and the mapper reads `Boolean(row.unread)`. Rejected: client-only tracking of the busy set, which misses every run that ends while the page is closed. Reversal: none wanted.
- **Read comes from presence.**
  - **The source.** `chat.presence` is already "which session this socket is watching, and whether its tab is visible" (`docs/architecture/README.md` L111). The chat view sends it at mount, on every session change, on `visibilitychange` and every 30 s while visible, in both sidebar modes (`docs/notifications.md` L215-218).
  - **Reading.** A visible presence report marks the session read through `markReadIfCompleted`, which writes only when unread and broadcasts only when a row changed, so the heartbeat costs one guarded UPDATE.
  - **Completing.** A completion is stamped already read when `isSessionOnScreen` says any tab has that chat visible. `isSessionOnScreen` reads the same presence store as `isSessionWatched` without its user filter, because `sessions` has no user column and `ChatRun` carries no user.
  - **No client read path:** no route, no api helper, no hook.
  - **A known limit.** A chat hidden behind the Files, Shell or Git tab reports no presence (`docs/notifications.md` L218-220), so it stays unread until the chat tab is shown. This is the same "on screen" the phone push already uses.
  - Reversal: none wanted; a second, client-side read signal is the defect this replaces.
- **The stamp is in `decorateAndRecordEvent`**, the registry's one terminal choke point for every provider (chat-run-registry.service.ts:115-122). It is not beside the four runtime `notifyRunStopped` calls. The broadcast reuses `broadcastSessionUpserted`, which the same file already fires for id mapping (line 150), because the `complete` frame reaches only the run's own audience. The registry already imports the database barrel, and the websocket module already imports notifications, so the new imports add no cycle. Reversal: none wanted.
- **The dot is `bg-primary`**, Verve's green SHAPE (README L37-38), with `aria-label`/`title` text. It sits where the running spinner sits and never shows with it or on the selected row. Reversal: move the span before the title block in `SidebarSimpleListRow.tsx`.
- **Every write broadcasts `session_upserted`:** icon, position, completion, and a read that changed a row. Another open tab or device therefore re-reads its list within the existing 500 ms debounce. Reversal: remove the broadcast calls in `session-user-state.service.ts`.
- **Server placement.**
  - **Storage and service:** two new files, `session-user-state.db.ts` and `session-user-state.service.ts`, named for what they hold (facts about a session), not for the sidebar, which is one reader. `sessions.db.ts` (786 lines) and `sessions.service.ts` (749 lines) take only a handful of lines.
  - **Routes:** the icon and position routes live in the sibling `session-user-state.routes.ts`, mounted from `provider.routes.ts` with one `router.use` line, so the 939-line file shrinks rather than grows.
  - **Shared parser:** `parseSessionId` moves to `server/shared/utils.ts` because two route files now use it (backend standard L33).
  - Reversal: none wanted.
- **Zero-cost proof.** A real run end is produced by a cursor session whose CLI is absent on this box, the technique `docs/verification.md` L1685-1687 already measures. Read is proven with real `chat.presence` frames from Node (Phase 2) and from the app's own chat view (Phase 5). Reversal: none wanted.
- **The composition check is an alignment, not a subsequence.** A subsequence test passes any added line, such as a new JSX prop, and names the wrong line when it fails.
  - The check aligns the stripped snapshot with the shipped file (`difflib.SequenceMatcher`, `autojunk=False`). It accepts only equal runs, insertions at a marker site (slid across identical neighbouring lines), and whole import lines in the import block.
  - It was proven 2026-09-15 on a scaffold built from the real `SidebarSimpleList.tsx` (227 lines). A correct fill printed `kept`. An inserted JSX prop, an edited line, a deleted line, a moved blank line, swapped props and an import placed outside the header each printed `CHANGED` with the right shipped line.
  - The same text sits inline in Phases 5 and 7, because a plan file is the only thing the planner writes.
  - Its known limit: it proves a fill against its own scaffold only until the next scaffold edits the same file (Phase 5's Sirens).
  - Reversal: none wanted.
- **Builders are derived, not chosen.** `plan-runner route` classifies every phase from its paths, and this plan follows it (operator ruling 2026-09-15).
  - Server work (Phase 1) and the data layer (Phase 3) go to Hephaestus.
  - The API probe (Phase 2) goes to Hephaestus. Its manifest names its artifact JSON, not the `.verify/artifacts` directory, which holds an unrelated `.html` baseline that would route it as UI.
  - Each UI change is a scaffold/fill pair: icon, picker and dot are Phases 4 → 5; drag is Phases 6 → 7. Iris on `opus` composes each scaffold, and Hephaestus fills it and writes its probe.
  - Docs (Phase 8) go to Prometheus.
  - The `patchLocal` and `moveLocal` hook changes ride in the fill phases that consume them, so Phase 3 touches no render file.
  - Reversal: none wanted.

## Waves

Wave 1: Phase 1, Phase 3 — independent (server only vs. `src/shared` + locale files; no shared file, no shared doc)
Wave 2: Phase 2 — the API probe; consumes Phase 1
Wave 3: Phase 4 — icon, picker and dot scaffold; consumes Phase 1 and Phase 3
Wave 4: Phase 5 — its fill and the icons/unread probe; consumes Phase 4
Wave 5: Phase 6 — drag scaffold; consumes Phase 5 (the same two component files)
Wave 6: Phase 7 — its fill and the reorder probe; consumes Phase 6
Wave 7: Phase 8 — docs; consumes Phases 2, 5, 7

Wave 1 holds two independent phases, each about a sitting; everything after is serial on shared component files, so the plan stays one file.

## Edge cases

- **A drag while a `session_upserted` reload lands.** Rows re-render; the hook reads row rects at every move and resolves the drop by session id, so the drop still lands where the line showed.
- **A drag onto a row not yet paged in.** Not possible; only loaded rows are targets. The server's midpoint uses the true next row, so the order stays correct past the loaded page.
- **The move PUT fails** (network, 404 because the row was archived or deleted elsewhere). `reload()` restores the server order.
- **Two devices drag at once.** The last write wins per row; the other device's list reloads on the broadcast.
- **Midpoint collapse after many moves into one gap.** The renumber path keeps the order (A5 drives 60 moves).
- **A chat with a stored icon name no longer in the map.** It draws the default; the picker opens with nothing pressed.
- **The icon PUT fails.** The row reverts to its previous icon.
- **A run ends while the open chat's tab is hidden.** The last presence report said hidden, so `isSessionOnScreen` is false and the completion is stamped unread. The dot is not drawn on the selected row. When the tab becomes visible, the chat view reports presence, the server reads it, and it broadcasts.
- **A run ends while no tab is open at all.** It is stamped unread. The next load of the simple list shows the dot; opening that chat reads it.
- **A stale presence record** (a tab that closed without clearing). The socket's close drops its presence record (`server/modules/websocket/README.md` L121), and the freshness window bounds any other case, the same bound phone pushes already accept.
- **The chat is open but behind the Files, Shell or Git tab.** No presence is reported, so it stays unread until the chat tab is shown. The row hides the dot while selected either way.
- **A chat is aborted from its own open view.** It is on screen, so it is stamped read; no dot.
- **The presence heartbeat every 30 s on a read chat.** `markReadIfCompleted` matches no row, writes nothing and broadcasts nothing (A8 half three).
- **A chat is removed or archived while unread.** It leaves the list; its columns stay on the row and change nothing.
- **A running chat.** The spinner shows and the dot never shows beside it; when the run's complete lands, the dot appears unless the chat is on screen.
- **A server that re-adopts a Claude run on boot.** Its completion passes the same block and stamps once; presence re-reported after the reconnect decides read.
- **The API restarts between a complete and its broadcast.** The stamp is written before the broadcast, so the next list load shows the dot.
- **A tagged row whose rank is NULL** (tagged before this migration on a DB that skipped the backfill). `ORDER BY … DESC` puts NULLs last in SQLite; the backfill makes this unreachable on migrated databases.

## Exclusions

- **The project tree drawing** icons, dots or drag. The server state already covers it, for a later card.
- **A keyboard alternative to dragging.** Named as a follow-up accessibility card.
- **Translated names for the 24 icons.**
- **A browser tab-title or web-push "unread" signal.** The dot is the only unread surface.
- **Marking a chat unread by hand.**
- **Treating a chat behind the Files, Shell or Git tab as on screen.** That changes presence semantics for phone pushes too.
- **Splitting `provider.routes.ts`** (939 lines, over the 800 hard ceiling), `sessions.db.ts` (786) or `sessions.service.ts` (749). Named as follow-up candidates; this plan shrinks the first and adds only the lines named in Project Constraints to the others.
- **The literal-green status dots elsewhere** (`PluginSettingsTab.tsx:188-189`, `CommandResultModal.tsx:537-545`, `AboutTab.tsx:64`, `TodoList.tsx:51`, `ProviderSkills.tsx:660`). Verve drift, surfaced, not this plan's.
- **Pre-existing test files** `src/shared/tests/busySessionIds.test.tsx` and `src/modules/sidebar/tests/sidebarRowProps.test.tsx`, which exist against the operator's no-tests rule. Surfaced, not deleted here.
- **Committing or pushing this work.** Nothing in the run depends on it.

## Doctrine citations

- `AGENTS.md` binds `.agents/skills/backend-module-standards/SKILL.md` (L22, L33-36, L40-42, L48-49) and `.agents/skills/frontend-module-standards/SKILL.md` (L19-23, L52, L66-77, L114, L144), quoted in Project Constraints.
- `src/shared/ui/verve/README.md` rule 3 (L29-40, including the green shape at L37-38), rule 4 (L49-55), library rule 4 (L106-108) and the translated-string rule (L164).
- `docs/architecture/README.md`: `chat.presence` (L111), invariants 2 and 3 (L149-153), and the `session_upserted` row (L90).
- `docs/notifications.md` §"Not while you are watching" (L210-221): the presence store, its 90 s window, when the chat reports it, and the Files/Shell/Git limit.
- `server/modules/websocket/README.md`: Service Map (L44-45), presence dropped on close (L121), and §"Shared Client Registry and Broadcasts" (L236-249), updated in Phase 1.
- `docs/verification.md`: the dev server (L7-31), the browser harness (L89-123), and §"The ntfy probes" (L1661-1692, the free cursor run end).
- `docs/simple-chat-list.md`: the tag, removal and proof sections this plan extends.
- `docs/plans/simple-chat-list.plan.md` Decisions: the recents feed as the one simple-list query, which this plan re-orders by rank.
- `~/.claude/charters/odysseus/PLAN_FORMAT_V2.md` §5: the derived route and the `kind` / `scaffold_of` rows; `~/.claude/charters/iris/SKILL.md` §"The scaffold": the `FILL:` marker contract.
- Operator global law: no tests, no branches, healed means deleted, root cause before fix, verify against the running system; module size (300 default / 500 soft / 800 hard).

## Open Questions

(none)

## Ship Logs

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 2 · spawns 5/120 · fix-passes 1 of 2 · cost $1.17 (run $1.17) · resumed 1×
- builder: hephaestus/deepseek-flash · session 438d126c-ae1c-4d8f-b80e-7c4cb8d7bfa3 · 423s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/deepseek-flash (87s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 18/18 steps OK · verify 3/3 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_1/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 3 · spawns 6/120 · fix-passes 0 of 2 · cost $0.09 (run $1.27) · resumed 1×
- builder: hephaestus/deepseek-flash · session 5fad5f6d-0587-4d28-81c0-10caf2813664 · 554s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 2/2 steps OK · verify 2/2 OK
- forbidden: unchanged (4 declared, 4 present)
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_2/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 4 · spawns 9/120 · fix-passes 0 of 2 · cost $0.95 (run $2.21) · resumed 1×
- builder: hephaestus/deepseek-flash · session 8d9cbd25-0175-4b39-974e-e5e926d7b94d · 86s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 4/4 steps OK · verify 3/3 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 5 · spawns 12/120 · fix-passes 0 of 2 · cost $5.00 (run $7.21) · resumed 1×
- builder: iris/opus · session 5ab3a829-86e7-48db-960a-cdd963cddf0f · 663s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 6/6 steps OK · verify 2/2 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 1 files
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_4/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 6 · spawns 16/120 · fix-passes 1 of 2 · cost $0.99 (run $8.21) · resumed 1×
- builder: hephaestus/deepseek-flash · session f1d2bb49-3e61-4fcd-ad1b-f68af4c86074 · 1020s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (212s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 5/5 OK
- forbidden: unchanged (9 declared, 9 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_5/

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 7 · spawns 20/120 · fix-passes 1 of 2 · cost $2.74 (run $10.95) · resumed 1×
- builder: iris/opus · session 094b27cf-c1ed-4ecd-9ab3-1497c3ff10b5 · 177s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/opus (40s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_6/

### Phase 7 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 8 · spawns 24/120 · fix-passes 1 of 2 · cost $1.34 (run $12.28) · resumed 1×
- builder: hephaestus/deepseek-flash · session 600822e3-b27e-4306-8258-b727b00ac323 · 1014s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 1 · LOW 0 → fix-pass 1/deepseek-flash (397s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 6/6 steps OK · verify 5/5 OK
- forbidden: unchanged (9 declared, 9 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 1 · MED 1 · LOW 0 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_7/

### Phase 8 Ship Log — ✅ SHIPPED 2026-09-15
- run: sidebar-drag-icons-unread-plan-20260915-104906-627d · attempt 1 of 2 · cycle 9 · spawns 25/120 · fix-passes 0 of 2 · cost $0.06 (run $12.34) · resumed 1×
- builder: prometheus/deepseek-flash · session f8f0d988-e940-4b06-81b6-11e189f8cc1b · 118s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 2/2 steps OK · verify 1/1 OK
- forbidden: unchanged (3 declared, 3 present)
- evidence: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/phase_8/

### Run sidebar-drag-icons-unread-plan-20260915-104906-627d — COMPLETE 2026-09-15
- shipped: 1, 2, 3, 4, 5, 6, 7, 8
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/sidebar-drag-icons-unread-plan-20260915-104906-627d/resume_brief.md
