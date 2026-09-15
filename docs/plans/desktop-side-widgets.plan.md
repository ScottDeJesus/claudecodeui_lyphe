# Desktop side widgets — Runner and Memory in the chat gutters

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> For desktop only, the chat window has a lot of empty space on the left and right sides. What I would like to do with that space is make widgets that already exist inside of cloudCLI. For instance I would like to make a runner widget, a memory widget, and possibly a files widget. I can press on these widgets. For these widgets I should be able to press the Tab for them and then they can open up already inside of the chat in the widgets while I'm on desktop (because the view is already so big and I have a lot of empty space). There's no need to pull up a brand new screen to be able to view a small piece of memory or of the runners.I would like it to be able to not go over the chat but to have placements on the left and right sides where I can put these widgets, kind of like predetermined areas. Maybe four of them:
> - top left
> - bottom left
> - top right
> - bottom right
>
> I would like to implement that please. I would also like to have a pin on the side of those widgets. If the session has started or created that plan, I would like that runner to be pinned to the top. Similarly if that session created the memory, I would like that memory to be pinned to the top, basically saying that this session was responsible for creating that memory. Does that make any sense? Do you have any questions?
>
> (answers to the follow-up questions) "What should the memory widget show?"="Pending + recent (Recommended)", "How should widgets get into the four corner slots?"="Drag and drop", "What does the widget's 'tab' do when you press it?"="Expand in place (Recommended)", "What should happen when you click a file in the files widget?"="Let's not make the file editor a widget please. Sorry."

**THIS PLAN DELIVERS:**
On the chat tab, on a non-mobile layout whose chat region is at least 1500px wide, two gutters 300–480px wide appear left and right of the chat column. AT EVERY WIDTH — gutters or none — the chat column is the transcript's own 868px column, so the scroll pane and the scrollbar pinned to its right edge end where the transcript ends and never run out into the space the gutters take. They never overlap it: the gutters and the chat are three cells of one grid, so nothing is layered over the transcript. Each gutter has two slots (top, bottom), four slots in all. There are two widgets, Runner and Memory, and no files widget. Each widget is either a slim tab in its slot or, once its tab is pressed, a card that fills the slot in place. You drag a widget by its card header, or by its tab, into any slot. Dropping onto a slot the other widget holds swaps the two. Placement and open/closed state persist as a server-synced user preference (`chatGutters`).

- **Runner widget.** Shows the same runs the Runner tab shows, as `RunCard`s with phases folded, with the same Stop / Resume / Dismiss verbs. Runs whose `run.json` `launched_by_session` names the open chat come first, marked with a pin and "This session". That field is newly added to the server's run snapshot.
- **Memory widget.** Shows pending candidates on top, with the existing File / Discard verbs, and below them the 20 most recent approved memories. In both sections, memories whose Descent `session_id` names the open chat come first, pinned the same way. Descent's lean list gains `session_id`, and CloudCLI gains an approved-list read.
- **What counts as "this session".** The open chat's app session id (the id in the URL). The server resolves every Claude transcript id it reads (a run's `launched_by_session`, a memory's `session_id`) to the app id before it reaches the browser, including transcript ids an edit superseded. The browser never sees a provider id and does no id matching of its own.
- **Below the width.** Below 1500px, and always on mobile, no gutters and no slots are drawn; the chat keeps its own column and the widgets wait for a wider region (a collapsed sidebar or a taller window restores them without a reload).
- **Docs.** The stale docs line "a run belongs to no chat session" and "this lane reads exactly one field: `stopped_at`" are corrected.

**OPERATOR VERDICT:** CONFIRMED -- 2026-09-14 -- Scott: "Accept — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = ["/home/lyphe/.claude/descent", "/home/lyphe/.claude/state/runner", "/home/lyphe/.claude/state/runner-fixtures"]

[budget]
max_cycles = 20
max_spawns = 60
max_fix_passes = 2
max_attempts = 2
max_replans = 3
```

## Interfaces

Descent (`/home/lyphe/.claude/descent`, Python, live-reloaded by `devserver.py` on any `.py` save — no restart):

- `store_memory.py` `list_memory_candidates(status: str | None = None, limit: int = 100)` (line 310): its SELECT (lines 325-328) gains the column `session_id`; `_project_lean` (lines 95-106) gains the key `"session_id": row["session_id"]`. Nothing else changes: same order (`created_at DESC, id DESC`), same limit, same handler `server_api_memory.py::h_list_memory`. The column already exists (`store_schema_ddl.py:306`); no migration.
- `README.md:749` (the `GET /api/memory` row) names `session_id` in the lean field list.

CloudCLI server (paths relative to `server/`; `@/` alias, `.js` import suffix):

- `modules/database/repositories/sessions.db.ts` gains `resolveAppSessionId(id: string): string`, a method on the exported `sessionsDb` object beside `getSessionByProviderSessionId` and `getSessionById`, with a doc comment. It tries, in order, and returns the first hit's app `session_id`:
  1. `getSessionByProviderSessionId(id)`;
  2. the `superseded_provider_sessions` row whose superseded provider id equals `id` (its app `session_id` column; read the table's real column names in `modules/database/schema.ts` before writing the query);
  3. `getSessionById(id)`.
  Otherwise it returns `id` unchanged. It is a synchronous better-sqlite3 read and never throws; a DB error returns `id` unchanged. `sessionsDb` is already exported from `modules/database/index.ts`, so no barrel change.
- `shared/types.ts:288` `RunnerRunSnapshot` gains `launched_by_session: string | null;`. The JSDoc line added to its block (lines 276-287) says: the APP session id of the chat whose turn launched the run. `run.json`'s raw `launched_by_session` (a Claude transcript uuid) is resolved through `sessionsDb.resolveAppSessionId` by `plan-runner.module.ts` before any snapshot leaves the server. `null` when absent or not a non-empty string.
- `modules/plan-runner/runner-state.service.ts` `classifyRun` (lines 178-250) stays a pure disk reader. It reads the RAW value `field(files.run, 'launched_by_session')` (the same `field` helper, lines 86-88, same pattern as `stopped_at` at line 208), keeps it only when it is a non-empty string (else `null`), and puts it in the returned literal (lines 216-249) unresolved. It imports nothing from the database module. `withPlanTotals` (spread) and `supersedeEnded` (filter) need no change.
- `modules/plan-runner/plan-runner.module.ts` (the snapshot callback wiring, ~line 178; it feeds both `dependencies.current()` for `GET /runs` and the watcher broadcast): wrap that callback so every run it returns is `{ ...run, launched_by_session: run.launched_by_session === null ? null : sessionsDb.resolveAppSessionId(run.launched_by_session) }`. `sessionsDb` is imported from `@/modules/database/index.js`. The JSDoc above the wrapper says it is the one place a run's launching session becomes an app id. Every path that serves or broadcasts snapshots must pass through this wrapper, never around it.
- `shared/types.ts:1619` `MemoryCandidateLean` gains `sessionId: string | null;` — the APP session id of the chat that proposed the memory: Descent's unverified provenance column, resolved through `sessionsDb.resolveAppSessionId`, display only. `MemoryCandidateFull` (line 1621) currently adds `sessionId` itself; that member is DELETED from `MemoryCandidateFull` because it now inherits it from the lean type.
- `modules/descent/descent.memory.service.ts`:
  - `createDescentMemoryService(transport, resolveSessionId: (id: string) => string)` gains the resolver as its second parameter.
  - `toLeanCandidate(row, resolveSessionId)` (lines 51-73) sets `sessionId` to `null` when `readStringOrNull(record.session_id)` is null, else `resolveSessionId(that)`. `toFullCandidate`'s `sessionId` (line 94) is mapped through the same resolver the same way, so both reads agree.
  - ONE list verb replaces the hard-wired read: `list(status: 'pending' | 'approved'): Promise<MemoryPending>`, which is today's `pending()` body (lines 131-139) with the URL built as `` `/api/memory?status=${status}` ``. `pending()` stays on the returned object as the one-line `pending: () => list('pending')` so existing callers are untouched. There is no `approved()` method and no cloned body. `MemoryPending` is reused as the list-read union; it is not renamed.
- `modules/descent/descent.module.ts` (~line 40, where `createDescentMemoryService` is called): passes `(id) => sessionsDb.resolveAppSessionId(id)` as the second argument, with `sessionsDb` imported from `@/modules/database/index.js`.
- `modules/descent/descent.routes.ts` `GET /memory` (lines 91-97) reads `request.query.status` and calls `memoryService.list(request.query.status === 'approved' ? 'approved' : 'pending')`, so absent or any other value reads the pending queue as today. No new route.

CloudCLI client (`@/...` imports only; `type`, never `interface`):

- `src/shared/types.ts:2005` `RunnerRunSnapshot` mirror gains `launched_by_session: string | null;`. `src/shared/types.ts:1843` `MemoryCandidateLean` mirror gains `sessionId: string | null;` and the `MemoryCandidateFull` mirror drops its own `sessionId` member, exactly as on the server.
- `src/shared/types.ts` new group `//----------------- CHAT GUTTERS ------------` (appended at the end of the file, each type commented):
  - `export type GutterSlotId = 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right';`
  - `export type GutterWidgetId = 'runner' | 'memory';`
  - `export type GutterWidgetPlacement = { slot: GutterSlotId; open: boolean };`
  - `export type ChatGutterPlacements = Record<GutterWidgetId, GutterWidgetPlacement>;`
- `src/shared/api.ts:604-609` `descent.memory` gains `approved: () => get('/api/descent/memory?status=approved'),`.
- `src/shared/userSettings.ts` `UserPreferences` (lines 19-39) gains `chatGutters: unknown;` (parsed by its own hook, like `planRunner: unknown`) and `LEGACY_STORAGE_KEYS` (lines 67-84) gains `chatGutters: null,`. The server accepts any key and any JSON value (`server/modules/user/user.service.ts:61-80`) — no server change.
- `src/modules/plan-runner/runState.ts`: gains the exported `STATE_ORDER` map and `byUrgencyThenNewest(a, b)` comparator MOVED from `RunnerPanel.tsx:24-30` (pure move; `RunnerPanel.tsx` imports them from `@/modules/plan-runner/runState`).
- `src/modules/plan-runner/RunnerWidgetBody.tsx` (new): `export function RunnerWidgetBody({ sessionId }: { sessionId: string | null })`. Barrel `src/modules/plan-runner/index.ts` gains `export { RunnerWidgetBody } from '@/modules/plan-runner/RunnerWidgetBody';`.
- `src/modules/memory-intake/hooks/useApprovedMemories.ts` (new): `export function useApprovedMemories(): MemoryPending | null` — `null` until the first answer. It owns no timer: it reads on mount and again whenever `useMemoryIntake().pending` changes identity, so the provider's 60 s poll is the one clock.
- `src/modules/memory-intake/MemoryApprovedRow.tsx` (new, module-private): `export function MemoryApprovedRow({ candidate }: { candidate: MemoryCandidateLean })` — no pin prop; the pin marker is drawn by `MemoryWidgetBody` above the row.
- `src/modules/memory-intake/MemoryWidgetBody.tsx` (new): `export function MemoryWidgetBody({ sessionId }: { sessionId: string | null })`. Barrel `src/modules/memory-intake/index.ts` gains `export { MemoryWidgetBody } from '@/modules/memory-intake/MemoryWidgetBody';`.
- `src/shared/ui` is NOT changed. The pin marker is a composition, not a library component: a `<span data-session-pin className="inline-flex items-center gap-1">` holding lucide `PinIcon` (`aria-hidden`, `className="h-3.5 w-3.5"`) and `<Badge tone="info">{t('gutters.pin.label')}</Badge>`, with `title={t('gutters.pin.title')}`. Written once in `RunnerWidgetBody.tsx` and once in `MemoryWidgetBody.tsx` (both memory sections share that one copy). That makes two copies, under doctrine §2's promote-on-the-third rule.
- `src/modules/chat-gutters/` (new feature module; the name is chosen so it can never collide with `src/modules/widgets`, the sandboxed HTML fence renderer):
  - `index.ts` — `export { ChatGutterLayout } from '@/modules/chat-gutters/ChatGutterLayout';` and nothing else.
  - `ChatGutterLayout.tsx` — `export function ChatGutterLayout({ enabled, sessionId, boundary, children }: { enabled: boolean; sessionId: string | null; boundary: ComponentType<{ children: ReactNode }>; children: ReactNode })`. `boundary` wraps each widget body separately, so a crashing widget never takes down the chat or the other widget.
  - `GutterSlot.tsx` — `export function GutterSlot(props: { slot: GutterSlotId; widget: GutterWidgetId | null; open: boolean; hovered: boolean; dragging: GutterWidgetId | null; onHoverSlot: (slot: GutterSlotId | null) => void; onDropWidget: (widget: GutterWidgetId, slot: GutterSlotId) => void; renderWidget: (widget: GutterWidgetId) => ReactNode })`.
  - `GutterWidgetFrame.tsx` — `export function GutterWidgetFrame(props: { widget: GutterWidgetId; title: string; count: number; icon: LucideIcon; open: boolean; onToggle: () => void; onDragStart: (widget: GutterWidgetId) => void; onDragEnd: () => void; children: ReactNode })`. It knows which corner it is in from nothing at all: the slot draws it.
  - `hooks/useGutterPlacements.ts` — `export function useGutterPlacements(): { placements: ChatGutterPlacements; moveWidget: (widget: GutterWidgetId, slot: GutterSlotId) => void; toggleWidget: (widget: GutterWidgetId) => void }`.
- Constants, file-local to `ChatGutterLayout.tsx`: `GUTTER_GAP_PX = 16`, `CHAT_COLUMN_PX = 868` (= the `max-w-[54.25rem]` at `src/modules/chat/transcript/ChatMessagesPane.tsx:295` and `src/modules/chat/composer/ChatComposer.tsx:386`), `GUTTER_MIN_PX = 300`, `MIN_REGION_PX = CHAT_COLUMN_PX + 2 * (GUTTER_MIN_PX + GUTTER_GAP_PX)` (= 1500). The gutter CEILING has no constant because nothing computes with it: it is the `max-w-[1860px]` on the grid, and its derivation — 868 + 2 * (480 + 16), so no gutter passes 480px — is written beside that literal.
- Default placements (file-local to `useGutterPlacements.ts`): `{ runner: { slot: 'top-left', open: false }, memory: { slot: 'top-right', open: false } }`.
- Mount: `src/modules/project-workspace/WorkspaceMain.tsx:310-331` — `<ChatGutterLayout enabled={!isMobile} sessionId={selectedSession?.id ?? null} boundary={WorkspaceErrorBoundary}>` wraps `<ChatInterface … />` INSIDE the existing `WorkspaceErrorBoundary`. The URL, and therefore `selectedSession.id`, always holds the app id (`src/modules/project-workspace/hooks/useProjectsState.ts:856`, which navigates a provider alias to `/session/:appId`).
- `data-testid` hooks the probe reads: `chat-gutter-grid` (the grid root, present only when gutters show), `chat-gutter-chat` (the chat cell), `chat-gutter-left`, `chat-gutter-right` (the two asides), `gutter-slot` (each slot, with `data-slot="<GutterSlotId>"` and `data-widget="<id>|"`), `gutter-widget` (each frame root, with `data-widget` and `data-open="true|false"`), `gutter-widget-tab` (the collapsed tab button), `gutter-widget-header` (the drag handle header), `runner-widget-run` (each run `li`, with `data-run-id` and `data-pinned="true|false"`), `memory-widget-pending` / `memory-widget-approved` (the two section `ul`s), `memory-widget-row` (each row `li` in either section, with `data-candidate-id` and `data-pinned`).
- i18n keys, `common.json`, all 11 locales (`de en es fr it ja ko ru tr zh-CN zh-TW`), English values (translate for the other ten):
  - `gutters.runner.title` "Runs"
  - `gutters.memory.title` "Memory"
  - `gutters.open` "Open {{name}}"
  - `gutters.collapse` "Collapse"
  - `gutters.dragHint` "Drag to another slot"
  - `gutters.pin.label` "This session"
  - `gutters.pin.title` "Created by the chat you have open"
  - `gutters.memory.pending` "Waiting for review"
  - `gutters.memory.recent` "Recently filed"
  - `gutters.memory.recentEmpty` "Nothing filed yet"
  - `gutters.memory.pendingEmpty` "Nothing waiting"

## Project Constraints

- No unit tests, ever. Add no `*.test.ts(x)` file, no `tests/` addition, and no vitest config edit. `.agents/skills/*/SKILL.md` asks for module tests, and the operator's global rule overrides it. Verification is the `check`/`verify` commands in this plan, run against the running dev server and the live Descent.
- Never commit, push, branch, stash, checkout, restore or reset inside the run; the tree accumulates. Other sessions have many uncommitted edits in this tree, including `src/shared/types.ts`, `src/shared/api.ts`, `src/modules/plan-runner/RunCard.tsx`, `runState.ts`, `docs/plan-runner.md` and `server/modules/plan-runner/runner-*.service.ts`. Edit those files where they stand. Never revert or "clean up" a change that is not yours, and never treat one as a fence. A probe is undone by deleting what it created, never through git.
- The dev server is two systemd units (`cloudcli-server-dev` on 127.0.0.1:3011, `cloudcli-client-dev` on :5183). Never restart either by hand, and never run `npm run dev`, `server:dev` or `npm run build`. Every save under `server/` restarts the API through `tsx watch` and drops live Claude runs. So make ALL server edits of a phase in one consecutive pass, file after file, with no typecheck or curl between them, and run checks only after the last server file is saved. Vite hot-reloads `src/`. Descent's `devserver.py` reloads `:7878` on any `.py` save.
- Backend law (`.agents/skills/backend-module-standards/SKILL.md`):
  - TypeScript only under `server/modules/`.
  - Cross-module imports only through the module's `index.ts`; the `@/` alias with a `.js` suffix.
  - `type` over `interface`.
  - Routes parse and delegate only.
  - Exports at declaration, with a consumer comment.
- Frontend law (`.agents/skills/frontend-module-standards/SKILL.md`):
  - `@/...` imports only, never `./` or `../`; bare specifiers for packages; `import type` for types.
  - `type`, never `interface`.
  - A type used by two or more files lives in `src/shared/types.ts`, with a comment and a group header.
  - Another module is imported only through its `index.ts`; barrels export only what has a consumer.
  - A consumer comment on every exported component.
  - A comment immediately above every new state declaration saying why it exists.
  - No module-local `types.ts`, `utils.ts` or `constants.ts`.
- Verve (`~/.claude/design/DESIGN_DOCTRINE.md`; `src/shared/ui/verve/README.md`):
  - Screens compose existing library components imported from the barrel `@/shared/ui` (never a deep path): `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Button` (`size="icon"` is the icon button), `Badge` (`tone`), `EmptyState`, `ScrollArea`, `Spinner`.
  - No new file in `src/shared/ui/` and no CSS file anywhere. Colour reaches a screen only as a Tailwind colour name (`border-border`, `text-muted-foreground`, `bg-card`), never hex or `var(--…)`.
  - Tone is `tone="neutral|info|positive|warn|danger"`, and no tone rule is written.
  - Colour is never the whole signal: the pin is a glyph AND a word.
  - Icons come from `lucide-react` (already a dependency).
- No new npm dependency. Drag and drop is native HTML5 (`draggable`, `onDragStart`, `onDragOver`, `onDrop`, `dataTransfer`); `package.json` carries no dnd library and none is added.
- Descent law (`/home/lyphe/.claude/descent/GOTCHAS.md`):
  - #119: "`server.py::_serve_api` now folds a GET's query string into `body` — … a new GET handler must not name a `body` key it reads for a DIFFERENT purpose than a client `?param=` it does not intend to accept". This plan adds no handler and reads no new key.
  - #253: "The MEMORY approval fence is STRUCTURAL and HTTP-only — … the whole memory-intake lane carries ZERO MCP tools". This plan adds no MCP tool and no write path.
  - The `session_id` column is commented `UNVERIFIED provenance claim; display/forensics only`. A pin is display, and nothing may gate a verb on it.
- Module size: a new file stays under 250 LOC; split by cohesion before it passes. Never add more than ~40 lines to a file already over 300: `WorkspaceMain.tsx` 401, `src/shared/types.ts` ~2017, `server/shared/types.ts` ~1659, `runner-state.service.ts` 386 and `store_memory.py` 376 each take a handful of lines only.
- `npm run typecheck` must exit 0 (it did on 2026-09-15). `npm run lint` must exit 0, and it must print no warning naming a file this plan creates or edits. The whole-repo warning count (129 on 2026-09-15) moves with other sessions and is not a gate.
- Every new user-facing string is an i18n key present in all 11 locales' `common.json`. Parity is checked over THIS plan's `gutters.*` keys only, never whole-file, because pre-existing keys already differ between locales.
- Healed means deleted: no commented-out code, no "old" variants, no compatibility shims. A doc line made false by this plan is rewritten, never annotated.
- Standing stop rule: when reality diverges from this plan, stop. That covers a file or symbol not where an anchor says, a signature that differs, or a check failing for a reason the plan did not name. Report the divergence verbatim with `RESULT: BLOCKED`, and do not improvise a fix.

## Phase 1 — Descent: session_id on the lean memory list
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = ["/home/lyphe/.claude/descent/store_memory.py", "/home/lyphe/.claude/descent/README.md"]
athena = [
  "The SELECT gained session_id but _project_lean still omits it, so the HTTP rows are unchanged",
  "A second column or key was added beyond session_id (body, rationale), breaking the lean-by-design contract",
  "The ORDER BY / LIMIT / WHERE of list_memory_candidates changed as a side effect",
  "An MCP tool, a write path or a new route was added, breaching GOTCHAS #253",
]

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/descent/store_memory.py"
what = "Per Interfaces (Descent): add session_id to the SELECT column list in list_memory_candidates (lines 325-328) and the key \"session_id\": row[\"session_id\"] to _project_lean (lines 95-106). Nothing else in the file changes."
check = '''sleep 4; curl -s 'http://127.0.0.1:7878/api/memory?status=approved' | python3 -c 'import json,sys; c=json.load(sys.stdin)["candidates"]; print(len(c)>0 and all("session_id" in x for x in c) and any(x["session_id"]=="937565cc-0ede-42d5-853c-8728f492e3f0" for x in c))' '''
expect = "True"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/descent/README.md"
what = "In the GET /api/memory row of the HTTP table (line 749) add `session_id` to the parenthesised lean field list, after `refusal`, with the words: `session_id` (the proposing session, an unverified provenance claim — display only)."
check = '''grep -c 'GET /api/memory`.*session_id' /home/lyphe/.claude/descent/README.md'''
expect = "1"

[[verify]]
cmd = '''curl -s 'http://127.0.0.1:7878/api/memory?status=pending' | python3 -c 'import json,sys; c=json.load(sys.stdin)["candidates"]; print(all("session_id" in x and "body" not in x and x["status"]=="pending" for x in c))' '''
expect = "True"

[[verify]]
cmd = '''curl -s 'http://127.0.0.1:7878/api/memory/mc-26' | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("candidate", d); print(c.get("session_id"))' '''
expect = "937565cc-0ede-42d5-853c-8728f492e3f0"
```

**What to build.** Two lines in one Python function pair and one README table cell. The column exists (`store_schema_ddl.py:306`); no migration, no restart. `devserver.py` reloads `:7878` on save (Descent `README.md:90-95`).

**Sirens.**
- You will see `h_list_memory` in `server_api_memory.py` and want to add a `?session=` filter. Do not. No handler changes (GOTCHAS #119 governs every query key a GET handler reads).
- You will see the lessons lane beside it with the same lean shape. Do not touch lessons.
- You will want to add `session_id` to other projections or the event log. Only `_project_lean` changes; `_project_full` already carries it (line 79).
- If the second verify prints something other than the id because mc-26's full-read shape differs, report the printed shape verbatim with `RESULT: BLOCKED`. Do not rewrite the command. mc-26 was measured on 2026-09-15 as approved, with that session_id.

## Phase 2 — CloudCLI server and contracts: the app-id resolver, launched_by_session, sessionId, one memory list verb
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = [
  "server/shared/types.ts",
  "server/modules/database/repositories/sessions.db.ts",
  "server/modules/plan-runner/runner-state.service.ts",
  "server/modules/plan-runner/plan-runner.module.ts",
  "server/modules/descent/descent.memory.service.ts",
  "server/modules/descent/descent.module.ts",
  "server/modules/descent/descent.routes.ts",
  "src/shared/types.ts",
  "src/shared/api.ts",
  "docs/plan-runner.md",
  "docs/memory-intake.md",
]
forbidden = ["server/modules/user"]
athena = [
  "runner-state.service.ts resolves the id itself or imports the database module, instead of staying a pure disk reader with plan-runner.module.ts resolving",
  "One snapshot path (GET /runs, GET /runs/:id, or the runner_state broadcast) bypasses the resolving wrapper and ships the raw transcript uuid",
  "resolveAppSessionId misses a transcript id an edit superseded, throws on a DB error, or returns something other than the input for an unknown id",
  "GET /memory with no status, or an unknown status, no longer returns the pending queue (the Memory tab regresses)",
  "The client mirror in src/shared/types.ts drifts from the server type (field missing in one, or MemoryCandidateFull still redeclares sessionId in one file only)",
  "docs/plan-runner.md still claims the lane reads one field, that a run belongs to no chat session, or that the runner card has one home",
]

[[steps]]
kind = "edit"
path = "server/shared/types.ts"
what = "Per Interfaces: RunnerRunSnapshot (line 288) gains launched_by_session: string | null with the JSDoc line saying it is the APP session id resolved by plan-runner.module.ts; MemoryCandidateLean (line 1619) gains sessionId: string | null; MemoryCandidateFull drops its own sessionId member."
check = '''grep -c 'launched_by_session: string | null' server/shared/types.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/sessions.db.ts"
what = "Per Interfaces: add resolveAppSessionId(id: string): string to sessionsDb — provider id match, then superseded_provider_sessions, then app id match, else id unchanged; never throws."
check = '''grep -c 'resolveAppSessionId' server/modules/database/repositories/sessions.db.ts | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "server/modules/plan-runner/runner-state.service.ts"
what = "Per Interfaces: classifyRun reads the RAW field(files.run, 'launched_by_session'), non-empty string else null, into the returned literal (lines 216-249). No resolution and no database import here."
check = '''grep -c "field(files.run, 'launched_by_session')" server/modules/plan-runner/runner-state.service.ts; { grep -c 'modules/database\|resolveAppSessionId' server/modules/plan-runner/runner-state.service.ts || true; }'''
expect = "1\n0"

[[steps]]
kind = "edit"
path = "server/modules/plan-runner/plan-runner.module.ts"
what = "Per Interfaces: wrap the snapshot callback (~line 178) so every run carries launched_by_session resolved through sessionsDb.resolveAppSessionId (null stays null), with the JSDoc naming this as the one resolution point; both REST and the runner_state broadcast read through it."
check = '''grep -c 'resolveAppSessionId' server/modules/plan-runner/plan-runner.module.ts | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "server/modules/descent/descent.memory.service.ts"
what = "Per Interfaces: createDescentMemoryService takes resolveSessionId as its second parameter; toLeanCandidate and toFullCandidate map sessionId through it; list(status: 'pending' | 'approved') replaces the hard-wired pending() body, and pending becomes pending: () => list('pending'). No approved() method."
check = '''grep -c '/api/memory?status=\${status}' server/modules/descent/descent.memory.service.ts; { grep -c 'approved()\|status=pending' server/modules/descent/descent.memory.service.ts || true; }'''
expect = "1\n0"

[[steps]]
kind = "edit"
path = "server/modules/descent/descent.module.ts"
what = "Per Interfaces: pass (id) => sessionsDb.resolveAppSessionId(id) as createDescentMemoryService's second argument (~line 40), importing sessionsDb from '@/modules/database/index.js'."
check = '''grep -c 'resolveAppSessionId' server/modules/descent/descent.module.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/descent/descent.routes.ts"
what = "Per Interfaces: GET /memory calls memoryService.list(request.query.status === 'approved' ? 'approved' : 'pending')."
check = '''grep -c "memoryService.list(" server/modules/descent/descent.routes.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "Mirror the server exactly: RunnerRunSnapshot (line 2005) gains launched_by_session: string | null (same JSDoc meaning: the resolved APP id); MemoryCandidateLean (line 1843) gains sessionId: string | null; MemoryCandidateFull drops its own sessionId. Then append the CHAT GUTTERS group from Interfaces (four types, each commented, with the group header)."
check = '''grep -c 'launched_by_session: string | null\|export type GutterSlotId\|export type GutterWidgetId\|export type GutterWidgetPlacement\|export type ChatGutterPlacements' src/shared/types.ts'''
expect = "5"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Per Interfaces: descent.memory (lines 604-609) gains approved: () => get('/api/descent/memory?status=approved'), placed after pending."
check = '''grep -c "approved: () => get('/api/descent/memory?status=approved')" src/shared/api.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "docs/plan-runner.md"
what = "Three rewrites, deleting the old wording outright with no note about the change. (a) Line 29's cell becomes: This lane reads two fields: `stopped_at`, and `launched_by_session` — the Claude transcript uuid whose turn launched the run, which `plan-runner.module.ts` resolves to the app session id (`sessionsDb.resolveAppSessionId`) before any snapshot leaves the server; the chat gutter's Runner widget pins on it. (b) Line 326-327's sentence ending 'A tap opens the app root: a run belongs to no chat session.' becomes 'A tap opens the app root: the push goes to every active user, so it names no chat.' (c) Read lines 420-440 and replace the rule that the runner card has one home (lines 429-430) with: The runner card has two homes — the Runner tab, and the desktop chat gutter's Runner widget, which sits beside the transcript and never over it."
check = '''{ grep -c 'belongs to no chat session\|reads exactly one field' docs/plan-runner.md || true; }; grep -c 'launched_by_session' docs/plan-runner.md | sed 's/^[1-9][0-9]*$/ok/'; grep -c 'never over it' docs/plan-runner.md | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "0\nok\nok"

[[steps]]
kind = "edit"
path = "docs/memory-intake.md"
what = "In section 'Where the shapes live' (line 169) add one paragraph: the lean row carries `sessionId` — Descent's unverified provenance column resolved server-side to the app session id (`sessionsDb.resolveAppSessionId`, wired in `descent.module.ts`), display only, gates nothing — so a list can mark the memories the open chat proposed; `GET /api/descent/memory?status=approved` reads the filed list through the service's one `list(status)` verb, and any other status reads the pending queue."
check = '''grep -c 'status=approved' docs/memory-intake.md | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1; echo exit=$?'''
expect = "exit=0"

[[verify]]
cmd = '''sleep 6; T=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'Content-Type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'); curl -s -H "Authorization: Bearer $T" http://127.0.0.1:3011/api/plan-runner/runs > /tmp/dsw-runs.json; python3 - <<'PYEOF'
import json, os, sqlite3
db = sqlite3.connect("file:" + os.path.expanduser("~/.cloudcli/auth.db") + "?mode=ro", uri=True)
def resolve(i):
    r = db.execute("select session_id from sessions where provider_session_id=?", (i,)).fetchone()
    if r: return r[0]
    try:
        cols = [c[1] for c in db.execute("pragma table_info(superseded_provider_sessions)")]
        pc = [c for c in cols if c != "session_id" and "provider" in c]
        if pc:
            r = db.execute("select session_id from superseded_provider_sessions where %s=?" % pc[0], (i,)).fetchone()
            if r: return r[0]
    except Exception:
        pass
    r = db.execute("select session_id from sessions where session_id=?", (i,)).fetchone()
    return r[0] if r else i
ok = True
for run in json.load(open("/tmp/dsw-runs.json"))["runs"]:
    p = os.path.expanduser("~/.claude/state/runner/%s/run.json" % run["run_id"])
    raw = None
    if os.path.exists(p):
        v = json.load(open(p)).get("launched_by_session")
        raw = v if isinstance(v, str) and v else None
    want = None if raw is None else resolve(raw)
    ok = ok and "launched_by_session" in run and run["launched_by_session"] == want
print(ok)
PYEOF'''
expect = "True"

[[verify]]
cmd = '''T=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'Content-Type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'); A=$(curl -s -H "Authorization: Bearer $T" 'http://127.0.0.1:3011/api/descent/memory?status=approved'); P=$(curl -s -H "Authorization: Bearer $T" 'http://127.0.0.1:3011/api/descent/memory'); B=$(curl -s -H "Authorization: Bearer $T" 'http://127.0.0.1:3011/api/descent/memory?status=bogus'); python3 -c '
import json,sys
a,p,b=(json.loads(x) for x in sys.argv[1:4])
ok = a["reachable"] and all("sessionId" in c and c["status"]=="approved" for c in a["candidates"]) and any(c["sessionId"]=="937565cc-0ede-42d5-853c-8728f492e3f0" for c in a["candidates"])
ok = ok and p["reachable"] and all(c["status"]=="pending" and "sessionId" in c for c in p["candidates"]) and p==b
print(ok)' "$A" "$P" "$B"'''
expect = "True"
```

**What to build.** The contracts every later phase consumes, per Interfaces:
- one resolver;
- one raw snapshot field and its one resolution point;
- one lean-row field resolved the same way;
- one memory list verb;
- the four gutter types and one api helper;
- three doc rewrites.

The browser never learns a provider id (`docs/architecture/README.md` § "Cross-cutting invariants", invariant 1). That is why resolution happens here and not in the client.

Make the seven `server/` edits in ONE consecutive pass, in this order: `server/shared/types.ts` → `sessions.db.ts` → `runner-state.service.ts` → `plan-runner.module.ts` → `descent.memory.service.ts` → `descent.module.ts` → `descent.routes.ts`. Then do the client, the docs and the typecheck.

**Patterns to copy.**
- The raw read is `const stoppedAt = readNumberOrNull(field(files.run, 'stopped_at'));` at `runner-state.service.ts:208`.
- The resolver's first and third lookups are the existing `sessionsDb.getSessionByProviderSessionId` and `sessionsDb.getSessionById`, the pair `sessions.service.ts:589` already chains.
- `list(status)` is today's `pending()` body at `descent.memory.service.ts:131-139`, with the URL parameterised.

**Sirens.**
- You will see `runner-endings.service.ts` and `runner-watcher.service.ts` with uncommitted edits from another session. They are not in the manifest. The broadcast must still carry resolved ids, so wrap the callback those files are handed in `plan-runner.module.ts`. Never edit them. If the watcher reads snapshots through a path `plan-runner.module.ts` cannot wrap, report the lines verbatim with `RESULT: BLOCKED`.
- You will want to resolve inside `classifyRun`, because it is one line. Do not. `runner-state.service.ts` stays a pure disk reader.
- If `superseded_provider_sessions` does not exist in `schema.ts`, report that verbatim with `RESULT: BLOCKED`. Do not invent a table.
- You will want to use `launched_by_session` in the ntfy tap URL. Do not: the push goes to every user.
- `MemoryCandidateFull` removing `sessionId` may break a consumer's destructuring. If typecheck names a file outside this manifest, report it verbatim with `RESULT: BLOCKED`. Do not edit that file.
- A second `createDescentMemoryService` call site (grep it) must pass the resolver too. If one exists outside `descent.module.ts`, report it with `RESULT: BLOCKED`.
- The first verify is vacuously true if the feed is empty at run time; Phase 5's fixture run is the non-vacuous proof. Do not create a run here.

## Phase 3 — Widget bodies inside their owning modules, and the strings
Depends on: Phase 2

```toml
[phase]
id = "3"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = [
  "src/modules/plan-runner/runState.ts",
  "src/modules/plan-runner/RunnerPanel.tsx",
  "src/modules/plan-runner/RunnerWidgetBody.tsx",
  "src/modules/plan-runner/index.ts",
  "src/modules/plan-runner/hooks/useRunnerRuns.ts",
  "src/modules/memory-intake/hooks/useApprovedMemories.ts",
  "src/modules/memory-intake/MemoryApprovedRow.tsx",
  "src/modules/memory-intake/MemoryWidgetBody.tsx",
  "src/modules/memory-intake/index.ts",
  "src/modules/i18n/locales",
]
forbidden = ["src/modules/plan-runner/RunCard.tsx", "src/modules/memory-intake/MemoryCandidateRow.tsx", "src/modules/memory-intake/context", "src/shared/ui"]
athena = [
  "A pinned run or memory is rendered twice (once pinned, once in its unpinned position) or dropped from the list",
  "The 20-row cap on approved memories is applied BEFORE pinning, so an older pinned memory disappears",
  "A row pins when sessionId is null and the item's session id is also null (null === null)",
  "useApprovedMemories runs a timer of its own, or a slower earlier approved answer overwrites a newer one (no token ordering)",
  "RunnerPanel's ordering changed while moving STATE_ORDER/byUrgencyThenNewest (not a pure move)",
  "A gutters.* key is missing or untranslated-empty in a locale, or gutters.open lost its {{name}} placeholder",
]

[[steps]]
kind = "edit"
path = "src/modules/plan-runner/runState.ts"
what = "Pure move per Interfaces: STATE_ORDER and byUrgencyThenNewest leave RunnerPanel.tsx (lines 24-30) and are exported from runState.ts with their comments, byte-identical bodies."
check = '''{ grep -c 'STATE_ORDER' src/modules/plan-runner/RunnerPanel.tsx | grep -v '^[1-9]' || true; }; grep -c 'STATE_ORDER' src/modules/plan-runner/runState.ts | sed 's/^[1-9][0-9]*$/moved/' '''
expect_re = "^0\\nmoved$"

[[steps]]
kind = "edit"
path = "src/modules/plan-runner/RunnerPanel.tsx"
what = "Import STATE_ORDER (only if still referenced) and byUrgencyThenNewest from '@/modules/plan-runner/runState'; delete the local definitions. No other change."
check = '''grep -c 'byUrgencyThenNewest' src/modules/plan-runner/RunnerPanel.tsx src/modules/plan-runner/runState.ts | tr '\n' ' ' '''
expect_re = "RunnerPanel.tsx:[1-9].*runState.ts:[1-9]"

[[steps]]
kind = "edit"
path = "src/modules/plan-runner/RunnerWidgetBody.tsx"
what = "Create RunnerWidgetBody per Interfaces and the build notes below: useRunnerRuns runs sorted by byUrgencyThenNewest, runs whose launched_by_session equals a non-null sessionId first with the pin marker, RunCard defaultOpen={false} with RunnerPanel's onDismiss rule, EmptyState on zero runs, data-testid runner-widget-run with data-run-id and data-pinned."
check = '''grep -c 'export function RunnerWidgetBody\|data-testid="runner-widget-run"\|data-session-pin\|defaultOpen={false}' src/modules/plan-runner/RunnerWidgetBody.tsx'''
expect = "4"

[[steps]]
kind = "edit"
path = "src/modules/plan-runner/index.ts"
what = "Add export { RunnerWidgetBody } from '@/modules/plan-runner/RunnerWidgetBody'; with a consumer comment naming chat-gutters. Rewrite the line-3 comment that gives the runner card one home to the new rule: the card has two homes, the Runner tab and the desktop chat gutter, beside the transcript and never over it. Delete the old wording outright."
check = '''grep -c "export { RunnerWidgetBody } from '@/modules/plan-runner/RunnerWidgetBody'" src/modules/plan-runner/index.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/plan-runner/hooks/useRunnerRuns.ts"
what = "Rewrite the docblock at lines 28-31 that says the runner card has one home, and the ruling it cites about nothing rendering over the transcript, to the new rule: the card renders in the Runner tab and in the desktop chat gutter, beside the transcript and never over it. Delete the old wording outright; no code change."
check = '''grep -c 'never over it' src/modules/plan-runner/hooks/useRunnerRuns.ts src/modules/plan-runner/index.ts | tr '\n' ' ' '''
expect_re = "useRunnerRuns.ts:[1-9].*index.ts:[1-9]"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/hooks/useApprovedMemories.ts"
what = "Create useApprovedMemories per Interfaces: reads api.descent.memory.approved() on mount and whenever useMemoryIntake().pending changes identity, with no timer of its own; copies MemoryIntakeContext.tsx's request-token ordering so only the newest request's answer is stored, and ignores answers after unmount."
check = '''grep -c 'export function useApprovedMemories\|api.descent.memory.approved()' src/modules/memory-intake/hooks/useApprovedMemories.ts; { grep -c 'setInterval\|setTimeout' src/modules/memory-intake/hooks/useApprovedMemories.ts || true; }'''
expect = "2\n0"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/MemoryApprovedRow.tsx"
what = "Create MemoryApprovedRow per Interfaces: a Card showing candidate.name (break-words, text-sm font-medium) over a muted text-xs line of project and the reviewedAt (fallback createdAt) date via toLocaleDateString, joined by ' · '. No buttons, no expand, no pin."
check = '''grep -c 'export function MemoryApprovedRow' src/modules/memory-intake/MemoryApprovedRow.tsx'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/MemoryWidgetBody.tsx"
what = "Create MemoryWidgetBody per Interfaces and the build notes below: pending section (MemoryCandidateRow with useMemoryReview verbs) then approved section (MemoryApprovedRow, pinned first then newest, cap 20 after pinning), each section pinning rows whose sessionId equals the non-null sessionId prop, testids memory-widget-pending / memory-widget-approved / memory-widget-row."
check = '''grep -c 'export function MemoryWidgetBody\|data-testid="memory-widget-pending"\|data-testid="memory-widget-approved"\|data-session-pin\|MemoryCandidateRow\b' src/modules/memory-intake/MemoryWidgetBody.tsx | sed 's/^[5-9]$/ok/;s/^[1-9][0-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/index.ts"
what = "Add export { MemoryWidgetBody } from '@/modules/memory-intake/MemoryWidgetBody'; with a consumer comment naming chat-gutters."
check = '''grep -c "export { MemoryWidgetBody } from '@/modules/memory-intake/MemoryWidgetBody'" src/modules/memory-intake/index.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/common.json"
what = "Add the gutters.* keys from Interfaces to en/common.json as a top-level gutters object, then the same keys translated into de es fr it ja ko ru tr zh-CN zh-TW common.json; keep {{name}} verbatim in gutters.open."
check = '''python3 -c '
import json
L="de en es fr it ja ko ru tr zh-CN zh-TW".split()
K="runner.title memory.title open collapse dragHint pin.label pin.title memory.pending memory.recent memory.recentEmpty memory.pendingEmpty".split()
def g(d,k):
    for part in k.split("."):
        d = d.get(part) if isinstance(d,dict) else None
    return d
ok=True
for l in L:
    d=json.load(open("src/modules/i18n/locales/%s/common.json" % l)).get("gutters",{})
    ok = ok and all(isinstance(g(d,k),str) and g(d,k).strip() for k in K) and "{{name}}" in (g(d,"open") or "")
print(ok)' '''
expect = "True"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = '''npm run typecheck >/dev/null 2>&1; echo tc=$?; npm run lint > /tmp/dsw-lint-3.txt 2>&1; echo lint=$?; { grep -c 'RunnerWidgetBody\|MemoryWidgetBody\|MemoryApprovedRow\|useApprovedMemories' /tmp/dsw-lint-3.txt || true; }'''
expect = "tc=0\nlint=0\n0"

[[verify]]
cmd = '''for m in plan-runner memory-intake; do grep -rn "from '\.\./\|from '\./" src/modules/$m/RunnerWidgetBody.tsx src/modules/$m/MemoryWidgetBody.tsx src/modules/$m/MemoryApprovedRow.tsx src/modules/$m/hooks/useApprovedMemories.ts 2>/dev/null; done | wc -l'''
expect = "0"

[[verify]]
cmd = '''npm run typecheck >/dev/null 2>&1; echo exit=$?'''
expect = "exit=0"
```

**What to build.** Two presentational bodies, each inside the module that owns its data, so the gutter frame (Phase 4) imports two barrel symbols and never reaches into either module.

`RunnerWidgetBody({ sessionId })`:
- `const { runs, carriedIds } = useRunnerRuns();` imported from `@/modules/plan-runner/hooks/useRunnerRuns`, which is inside its own module. `runs` is already filtered of dismissed runs; `carriedIds` is only for `dismissRun`.
- `ordered = [...runs].sort(byUrgencyThenNewest)`. Split it with one stable pass into `mine` (`sessionId !== null && run.launched_by_session === sessionId`) and `rest`; render `[...mine, ...rest]`. Derive both with `useMemo`; add no state.
- Zero runs: `<EmptyState icon={ActivityIcon} title={t('runner.empty')} />`.
- The list: `<ul className="flex min-w-0 flex-col gap-3">`. Each run is `<li data-testid="runner-widget-run" data-run-id={run.run_id} data-pinned={String(isMine)} className="flex min-w-0 flex-col gap-1">`. It holds the pin marker (Interfaces) when mine, then `<RunCard run={run} defaultOpen={false} onDismiss={…} />`. Copy `onDismiss` verbatim from `RunnerPanel.tsx:91-95`.
- `const { t } = useTranslation();`, with no namespace argument (`RunCard.tsx:87` is the pattern).

`MemoryWidgetBody({ sessionId })`:
- `const { pending } = useMemoryIntake();`, `const approved = useApprovedMemories();`, `const { review, refusals, busyId } = useMemoryReview();`. Copy `onReview` from `MemoryIntakePanel.tsx` exactly as that panel defines it.
- `isMine(c) = sessionId !== null && c.sessionId === sessionId`. Both ids arrive already resolved to app ids by the server (Phase 2), so a plain equality is the whole match.
- **Pending section.** A heading `<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('gutters.memory.pending')}</h3>`. Branches, copying `MemoryIntakePanel.tsx:73-85` for their shape:
  - `pending === null` → `<Spinner />`;
  - `reachable === false` → `<EmptyState icon={PlugZapIcon} title={t('memory.unreachable')} />`;
  - zero candidates → `<p className="text-xs text-muted-foreground">{t('gutters.memory.pendingEmpty')}</p>`;
  - otherwise `<ul data-testid="memory-widget-pending" className="flex min-w-0 flex-col gap-2">`.
  - Its rows are mine-first (stable), in Descent's order. Each row is `<li data-testid="memory-widget-row" data-candidate-id={c.id} data-pinned={String(isMine(c))} className="flex min-w-0 flex-col gap-1">`, holding the pin marker when mine, then `<ul className="contents"><MemoryCandidateRow candidate={c} refusal={refusals[c.id] ?? c.refusal} busy={busyId !== null} onReview={onReview} /></ul>`. `MemoryCandidateRow` renders its own `<li>`, so the inner `ul` keeps the HTML valid.
- **Approved section.** Heading `t('gutters.memory.recent')`, same classes. Branches: `approved === null` → `<Spinner />`; `reachable === false` → `<p className="text-xs text-muted-foreground">{t('memory.unreachable')}</p>`; zero → `t('gutters.memory.recentEmpty')`.
  - Otherwise sort a copy: mine first, then by `(reviewedAt ?? createdAt ?? '')` descending (ISO strings compare lexically). THEN take the first 20.
  - Render `<ul data-testid="memory-widget-approved" className="flex min-w-0 flex-col gap-2">`, with rows `<li data-testid="memory-widget-row" data-candidate-id data-pinned …>` holding the pin marker when mine, then `<MemoryApprovedRow candidate={c} />`.
- Sections sit in `<div className="flex min-w-0 flex-col gap-4">`. No `ScrollArea` here; the frame scrolls.

**Sirens.**
- You will see `useRunnerRuns().pinned`. That "pinned" means "newest live run" (`useRunnerRuns.ts:21-26`) and has nothing to do with this session. Do not use it. Name nothing in this plan `pinned` except the `data-pinned` attribute.
- You will want to add a `compact` or `pinned` prop to `RunCard` or `MemoryCandidateRow`. Both are forbidden in this phase; compose around them.
- You will want to mount `RunnerFeed` or `MemoryIntakeProvider` again. Both are already mounted once in `src/App.tsx`; a second mount double-polls.
- `docs/memory-intake.md` says strings are English-only. The operator's instruction for this plan is every locale; write all 11. Prometheus reconciles the doc.
- If `MemoryIntakePanel.tsx`'s `onReview` is not a simple wrapper you can copy, report its lines verbatim with `RESULT: BLOCKED`.

## Phase 4 — The gutters: layout, slots, drag and drop, placement, crash boundary, the mount
Depends on: Phase 2, Phase 3

```toml
[phase]
id = "4"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = [
  "src/modules/chat-gutters",
  "src/shared/userSettings.ts",
  "src/modules/project-workspace/WorkspaceMain.tsx",
]
forbidden = ["src/shared/ui", "src/modules/widgets", "src/modules/plan-runner/RunCard.tsx", "src/modules/memory-intake/MemoryCandidateRow.tsx"]
athena = [
  "The ResizeObserver sets state on every resize frame (regionWidth kept in state) instead of only when wide flips",
  "Crossing the 1500px threshold (or toggling the sidebar) unmounts and remounts ChatInterface, losing the composer draft and scroll position",
  "useSyncExternalStore getSnapshot returns a fresh parsed object each call, causing an infinite render loop or a console 'getSnapshot should be cached' error",
  "An invalid or partial chatGutters preference (both widgets in one slot, unknown slot, missing open) crashes or renders a widget twice instead of falling back to the defaults",
  "Dropping a widget onto the slot the other widget holds overwrites instead of swapping, so one widget vanishes",
  "A widget body is rendered outside the boundary prop, so one widget's crash blanks the chat tab or the other widget",
  "Gutters render on mobile (isMobile true) or overlay the chat column instead of sitting in their own grid cells",
]

[[steps]]
kind = "edit"
path = "src/shared/userSettings.ts"
what = "Per Interfaces: UserPreferences gains chatGutters: unknown with a one-line comment naming useGutterPlacements; LEGACY_STORAGE_KEYS gains chatGutters: null."
check = '''grep -c 'chatGutters' src/shared/userSettings.ts'''
expect = "2"

[[steps]]
kind = "edit"
path = "src/modules/chat-gutters/hooks/useGutterPlacements.ts"
what = "Create useGutterPlacements per Interfaces and the build notes: memoized parse of readUserPreference('chatGutters') into ChatGutterPlacements with the defaults on anything invalid, moveWidget swapping on an occupied slot, toggleWidget flipping open, both writing writeUserPreference('chatGutters', next)."
check = '''grep -c "export function useGutterPlacements\|useSyncExternalStore\|writeUserPreference('chatGutters'" src/modules/chat-gutters/hooks/useGutterPlacements.ts'''
expect_re = "^[3-9]"

[[steps]]
kind = "edit"
path = "src/modules/chat-gutters/GutterWidgetFrame.tsx"
what = "Create GutterWidgetFrame per Interfaces and the build notes: collapsed = a draggable wrapper holding the gutter-widget-tab Button; open = a Card filling the slot with a draggable gutter-widget-header CardHeader, a collapse icon Button, and CardContent holding a ScrollArea around children."
check = '''grep -c 'export function GutterWidgetFrame\|data-testid="gutter-widget"\|data-testid="gutter-widget-tab"\|data-testid="gutter-widget-header"\|draggable' src/modules/chat-gutters/GutterWidgetFrame.tsx | sed 's/^[5-9]$/ok/;s/^[1-9][0-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/chat-gutters/GutterSlot.tsx"
what = "Create GutterSlot per Interfaces and the build notes: a drop target that takes the column's leftover height with data-testid gutter-slot, data-slot, data-widget; accepts a drop whenever a drag is in progress; dashed border only while dragging a widget other than its own; bottom slots align content to the bottom."
check = '''grep -c 'export function GutterSlot\|data-testid="gutter-slot"\|onDragOver\|onDrop' src/modules/chat-gutters/GutterSlot.tsx'''
expect = "4"

[[steps]]
kind = "edit"
path = "src/modules/chat-gutters/ChatGutterLayout.tsx"
what = "Create ChatGutterLayout per Interfaces and the build notes: ResizeObserver-measured region, wide = enabled && width >= MIN_REGION_PX, chat cell always the first child, two asides with two GutterSlots each only when wide, rendering RunnerWidgetBody / MemoryWidgetBody (sessionId passed straight through) through GutterWidgetFrame, each body wrapped in the boundary prop; only wide is kept in state."
check = '''grep -c 'export function ChatGutterLayout\|MIN_REGION_PX\|ResizeObserver\|data-testid="chat-gutter-chat"\|RunnerWidgetBody\|MemoryWidgetBody' src/modules/chat-gutters/ChatGutterLayout.tsx | sed 's/^[6-9]$/ok/;s/^[1-9][0-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/chat-gutters/index.ts"
what = "Create the barrel exporting only ChatGutterLayout, per Interfaces."
check = '''grep -c 'export' src/modules/chat-gutters/index.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/project-workspace/WorkspaceMain.tsx"
what = "Import { ChatGutterLayout } from '@/modules/chat-gutters' and wrap <ChatInterface … /> (lines 311-330) in <ChatGutterLayout enabled={!isMobile} sessionId={selectedSession?.id ?? null} boundary={WorkspaceErrorBoundary}>, inside the existing WorkspaceErrorBoundary. Nothing else changes."
check = '''grep -c "from '@/modules/chat-gutters'\|<ChatGutterLayout enabled={!isMobile}\|boundary={WorkspaceErrorBoundary}" src/modules/project-workspace/WorkspaceMain.tsx'''
expect = "3"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = '''npm run typecheck >/dev/null 2>&1; echo tc=$?; npm run lint > /tmp/dsw-lint-4.txt 2>&1; echo lint=$?; { grep -c 'chat-gutters' /tmp/dsw-lint-4.txt || true; }'''
expect = "tc=0\nlint=0\n0"

[[verify]]
cmd = '''for f in src/modules/chat-gutters/ChatGutterLayout.tsx src/modules/chat-gutters/GutterSlot.tsx src/modules/chat-gutters/GutterWidgetFrame.tsx src/modules/chat-gutters/hooks/useGutterPlacements.ts src/modules/project-workspace/WorkspaceMain.tsx; do curl -s -o /dev/null -w '%{http_code} ' "http://127.0.0.1:5183/$f"; done'''
expect = "200 200 200 200 200"

[[verify]]
cmd = '''grep -rn "from '\.\./\|from '\./\|interface " src/modules/chat-gutters | wc -l; wc -l src/modules/chat-gutters/*.tsx src/modules/chat-gutters/hooks/*.ts | awk '$2 != "total" && $1 > 250 {print "oversize " $2}' '''
expect = "0"
```

**What to build.** The frame, knowing nothing about runs or memories beyond the two barrel bodies, `useRunnerRuns().count` and `useMemoryIntake().pendingCount`. Every file stays under 250 lines.

`useGutterPlacements()`:
- `const raw = useSyncExternalStore(subscribeToUserPreferences, () => readUserPreference<unknown>('chatGutters', null));`. Then `const placements = useMemo(() => parsePlacements(raw), [raw]);`.
- ⚠ `readUserPreference` may hand back a fresh object on each call. Copy the identity-memo pattern `src/modules/plan-runner/dismissedRuns.ts:62-73` uses (`readDismissedEndings` memoized by identity of the raw preference) if `useSyncExternalStore` warns or loops. The phase's own Athena item names this.
- `parsePlacements` (file-local) returns the defaults from Interfaces unless `raw` is an object whose `runner` and `memory` each have a `slot` among the four ids, a boolean `open`, and different slots.
- `moveWidget(w, slot)`: when the other widget holds `slot`, the other takes `w`'s old slot; then write the whole object.
- `toggleWidget(w)`: flips `open` and writes.

`GutterWidgetFrame`:
- **Collapsed.** `<div data-testid="gutter-widget" data-widget={widget} data-open="false" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', widget); e.dataTransfer.effectAllowed = 'move'; onDragStart(widget); }} onDragEnd={onDragEnd}>`.
  - It wraps `<Button data-testid="gutter-widget-tab" variant="ghost" className="w-full justify-start gap-2 border border-border" onClick={onToggle} aria-expanded={false} aria-label={t('gutters.open', { name: title })} title={t('gutters.dragHint')}>`.
  - Inside the button: `<Icon className="h-4 w-4" aria-hidden="true" />`, `<span className="truncate">{title}</span>`, and `{count > 0 ? <Badge tone="info">{count}</Badge> : null}`.
- **Open.** `<Card data-testid="gutter-widget" data-widget={widget} data-open="true" className="flex h-full min-h-0 flex-col">`.
  - `<CardHeader data-testid="gutter-widget-header" draggable onDragStart={…same…} onDragEnd={onDragEnd} title={t('gutters.dragHint')} className="flex cursor-grab flex-row items-center gap-2 p-3">`, holding: the icon; `<CardTitle className="min-w-0 flex-1 truncate text-sm">{title}</CardTitle>`; the count Badge; and `<Button size="icon" variant="ghost" onClick={onToggle} aria-expanded={true} aria-label={t('gutters.collapse')}><MinusIcon aria-hidden="true" /></Button>`.
  - Then `<CardContent className="min-h-0 flex-1 p-0"><ScrollArea className="h-full"><div className="p-3">{children}</div></ScrollArea></CardContent>`.
- If `CardHeader` does not accept `draggable` or `data-*` (a props type narrower than HTML attributes), put a plain `div` with those attributes and the same classes inside `CardHeader`. That is a reversible default, not a divergence.

`GutterSlot`:
- `<div data-testid="gutter-slot" data-slot={slot} data-widget={widget ?? ''}>`.
- Class: `flex min-h-0 flex-col`, plus `flex-1` when it holds an open widget, or when it holds nothing and a drag is over it (else `flex-none`), plus `min-h-10` when it holds nothing, plus `justify-end` for the two bottom slots (else `justify-start`), plus `rounded-lg border-2 border-dashed border-border` only when `dragging !== null && dragging !== widget`.
- `onDragOver={(e) => { if (dragging === null) return; e.preventDefault(); onHoverSlot(slot); }}` — the hover is what opens an empty corner, so it is set from the element the pointer is actually over and never from the drag alone.
- `onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHoverSlot(null); }}` — `dragleave` also fires when the pointer crosses a child on its way out, so only a departure from the slot's own box closes it.
- `onDrop={(e) => { e.preventDefault(); if (dragging !== null) onDropWidget(dragging, slot); }}`.
- Children: `widget === null ? null : renderWidget(widget)`.

`ChatGutterLayout`:
- **State.** Three pieces, each with a comment: `wide: boolean` (initially `false`), `dragging: GutterWidgetId | null` and `hovered: GutterSlotId | null`. No width is kept in state. A `ResizeObserver` on the root ref computes `next = enabled && entry.contentRect.width >= MIN_REGION_PX` and calls `setWide((prev) => (prev === next ? prev : next))`, so React re-renders only when the answer flips. When `enabled` changes, the effect tears the observer down and builds a new one, and a fresh observer reports the region's current size as its first delivery — the same path as a resize, so there is no second measurement to keep in step. Disconnect on unmount. A width of 0 is skipped rather than answered: the workspace hides the chat tab with `hidden` instead of unmounting it, so this region measures 0 while another tab is open, and answering "no gutters" there would tear both widgets down — with the scroll position and expanded cards inside them — on a trip to the Files tab. `endDrag()` clears both `dragging` and `hovered`, and is wired to `onDragEnd` and to every drop, so no corner is left standing open.
- **Root.** `<div ref={rootRef} className="flex h-full min-h-0 justify-center">`, holding one grid `div` — `<div data-testid={wide ? 'chat-gutter-grid' : undefined} className={cn('grid h-full min-h-0 w-full max-w-[1860px] grid-cols-[minmax(0,1fr)_minmax(0,868px)_minmax(0,1fr)]', wide && 'gap-4')}>` — which holds the chat, and (when wide only) the two asides. THE GRID IS UNCONDITIONAL and the chat cell's classes do not vary with the mode, so the chat's parent is the same element at every width and the chat is never remounted across the threshold; the mode adds and removes the asides and the gap, and nothing else. The wrapper centres the capped group; the grid's middle track IS `CHAT_COLUMN_PX`, its `1fr` sides are the gutters that `max-w-[1860px]` stops at 480px, and `gap-4` is `GUTTER_GAP_PX` — and that gap is the one thing that must be gated, because it is charged between the outer tracks even when they are empty and would take `GUTTER_GAP_PX` off the chat column on a window too narrow for gutters. Say so in a comment beside the constants.
- **Children, in this order.**
  1. ALWAYS first, in both modes: `<div data-testid="chat-gutter-chat" className="col-start-2 row-start-1 h-full min-h-0 min-w-0">{children}</div>`. `minmax(0, 868px)` is what makes this cell the transcript's own column at every width and lets it shrink below 868 without overflowing its track.
  2. When wide only: `<aside data-testid="chat-gutter-left" className="col-start-1 row-start-1 flex h-full min-h-0 flex-col gap-4 py-3">`, holding GutterSlots `top-left` and `bottom-left`.
  3. When wide only: `<aside data-testid="chat-gutter-right" className="col-start-3 row-start-1 flex h-full min-h-0 flex-col gap-4 py-3">`, holding `top-right` and `bottom-right`.
- **Which widget is in a slot.** `(['runner', 'memory'] as const).find((w) => placements[w].slot === slot) ?? null`.
- **Boundary.** `const Boundary = boundary;` (a capitalised local, so JSX treats it as a component). Each body gets its OWN `<Boundary>`, inside its frame, so one crash leaves the chat and the other widget standing.
- **`renderWidget`.** Runner is `GutterWidgetFrame` with `title={t('gutters.runner.title')}`, `count={runnerCount}`, `icon={ActivityIcon}`, children `<Boundary><RunnerWidgetBody sessionId={sessionId} /></Boundary>`. Memory uses `t('gutters.memory.title')`, `pendingCount`, `BrainIcon` and `<Boundary><MemoryWidgetBody sessionId={sessionId} /></Boundary>`. Both pass `open={placements[w].open}`, `onToggle={() => toggleWidget(w)}`, `onDragStart={setDragging}` and `onDragEnd={endDrag}`. Neither frame is told which slot it is in — the slot draws it. `dropWidget` is `(w, s) => { moveWidget(w, s); endDrag(); }`, and `hoverSlot` is `(s) => setHovered((prev) => (prev === s ? prev : s))`, so only a change from one slot to another reaches state while `dragover` fires continuously.

**Sirens.**
- You will want to render the chat cell conditionally, or swap the root element type between modes. Do not. The chat cell is the same first `div` child in both modes, so React keeps `ChatInterface` mounted when the width crosses the threshold. Phase 5 types a draft, resizes, and requires the draft to survive.
- You will see `ChatInterface.tsx`, `ChatMessagesPane.tsx` and `ChatComposer.tsx` with their `max-w-[54.25rem]` column and uncommitted edits from other sessions. They are not in the manifest; the gutters wrap the chat from outside. Do not narrow or restyle the chat.
- You will want a viewport media query. Do not: the region is measured, because the sidebar and its collapse change the chat's width at one viewport.
- You will want a keyboard "Move to…" menu or a settings toggle for the gutters. Out of scope (Exclusions). Build only the drag and the tab.
- Never name anything in this module `Widget*` without the `Gutter` prefix, and never import from `@/modules/widgets` (the HTML fence renderer, a different concept).
- If `WorkspaceErrorBoundary` is not assignable to `ComponentType<{ children: ReactNode }>` (a required prop other than `children`), report the typecheck error verbatim with `RESULT: BLOCKED`. Do not change that component and do not write a second boundary.

## Phase 5 — Proof in the real app: wide gutters, both pins, drag persistence, no remount, narrow and mobile unchanged
Depends on: Phase 1, Phase 2, Phase 3, Phase 4

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "opus"
code_change = false
doc_sweep = "foreground"
manifest = [".verify/probe-side-widgets.mjs", ".verify/shots"]
forbidden = ["src/modules/chat-gutters", "src/modules/plan-runner", "src/modules/memory-intake", "server/modules"]
athena = [
  "The probe passes against an empty feed because the fixture run was never picked up and the pin gate reads zero rows as success",
  "The fixture run directory or plan file is left behind after a failure",
  "The drag gate asserts the DOM before the preference write lands and never reloads, so persistence is unproven",
  "The probe leaves the widgets' open state, placement or the composer draft changed from what it found",
]

[[steps]]
kind = "edit"
path = ".verify/probe-side-widgets.mjs"
what = "Write the probe exactly as the build notes below specify: fixture run with launched_by_session, gates G1-G6, [PASS]/[FAIL] lines, final line SIDE-WIDGETS PASS or SIDE-WIDGETS FAIL, cleanup and state restore in finally."
check = '''node --check .verify/probe-side-widgets.mjs && grep -c 'G1\|G2\|G3\|G4\|G5\|G6' .verify/probe-side-widgets.mjs | sed 's/^[6-9]$/ok/;s/^[1-9][0-9]\+$/ok/' '''
expect = "ok"

[[steps]]
kind = "run"
cmd = "node .verify/probe-side-widgets.mjs"
check = '''node .verify/probe-side-widgets.mjs 2>&1 | tail -1'''
expect = "SIDE-WIDGETS PASS"
timeout_s = 420

[[verify]]
cmd = '''node .verify/probe-side-widgets.mjs 2>&1 | grep -c '^\[PASS\] G[1-6]' '''
expect = "6"
timeout_s = 420

[[verify]]
cmd = '''{ ls ~/.claude/state/runner | grep -c '^side-widgets-probe-' || true; }; { ls ~/.claude/state/runner-fixtures 2>/dev/null | grep -c '^side-widgets-probe' || true; }'''
expect = "0\n0"
```

**What to build.** One Node ESM script, `.verify/probe-side-widgets.mjs`. The directory is git-ignored, and its harness conventions are in `docs/verification.md`. It proves the Goal against the running dev server (`:5183` UI, `:3011` API) and live Descent data. It creates exactly one thing, a fixture run, and removes it in `finally`.

Header and fixture:
- `import pw from '/opt/shadow-connector/node_modules/playwright/index.js'; const { chromium } = pw;`. Use `node:fs`, `node:path` and `node:os`.
- Constants: `APP_URL = 'http://127.0.0.1:5183'`, `API_URL = 'http://127.0.0.1:3011'`, `SESSION = '937565cc-0ede-42d5-853c-8728f492e3f0'`. That is a CloudCLI session (project `/opt/shadow-connector`) whose app id equals its Claude transcript id; approved Descent memories mc-26 and mc-27 carry it (measured 2026-09-15).
- `RUN_ID = 'side-widgets-probe-' + Date.now()`. `RUN_DIR = ~/.claude/state/runner/RUN_ID`. `PLAN = ~/.claude/state/runner-fixtures/side-widgets-probe.plan.md`. The fixture root keeps the run out of every push (`server/modules/plan-runner/runner-endings.service.ts:71`).
- Write `PLAN` (`# Side widgets probe`, parent directory created). Write `RUN_DIR/progress.json`: `{ run_id, plan_path: PLAN, plan_title: 'Side widgets probe', status: 'running', started_at: nowS, heartbeat_at: nowS, pid: null, position: null, phases: [], spawns: 0, max_spawns: 1, cost_usd: 0, tokens: 0, line: '' }`, epoch SECONDS. Write `RUN_DIR/run.json`: `{ run_id, plan_path: PLAN, status: 'running', stopped_at: null, launched_by_session: SESSION }`. No `receipt.json` and no lock, so the run classifies `live` (heartbeat under 900 s) and the watchdog never sees it.
- Rewrite `heartbeat_at` every 60 s on a timer cleared in `finally`.

Sign-in and API:
- The form flow of `.verify/empty-rows.mjs` lines 11-17: `#username` `verve`, `#password` `verve-dev-2026`, submit, wait for `localStorage['auth-token']`.
- API reads go through the page's token: `page.evaluate` → `fetch(API_URL + path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('auth-token') } })`.

Gates. Each prints `[PASS] Gn <what>` or `[FAIL] Gn <reason>`:
- **G1 — wide gutters, no overlap.** Context viewport 2560×1440. `goto(APP_URL + '/session/' + SESSION)`, wait up to 30 s for `[data-testid=chat-gutter-grid]`. Bounding boxes: `chat-gutter-left.right <= chat-gutter-chat.left`, `chat-gutter-right.left >= chat-gutter-chat.right`, `chat-gutter-chat.width === 868` (the transcript's own column — not a wider `1fr` cell), the `.chat-messages-pane` box equal to the chat cell's (the scroll pane and its scrollbar hug that column), each gutter between 300 and 480 px wide standing exactly the 16 px grid gap off the chat, and exactly 4 `[data-testid=gutter-slot]`. Before any gate changes state, record each widget's `data-open` and `closest('[data-testid=gutter-slot]').dataset.slot`. Screenshot `.verify/shots/dsw-wide.png` after G3.
- **G2 — the run this session launched is pinned first.**
  - Open the runner widget if its `data-open` is `false` by clicking its `gutter-widget-tab`.
  - Wait up to 45 s for `[data-testid=runner-widget-run][data-run-id="<RUN_ID>"]`. Pass iff all of these hold: the FIRST `runner-widget-run` has that id, `data-pinned="true"` and a `[data-session-pin]` inside it.
  - Also, every row with `data-pinned="true"` names a run whose `launched_by_session` in `GET /api/plan-runner/runs` equals SESSION; and at least one row has `data-pinned="false"`, or the feed holds only the fixture.
- **G3 — the memories this session proposed are pinned first.**
  - `mine` = approved candidates from `GET /api/descent/memory?status=approved` with `sessionId === SESSION`. FAIL if `mine` is empty.
  - Open the memory widget. Wait for `[data-testid=memory-widget-approved]`. Pass iff the first `mine.length` rows' `data-candidate-id` set equals `mine`'s id set, each has `data-pinned="true"` and a `[data-session-pin]`, and the next row, when there is one, has `data-pinned="false"`.
- **G4 — drag persists.**
  - `from` = the runner's current slot. `to` = `'bottom-right'`, or `'bottom-left'` when `from` is `'bottom-right'`. `other` = the memory widget's slot.
  - `page.dragAndDrop('[data-testid=gutter-widget][data-widget=runner] [data-testid=gutter-widget-header], [data-testid=gutter-widget][data-widget=runner][data-open=false]', '[data-testid=gutter-slot][data-slot="' + to + '"]')`.
  - Assert the runner sits in `to`, and when `other === to` the memory widget now sits in `from` (a swap).
  - Wait 1500 ms (the preference write debounces 400 ms), `page.reload()`, wait for the grid, assert the same placement again.
  - Then drag the runner back to `from`, assert, and wait 1500 ms.
- **G5 — crossing the width keeps the chat mounted (node identity, then the draft).** At 2560×1440 with the grid present:
  - Tag the node: `page.evaluate(() => { document.querySelector('[data-testid=chat-gutter-chat]').firstElementChild.dataset.probeTag = 'dsw-g5'; })`.
  - `page.setViewportSize({ width: 1280, height: 900 })`. Wait up to 10 s until `[data-testid=chat-gutter-grid]` is absent (assert absent).
  - Assert A0: at that width the chat cell is still 868 px wide and the `.chat-messages-pane` box still equals it. The grid is drawn below the threshold too, so the column — and the scrollbar on it — is the transcript's own on a laptop, not just on a 1789 px window.
  - Assert A1: `document.querySelector('[data-testid=chat-gutter-chat]').firstElementChild.dataset.probeTag === 'dsw-g5'`. The same element survived the collapse. Screenshot `.verify/shots/dsw-narrow.png`.
  - Fill the first `textarea` inside `[data-testid=chat-gutter-chat]` with `gutter-draft-probe`. Resize to 2560×1440 and wait for the grid.
  - Assert A2: the chat cell's `firstElementChild` still carries `data-probe-tag="dsw-g5"`.
  - Assert A3: that textarea's value is still `gutter-draft-probe`.
  - Pass iff A1, A2 and A3 all hold; the `[FAIL]` line names which one failed. Then fill the textarea with `''` and delete the tag.
- **G6 — mobile unchanged.** A new context with `viewport: { width: 390, height: 844 }, isMobile: true`. Sign in, go to the session, wait 5 s. Pass iff `[data-testid=chat-gutter-grid]` and `[data-testid=gutter-slot]` both count 0. Screenshot `.verify/shots/dsw-mobile.png`.

`finally`, always:
- Restore each widget's recorded `data-open` by clicking its tab or collapse button where it differs, then wait 1500 ms.
- Clear the heartbeat timer. `fs.rmSync(RUN_DIR, { recursive: true, force: true })`. Remove `PLAN`, and remove `runner-fixtures` if it is now empty and the probe created it. Close the browser.

Last line: `SIDE-WIDGETS PASS` when all six passed, else `SIDE-WIDGETS FAIL`, with `process.exitCode = 1`. A thrown error prints `[FAIL] <gate in progress> <message>` and still ends on `SIDE-WIDGETS FAIL`.

**Sirens.**
- A gate fails because the product is wrong (a pin missing, a remount, an overlap). Do not edit product code; it is forbidden in this phase. Report the failing `[FAIL]` lines and the screenshot paths verbatim with `RESULT: BLOCKED`. The runner's verify-path fix-pass and replan handle the route.
- G1 times out because `/session/937565cc-…` renders no workspace for the `verve` user. Report that verbatim with `RESULT: BLOCKED`. Do not swap SESSION for another id: it is the only session measured that is both a CloudCLI row and the author of approved memories.
- You will want `page.route` to stub the runs or memory APIs. Do not; this probe reads the real ones. The fixture run is the only synthetic thing.
- Never write `receipt.json` or a lock file, and never touch another run directory.
- Never approve, reject or otherwise write a Descent memory. G3 is read-only.

## Goal

*Goal:* on the chat tab, when the chat region is at least 1500px wide and not mobile, Runner and Memory widgets live in four draggable gutter slots beside the chat without overlapping it. Placement and open state persist. The runs and memories the open chat created are pinned first with a pin marker. Narrower and mobile layouts are unchanged. *Verify by:* Phase 5's `node .verify/probe-side-widgets.mjs` ending `SIDE-WIDGETS PASS` with six `[PASS]` gates, and its fixture removed.

## Decisions

Each default is chosen now; its reversal is written beside it.

- **Threshold.** The chat REGION is measured with a `ResizeObserver`, not the viewport, because the sidebar changes the chat's width at a single viewport. The minimum is 1500px: the 868px column plus two 300px gutters plus two 16px gaps. Reversal: change `GUTTER_MIN_PX` and `MIN_REGION_PX` in `ChatGutterLayout.tsx`.
- **Proportions.** The middle track is the transcript's own 868px column and the gutters are the `1fr` tracks beside it, so the spare width goes to the widgets and the scroll pane ends where the transcript does. The three tracks are drawn at EVERY width, not only above the threshold: the threshold is the question "is there room for the widgets?", and the chat column is the chat's own column whether the answer is yes or no — gating the grid on the threshold left the pane spanning the dead band on every laptop narrower than 1789 viewport, which is the complaint this answers. The group is capped at 1860px — 480px per gutter — and centred, rather than stretched edge to edge: past 480px a run list or a memory card is a list spread across a screen it does not fill, so the surplus sits outside the group instead of inside a widget. Reversal: the column list, `wide && 'gap-4'` and `max-w-[1860px]` in `ChatGutterLayout.tsx`.
- **Storage.** Placement is the server-synced user preference `chatGutters` (`src/shared/userSettings.ts`), not bare localStorage, following the `planRunner` key's precedent. It follows the user across devices. Reversal: read and write a localStorage key in `useGutterPlacements.ts` alone.
- **Default placement.** Runner top-left, Memory top-right, both collapsed. Reversal: the defaults object in `useGutterPlacements.ts`.
- **Slot heights.** An open widget's slot takes the column's leftover height, so a widget alone on its side takes everything the column has apart from an empty corner's landing pad, and two open widgets on one side share it evenly; a collapsed tab keeps its own height. An empty slot is drawn one tab tall (40px) as a landing pad and keeps that height at all times — a corner with no pixels of its own is a corner the pointer can never enter, so it could neither open nor take a drop. What it costs is the band under a lone open widget. Reversal: the grow rule and `min-h-10` in `GutterSlot.tsx`.
- **Only the corner under the pointer opens.** While a drag is in flight, the empty slot the pointer is over grows to fill and gets the dashed outline; every other slot keeps its height. Growing them all in flow halved the open widgets on BOTH sides — including the one across the chat, which re-laid-out under a pointer that never came near it and lost its scroll position. Reversal: the `hovered` state and the `grows` line in `GutterSlot.tsx`.
- **Tab position.** A collapsed tab sits at the top edge of a top slot and the bottom edge of a bottom slot. Reversal: `justify-*` in `GutterSlot.tsx`.
- **Occupied slot.** Dropping onto the other widget's slot swaps the two; a slot never holds two widgets.
- **Run card density.** The compact run view is the existing `RunCard` with phases folded (`defaultOpen={false}`). `RunCard` is width-safe at 280-320px (every row wraps; runner-ui scout), so no new variant or prop is added (doctrine §8). Reversal: pass `defaultOpen` true.
- **One clock, one verb.** `useApprovedMemories` owns no timer. It re-reads when the pending queue changes identity (the provider's 60 s poll, visibility and every File/Discard), using the provider's token ordering. The service has one `list(status)` verb, and `pending()` is its one-line delegate.
- **Memory list.** Pending uses `MemoryCandidateRow` unchanged, verbs included. Approved uses a new read-only `MemoryApprovedRow`: Descent's list, pinned first, then newest by `reviewedAt`, capped at 20 AFTER pinning. Rejected memories are not shown. Reversal: the cap constant in `MemoryWidgetBody.tsx`.
- **Session ids for memories.** Descent's lean list gains `session_id`: two lines, the column already exists, one request. N full reads would be a request per row every poll. The approved read is `?status=approved` on the existing CloudCLI route; Descent's handler already passes `status` through.
- **"This session".** The match is the open chat's app session id (`selectedSession.id`; the URL always holds the app id, `useProjectsState.ts:856`) against ids the server has already resolved to app ids. `sessionsDb.resolveAppSessionId` tries the provider id, then a superseded provider id, then the app id, and otherwise returns the id unchanged. The resolver lives server-side because the browser never learns provider ids (`docs/architecture/README.md` invariant 1), and because `/provider-id` misses transcript ids an edit superseded. Runs resolve in `plan-runner.module.ts`, while `runner-state.service.ts` stays a pure disk reader. Memories resolve through the resolver `descent.module.ts` injects. Reversal: the two wiring sites.
- **Pin marker.** A composition: lucide `PinIcon` plus `Badge tone="info"` "This session", written in the two body files. It is not a library component; promote it on a third copy (doctrine §2).
- **Drag and drop.** Native HTML5, with no library. There is no keyboard move and no settings toggle (Exclusions).
- **Module name.** `chat-gutters`, so it never collides with `src/modules/widgets` (the sandboxed HTML fence renderer).

## Waves

Wave 1: Phase 1 — Descent lean list (independent of CloudCLI code, but Phase 2's verify reads it)
Wave 2: Phase 2 — contracts
Wave 3: Phase 3 — bodies (consumes Phase 2's types and api)
Wave 4: Phase 4 — gutters (consumes Phase 3's barrel exports and Phase 2's types)
Wave 5: Phase 5 — proof

Every phase consumes an earlier one's output, so the plan stays one file walked in order; no split.

## Edge cases

- Descent unreachable. Pending and approved each show their own unreachable line; the Runner widget is unaffected. Nothing throws.
- A memory with `sessionId` null, or an id like `phase2-intake-lane-build` that is no chat. It is never pinned.
- A run launched from a chat whose transcript id an edit later superseded. The server resolves it to the app id through `superseded_provider_sessions`, so it pins.
- No chat open (`selectedSession` null). `sessionId` is null and nothing pins.
- An unknown transcript id (a chat outside CloudCLI). The resolver returns it unchanged; it matches no URL and never pins.
- A widget body throws. Its own boundary shows the error inside that slot; the chat and the other widget keep rendering.
- A run whose `run.json` is missing or unreadable, or whose `launched_by_session` is not a non-empty string. `launched_by_session: null`, never pinned.
- A corrupt `chatGutters` preference (unknown slot, both widgets in one slot, a missing `open`). The defaults render; the next move or toggle overwrites it.
- The chat tab hidden (another tab active). The region measures 0, the gutters unmount and the bodies stop polling; returning remeasures.
- The sidebar toggled at a wide viewport. The region crosses the threshold and the gutters appear or disappear; the chat cell stays mounted (G5).
- Dropping outside any slot. `onDragEnd` clears `dragging` and nothing moves.
- More than 20 approved memories, with a pinned one older than the 20th. It still shows first, because the cap applies after pinning.

## Exclusions

- A files widget: declined by the operator in his answers.
- A keyboard or menu alternative to drag, and a setting to turn the gutters off. Not requested; either is a follow-up card.
- Pinning or showing rejected memories.
- A tap target in ntfy pushes that opens the launching chat. `launched_by_session` is a Claude uuid, and the push goes to every user.
- Committing or pushing this work. Nothing in the run depends on it.

## Doctrine citations

- `~/.claude/design/DESIGN_DOCTRINE.md` §2 (compose-or-component: the pin and the gutter are compositions), §3 (screens compose), §4 (layout on the caller), §5 (tone via `tone`), §6 (a glyph plus a word), §8 (no speculative `RunCard` prop).
- `src/shared/ui/verve/README.md` rules 3-4 (colour only as Tailwind names; import from `@/shared/ui`).
- `.agents/skills/frontend-module-standards/SKILL.md` and `.agents/skills/backend-module-standards/SKILL.md` (quoted in Project Constraints).
- `/home/lyphe/.claude/descent/GOTCHAS.md` #119 and #253 (quoted in Project Constraints).
- `docs/architecture/03-conversation-handoff.md` (the app vs provider session id table).
- `docs/plan-runner.md` §files (line 29) and §"The four routes" (line 327); `docs/memory-intake.md` §"Where the shapes live".

## Open Questions

- None. Every question the brief raised is decided above.

## Ship Logs

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-14
- run: desktop-side-widgets-plan-20260914-181124-1661 · attempt 1 of 2 · cycle 1 · spawns 4/60 · fix-passes 1 of 2 · cost $0.46 (run $0.46) · resumed 0×
- builder: hephaestus/deepseek-flash · session d181f323-3f56-47c3-a58e-06b1ee6f5d50 · 26s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (16s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 2/2 steps OK · verify 2/2 OK
- forbidden: unchanged (0 declared, 0 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-side-widgets-plan-20260914-181124-1661/phase_1/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-14
- run: desktop-side-widgets-plan-20260914-181124-1661 · attempt 1 of 2 · cycle 2 · spawns 8/60 · fix-passes 1 of 2 · cost $1.45 (run $1.91) · resumed 0×
- builder: hephaestus/deepseek-flash · session e2ca2b49-41da-45b4-ae21-aec5beb512a9 · 252s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 → fix-pass 1/deepseek-flash (127s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 12/12 steps OK · verify 2/2 OK
- forbidden: unchanged (1 declared, 1 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-side-widgets-plan-20260914-181124-1661/phase_2/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-14
- run: desktop-side-widgets-plan-20260914-181124-1661 · attempt 1 of 2 · cycle 3 · spawns 12/60 · fix-passes 1 of 2 · cost $1.58 (run $3.50) · resumed 0×
- builder: hephaestus/deepseek-flash · session c8058e38-3870-4c5d-a877-527147f69aef · 252s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (84s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 11/11 steps OK · verify 2/2 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-side-widgets-plan-20260914-181124-1661/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-14
- run: desktop-side-widgets-plan-20260914-181124-1661 · attempt 1 of 2 · cycle 4 · spawns 16/60 · fix-passes 1 of 2 · cost $1.55 (run $5.05) · resumed 0×
- builder: hephaestus/deepseek-flash · session 9fa2caa0-9b25-43ee-a125-77ea5ba68df4 · 467s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/deepseek-flash (67s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 8/8 steps OK · verify 2/2 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-side-widgets-plan-20260914-181124-1661/phase_4/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-14
- run: desktop-side-widgets-plan-20260914-181124-1661 · attempt 1 of 2 · cycle 5 · spawns 17/60 · fix-passes 0 of 2 · cost $0.09 (run $5.14) · resumed 0×
- builder: hephaestus/deepseek-flash · session ab43c4ef-1c95-4dd7-bb9f-0029c8a2dbf6 · 464s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 2/2 steps OK · verify 2/2 OK
- forbidden: unchanged (4 declared, 4 present)
- evidence: /home/lyphe/.claude/state/runner/desktop-side-widgets-plan-20260914-181124-1661/phase_5/

### Run desktop-side-widgets-plan-20260914-181124-1661 — COMPLETE 2026-09-14
- shipped: 1, 2, 3, 4, 5
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/desktop-side-widgets-plan-20260914-181124-1661/resume_brief.md
