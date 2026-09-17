# The Kanban board

Thirty-three routes under `/api/kanban`, behind `authenticateToken` on the MOUNT
(`server/index.ts:194` — no route file imports the guard), wired in `kanban.module.ts`, plus one
websocket frame — `kind: 'kanban_event'` — sent to every open `/ws` socket on every write and
never on a read.

The board is one tab of the project workspace. A project's tab strip carries it beside chat, files
and git (`WorkspaceTabs.tsx`), and the pane mounts only while that tab is active. Everything a
reader does here is one of those thirty-two calls; the client's half of them is one group in
`src/shared/api.ts` (`api.kanban`, beside `planRunner`), built on the same `get`/`post`/`patch`/`del`
helpers the rest of that file uses, with the bearer token attached by `authenticatedFetch` — no
caller passes one.

## What the board is

Cards in lanes. Five statuses — `not_ready`, `todo`, `questions`, `active`, `done` — and a lane is
a SET of them, composed on the client (§"The panel"). A card carries a title, a priority, a
description, an optional plan and body, tags, questions and the decisions they produced, issues, a
checklist, attachments, approval, and two leases with their token ledgers.

**It is Descent's model, ported.** The schemas are Descent's `ov_*` tables under a `kanban_`
prefix, with the same columns and the same five statuses, because the importer (§"Importing from
Descent") has to be a mapping rather than a translation. What the board does NOT carry is Descent's
daemon: **nothing here schedules, builds or resumes anything.** The autonomy switch is a UI gate,
the leases are rows an external process takes and refreshes, and no code in this module acts on
either. The data model is complete and the verbs are complete; the machine that would drive them
is not this lane.

## The tables

Eleven tables and nine indexes, all declared in ONE idempotent script,
`server/modules/database/kanban-schema.ts`'s `KANBAN_SCHEMA_SQL`, exec'd from `runMigrations` in
`migrations.ts:565` — after the projects rebuild, because `kanban_boards.project_id` references
`projects(project_id)`. There is no version counter: every statement is `IF NOT EXISTS`, and that
is what makes a re-run at every boot safe. The consequence is the trap, stated in that file's own
header — once a database has these tables, editing a column here changes nothing on it, and a
later change needs an explicit `ALTER TABLE` in `migrations.ts` beside the `sessions` columns.

| Table | What it holds |
|---|---|
| `kanban_boards` | A board: its name, the project it is ABOUT (`project_id`, a label and never a filter), `autonomy`, `deepseek_flash`, `sort_order`, `archived`, `descent_id`. |
| `kanban_cards` | The card, every column of Descent's `ov_features` including the ones its own `_migrate` adds: title, `status` with a five-value CHECK, `priority` with a three-value CHECK, description, `closing_remarks`, `plan`, `body`, approval, `archived`, `sort_order`, the four token counters, both leases (`build_lease_at`/`build_owner`, `plan_lease_at`/`plan_owner`), and the timestamps. |
| `kanban_card_tags` | The card/tag join. Descent's `ov_tags` IS a join table, so there is no tag entity here either: `(card_id, tag)` is the primary key and a tag exists only as a name attached to a card. |
| `kanban_questions` | A card's questions: `text`, `multi`, `options` and `selected` as JSON text arrays, the free-text `other`, and `answered`. |
| `kanban_issues` | Issues filed against a card, with `filed_at`, `resolved`, and who resolved it. |
| `kanban_decisions` | The record of an answer — what was asked, what was chosen, its tags. `card_id` and `question_id` are both nullable and both may name rows that are gone; a decision outlives what it decided. |
| `kanban_checklist_items` | `pending` / `active` / `done`, with a note and their own `sort_order`. |
| `kanban_attachments` | Metadata rows — filename, mime, size. Never the file behind them; nothing in this module stores a byte. |
| `kanban_events` | The audit log: `ts`, `kind`, `board_id`, `card_id`, `actor`, `payload` as a JSON object. It is the table the write seam writes (§"The one write seam"), and one request reads it (`GET /events`). |
| `kanban_settings` | `key` / `value`. Exactly one key is live: `current_board`, the selected board — the reason boards are global (§"The panel"). |
| `kanban_id_seq` | `prefix` / `next`. The id minting arithmetic and nothing else. |

The nine indexes are all named `ix_kanban_*` so one query can count them:
`cards_board_status` and `cards_board_updated` on the two lane orderings, `card_tags_tag` for a
tag search, and one `*_card` index on each child table. `events_board` is `(board_id, id)`, which
is what makes the audit-log read a range scan.

**There is deliberately no index on `descent_id`.** The column is `NULL UNIQUE` on every table that
has one, and a UNIQUE constraint already builds its own index — a second one would be dead weight
on every insert. That nullability is load-bearing rather than incidental: SQLite permits MANY NULL
rows under one UNIQUE constraint, which is exactly what lets a card created here (no Descent
ancestor, `descent_id` null) sit in the same table as an imported one while the importer's
`ON CONFLICT(descent_id)` still keys cleanly on the rows that carry one.

`PRAGMA foreign_keys = ON` is set in the schema's own init script, so every `REFERENCES` above is
enforced — including the `ON DELETE CASCADE` from a card to its questions, issues, checklist items,
attachments and tags, the `ON DELETE SET NULL` that keeps a DECISION when the card or question it
names is deleted, and the same clause that unlabels a board when its project goes.

## Ids, order and time

- **Ids are minted, never inlined.** `kanbanIdsDb.mintId(prefix)` bumps `kanban_id_seq` for that
  prefix inside the caller's transaction — an UPSERT, not a read-then-write, so two creates racing
  on one prefix cannot mint the same id — and returns `` `${prefix}-${next}` ``. The prefixes are
  `b` boards, `c` cards, `q` questions, `i` issues, `d` decisions, `k` checklist items and
  `a` attachments. Descent's own ids are never reused as primary keys; they live in `descent_id`
  and nowhere else.
- **Timestamps are ISO-8601 UTC seconds**, `new Date().toISOString()`, in every `*_at` column. On
  import, Descent's own spelling — microsecond precision with a numeric offset — is normalised to
  this one before it lands, because the guards and the orderings below are TEXT comparisons and two
  spellings of one instant compare wrong.
- **`sort_order` is REAL and moves by midpoint.** A move takes `afterId` (the card that will sit
  directly above) and `beforeId` (directly below), either of which may be null: both null → `1000`
  (`KANBAN_SORT_ORDER_GAP`); one null → that end of the lane's bounds, ±1000; both present →
  `(above + below) / 2`. When the two neighbours are closer together than `1e-6`
  (`KANBAN_SORT_ORDER_MIN_GAP`), the lane is renormalised FIRST, inside the same transaction —
  every live card of the status set rewritten to `(index + 1) * 1000` in its current order — and the
  midpoint recomputed from the restacked rows. A closed gap is therefore never a failed move.
- **Lane order.** Every lane but `done` is `ORDER BY sort_order ASC, id ASC`. `done` is
  `ORDER BY updated_at DESC, id DESC` — newest first, because finished work is read from its end.
- **Paging is keyset, never OFFSET, and the keyset spans the whole status set** — one ordered page
  across `status IN (…)`, never one page per status stitched client-side. The cursor is the literal
  string `<key>|<id>`; `limit` defaults to 50 (`KANBAN_LANE_LIMIT_DEFAULT`) and the ROUTE clamps it
  to `[1, 200]`. A malformed cursor is a 400, not a silent first page — a client that wrote one is
  asking for something this board does not do. `nextCursor` is null when the page came back shorter
  than the limit.
- **`laneCounts` stays PER STATUS** — five rows from one grouped query, exactly as the schema
  stores them. The panel sums the rows its lane policy composes (§"The panel"). The server
  never learns that a board has lanes.
- **A lease is claimable when it is unclaimed, already the caller's, or STALE** — stale meaning the
  stamp is null, unparseable, or older than `KANBAN_LEASE_STALE_SECONDS` (**40**, Descent's own
  `DEFAULT_STALE_SECS`, written once in `server/shared/kanban-types.ts` and imported by every
  consumer — the lease verbs, the card summaries, and `claimableCount` (§"The services")). A claim
  against a fresh foreign lease returns `{ granted: false }` with the current
  card — the ordinary answer, never an exception, and never an event: a refused claim writes
  nothing. Moving a card off `active` clears the build lease. The `leaseState` a `KanbanCardSummary`
  carries (`'none' | 'held' | 'stale'`) is computed SERVER-side by the one row-to-summary mapper;
  the client reads it and never re-derives it from `buildLeaseAt`.

## The one write seam

**Every write in this module goes through `writeKanban`** (`kanban-write.service.ts`), and nothing
else in it ever opens a transaction, inserts a `kanban_events` row or sends a frame.

Twenty-seven verbs each hand-copying a transaction, an event and a fan-out is twenty-seven chances
to forget one — and the two failures that look alike are opposite bugs: an event written OUTSIDE
the transaction survives a rolled-back write, and a frame sent INSIDE it tells every client about a
write that then rolls back. One place to be right. The order is fixed:

1. Open ONE `db.transaction(...)`.
2. Run `mutate(db)` inside it and keep what it returned.
3. Append the `kanban_events` row inside the SAME transaction, so a rolled-back write leaves no
   event behind.
4. COMMIT.
5. **Outside** the transaction: read the affected card's FRESH summary and the board's lane counts
   AFTER the write, build the frame, and broadcast it. A throw here is caught and logged — the
   write has already committed, and a dead socket must not turn it into a 500.
6. Return `mutate`'s value to the verb.

A verb that needs two writes to be atomic does both inside ONE `mutate` callback — never two
`writeKanban` calls. That is what makes `approveCard` promote a `not_ready` card to `todo` AND
approve it as one event, and what makes an import of twelve thousand events one write
(§"Importing from Descent").

Two things the seam needs from the caller rather than the verb: `actor`, which defaults to
`'operator'` and rides straight into the event row — no route reads an identity off the request,
because there is none on this board today, and the parameter exists so that adding one later is a
caller change rather than a schema change — and `boardId`, which is a plain string for the
twenty-six kinds whose board already exists and a FUNCTION for the one kind that creates its board,
because `board.created` mints that id inside the transaction and it does not exist when the spec is
written.

The event kinds are exactly: `board.created`, `board.updated`, `board.selected`, `board.archived`,
`card.created`, `card.updated`, `card.moved`, `card.archived`, `card.restored`, `card.approved`,
`card.unapproved`, `tag.added`, `tag.removed`, `question.added`, `question.answered`, `issue.filed`,
`issue.resolved`, `checklist.added`, `checklist.updated`, `checklist.removed`, `attachment.added`,
`lease.build_claimed`, `lease.build_refreshed`, `lease.build_released`, `lease.plan_claimed`,
`lease.plan_released`, `import.descent`.

## The services

Six service files, cut by cohesion rather than one file growing to twenty-seven verbs. Every write
verb takes an optional trailing `context?: KanbanWriteContext` (`{ actor?: string }`); the routes
pass nothing. The lease verbs take an explicit `owner` instead — a lease owner is a different
concept from an event actor, and both ride on the summary.

`kanban-boards.service.ts`

```
createBoard(input: { name, projectId? }, context?) -> KanbanBoard
listBoards(options?: { includeArchived? }) -> { boards, currentBoardId }
getBoard(boardId) -> KanbanBoard | null
updateBoard(boardId, patch: { name?, autonomy?, deepseekFlash?, projectId?, archived? }, context?) -> KanbanBoard
selectBoard(boardId, context?) -> { currentBoardId }
boardForProject(projectId) -> KanbanBoard | null
laneCounts(boardId) -> KanbanLaneCount[]
claimableCount(boardId) -> number
listEvents(options: { boardId?, cardId?, limit? }) -> KanbanEventRow[]
```

`selectBoard` is a write to `kanban_settings.current_board` and takes the seam like any other.
`laneCounts`, `claimableCount` and `listEvents` are the only three reads the whole module exposes
at board level. `claimableCount` counts a board's live `todo` cards plus its `active` cards on a
stale build lease (the same staleness `KANBAN_LEASE_STALE_SECONDS` defines above) — the green
light an autonomous session reads before it spawns, over `GET /boards/:boardId/claimable`
(§"The routes"). Nothing in this module spawns that session or reads `deepseekFlash`; both are
scaffolding for a driver that launches FROM the board and is not built in this module.

`kanban-cards.service.ts`

```
listLaneCards(boardId, statuses: KanbanStatus[], options: { limit?, cursor? }) -> { cards, nextCursor }
createCard(boardId, input: { title, priority?, status?, description? }, context?) -> KanbanCardSummary
getCard(cardId) -> KanbanCardDetail
updateCard(cardId, patch: { title?, priority?, description?, body?, plan?, closingRemarks? }, context?) -> KanbanCardSummary
moveCard(cardId, input: { status, afterId?, beforeId? }, context?) -> KanbanCardSummary
archiveCard(cardId, context?) / restoreCard(cardId, context?) -> KanbanCardSummary
addTag(cardId, tag, context?) / removeTag(cardId, tag, context?) -> KanbanCardSummary
```

`listLaneCards` is the ONLY place a status list reaches SQL, and it builds its placeholder list
from the array's length — never by interpolating a string. A one-element array is the ordinary
case, not a special one.

`kanban-questions.service.ts` — questions, the decisions they write, and the approve gate

```
addQuestion(cardId, input: { text, options?, multi?, otherOn? }, context?) -> KanbanQuestion
answerQuestion(questionId, input: { selected, other? }, context?) -> KanbanQuestion
approveCard(cardId, context?) / unapproveCard(cardId, context?) -> KanbanCardSummary
```

**The approve gate** is Descent's, and both its refusals are 409s rather than 400s: the request was
well formed, the card is not ready. A card is approvable when it has ZERO unanswered questions
(`KANBAN_CARD_QUESTIONS_OPEN`) and at least one of `plan`, `body`, `description` is non-empty
(`KANBAN_CARD_NEEDS_PLAN`). A `not_ready` card that passes is promoted to `todo` AND
approved in one `mutate`, one event. Un-approving clears approval and nothing else — a card approved
out of the backlog stays in To Do, because un-approving is not un-promoting.

`kanban-checklist.service.ts` — checklist items, attachments and issues

```
fileIssue(cardId, { text }, context?) -> KanbanIssue
resolveIssue(issueId, { resolvedBy? }, context?) -> KanbanIssue
addChecklistItem(cardId, { text, note? }, context?) -> KanbanChecklistItem
updateChecklistItem(itemId, { state?, text?, note? }, context?) -> KanbanChecklistItem
removeChecklistItem(itemId, context?) -> void
addAttachment(cardId, { filename, mime, size }, context?) -> KanbanAttachment
```

The three surfaces are one file because they are one drawer section's worth of state: an issue, a
checklist item and an attachment are all small rows hanging off a card with no lifecycle beyond
theirs.

`kanban-leases.service.ts`

```
claimBuildLease(cardId, owner) / refreshBuildLease(cardId, owner) / releaseBuildLease(cardId, owner) -> KanbanLeaseResult
claimPlanLease(cardId, owner) / releasePlanLease(cardId, owner) -> KanbanLeaseResult
```

Five verbs over two compare-and-set statements that live in `kanban-leases.db.ts`. Each is one
`writeKanban` call whose `mutate` returns `{ granted }`, and the payload carries the owner. A
refused claim records nothing.

`kanban-import.service.ts` — `importFromDescent(input: { dbPath? }, context?)`, §"Importing from
Descent".

## The routes

`server/modules/kanban/routes/` is a PACKAGE, not one file: `board.routes.ts` (8 routes),
`card.routes.ts` (9), `detail.routes.ts` (15) and `import.routes.ts` (1), each exporting a
`create<X>Routes(services): Router` factory; and `kanban.routes.ts`, the FACTORY that builds one
`express.Router()` and `use`s the four onto it. The package is INTERNAL — nothing outside
`kanban.module.ts` imports it, and the module's barrel exports the services and the module
constructor, never a route.

```
GET    /api/kanban/boards                       -> { boards, currentBoardId }
POST   /api/kanban/boards                       { name, projectId? }   -> { board }
PATCH  /api/kanban/boards/:boardId              { name?, autonomy?, deepseekFlash?, projectId?, archived? } -> { board }
POST   /api/kanban/boards/:boardId/select                              -> { currentBoardId }
GET    /api/kanban/boards/:boardId/lanes                               -> { lanes }
GET    /api/kanban/boards/:boardId/claimable                           -> { claimable }
GET    /api/kanban/projects/:projectId/board                           -> { board }
GET    /api/kanban/events?boardId=&cardId=&limit=                      -> { events }
GET    /api/kanban/boards/:boardId/cards?status=todo,questions&limit=&cursor= -> { cards, nextCursor }
POST   /api/kanban/boards/:boardId/cards        { title, priority?, status?, description? } -> { card }
GET    /api/kanban/cards/:cardId                                       -> { card }
PATCH  /api/kanban/cards/:cardId                { title?, priority?, description?, body?, plan?, closingRemarks? } -> { card }
POST   /api/kanban/cards/:cardId/move           { status, afterId?, beforeId? } -> { card }
POST   /api/kanban/cards/:cardId/archive        -> { card }
POST   /api/kanban/cards/:cardId/restore        -> { card }
POST   /api/kanban/cards/:cardId/tags           { tag }                -> { card }
DELETE /api/kanban/cards/:cardId/tags/:tag                             -> { card }
POST   /api/kanban/cards/:cardId/questions      { text, options?, multi?, otherOn? } -> { question }
POST   /api/kanban/questions/:questionId/answer { selected, other? }   -> { question }
POST   /api/kanban/cards/:cardId/issues         { text }               -> { issue }
POST   /api/kanban/issues/:issueId/resolve      { resolvedBy? }        -> { issue }
POST   /api/kanban/cards/:cardId/checklist      { text, note? }        -> { item }
PATCH  /api/kanban/checklist/:itemId            { state?, text?, note? } -> { item }
DELETE /api/kanban/checklist/:itemId                                   -> { ok: true }
POST   /api/kanban/cards/:cardId/attachments    { filename, mime, size } -> { attachment }
POST   /api/kanban/cards/:cardId/approve                               -> { card }
POST   /api/kanban/cards/:cardId/unapprove                             -> { card }
POST   /api/kanban/cards/:cardId/build-lease/{claim,refresh,release}   { owner } -> { granted, card }
POST   /api/kanban/cards/:cardId/plan-lease/{claim,release}            { owner } -> { granted, card }
POST   /api/kanban/import/descent               { dbPath? }            -> KanbanImportResult
```

**`status` on the lane route is a COMMA-SEPARATED LIST**, parsed in the ROUTE into
`KanbanStatus[]`: split on `,`, trim, drop empties, reject the whole request with a 400 if any
member is not one of the five statuses, and reject an empty list too — silently ignoring a bad
member would answer a request for two statuses with one lane. `status=todo` and
`status=todo,questions` are both ordinary. The route — never the service — also clamps `limit` and
parses `cursor` as an opaque string.

`GET /events` clamps `limit` the same way, default 50, max 200. Without the clamp one request can
ask for the board's whole audit log, which on an imported Descent board is twelve thousand rows.

Success bodies are the bare JSON objects named above. Failures are
`res.status(n).json({ error: '…' })` for a parse failure in the route, and every service failure is
an `AppError` thrown to `next(error)` and rendered by the global handler as
`{ success: false, error: { code, message } }`. Both shapes already coexist elsewhere in this
server; the board adds no third one. `express.json()` is global, so no body parser is added here.

## The frame

`GatewayEventKind` carries `'kanban_event'`, and `KanbanBoardEvent` is declared beside its siblings
in `server/shared/types.ts` — the ONE kanban type in that file, because a gateway kind and its
frame belong together. It reads:

```ts
export type KanbanBoardEvent = {
  kind: 'kanban_event';
  boardId: string;
  event: { id: number; ts: string; kind: string; cardId: string | null; actor: string };
  card: KanbanCardSummary | null;   // the affected card, fresh, or null for a board-level write
  lanes: KanbanLaneCount[];         // the board's lane totals AFTER the write
  at: number;
};
```

**Only `writeKanban` builds and sends this frame.** No verb, route or repository constructs one,
and `broadcastKanbanEvent` has exactly one caller. The fan-out copies this server's other
broadcast: `JSON.stringify` once for the whole set rather than once per socket, then a walk of
`connectedClients` sending to each whose `readyState` is `WS_OPEN_STATE`. A socket that throws
mid-send is caught PER CLIENT — a dead socket must not cost every client after it their frame.
There is no per-user or per-project filtering, here or anywhere else in this server's broadcasts.

**Exactly one frame per write.** One card edit is one frame; one card moved is one frame; an
import — four hundred cards, twelve thousand events, one `mutate` and one event row — is ONE frame
carrying `card: null` and the board's fresh lane counts, not 449. The frame is read after the
commit, so it carries what landed rather than what was intended, and it is built outside the
transaction so a client is never told about a write that then rolls back.

The client subscribes with `useWebSocket()` from `@/shared/context/WebSocketContext`; `subscribe`
returns its own unsubscribe closure and hands each listener the loose `ServerEvent`, so the lanes
hook filters on `event.kind === 'kanban_event'` itself and ignores every other frame. **The board
does not use the live-bus**: that bus retains a value for components mounted elsewhere and admits
only the run, soul and universe lanes; this panel is its own only consumer and exists only while its
tab is active.

## The panel

`src/modules/kanban/` composes the tab's pane, its header, its import dialog, the card drawer under
`card-drawer/`, six hooks — `useKanbanMetis` is the newest, reading the board's own Metis fleet —
and four module-private utilities under `utils/`. The barrel exports
`KanbanPanel` and nothing else — a second export is how a policy that must be decided in one place
starts being read in two.

**A lane is a set of statuses.** Which statuses compose which lane is decided in exactly one file,
`src/modules/kanban/utils/lanePolicy.ts`'s `kanbanLanes(autonomy)`, and read by the panel, the
rail, the lanes hook, the lane feed, the board menus and the drag hook alike. With autonomy OFF it
returns four lanes and To Do carries TWO statuses; with autonomy ON it returns five:

| autonomy off | statuses | autonomy on | statuses |
|---|---|---|---|
| Backlog | `not_ready` | Backlog | `not_ready` |
| To Do | `todo`, `questions` | To Do | `todo` |
| In Progress | `active` | Open questions | `questions` |
| Done | `done` | In Progress | `active` |
| | | Done | `done` |

Backlog is the leftmost lane: work enters at the left edge and flows right.

**When autonomy is off, a card waiting on an answer shows in To Do.** Its status is never rewritten
to make the board simpler and the card is never hidden — it sits in To Do wearing its own chip. The
server stores five statuses and counts them five ways; the kit renders a title, a count and cards
and never hears the word `status` at all; everything between those two is that one file. A lane's
count is the SUM of its statuses' rows in `laneCounts`, computed there. The one ordering the file
also carries is which end new work arrives at — `done` pages newest-first, every other lane follows
`sort_order` — because a frame-arrived card has to be placed without refetching the lane, and the
wrong end is a card that jumps on reload.

**The autonomy switch gates the UI and nothing else.** It is a column on the board row, toggled
through `PATCH /api/kanban/boards/:boardId`, and the server reads it for no decision whatsoever —
it flips an integer, maps it back to a boolean on the way out, and stores it. What it gates is
what the reader sees: the `questions` lane (folded into To Do when off, with a banner saying why),
every signal on a card face (`toCardModel` returns no `signals` when autonomy is off — that single
early return is the whole mechanism, not a second render path), and in the drawer the questions,
the checklist, the issues, the token ledger, the closing remarks and the approve control. Turning
it off hides nothing on the server and skips no write: the same routes answer, the same rows are
there, and switching it back on shows the same data.

**A second board column, `deepseekFlash`, round-trips beside `autonomy`.** It reached
`kanban_boards` in the same phase as `claimableCount` (§"The services") — the board's own
DeepSeek Flash switch, mirroring the host-wide flag file the plan runner polls
([plan-runner.md](plan-runner.md) §"The DeepSeek switch") but scoped to one board. The header row
now draws it too, beside Autonomy: a second `Switch` wearing the DeepSeek mark
(`LLMProviderLogo`) rather than a colour of its own, with a `Tooltip` naming what the switch
moves. That composition is now WIRED, not a scaffold: `useKanbanBoards` reads `deepseekFlash`
off the current board the same way it reads `autonomy` (`?? false`, so a board that is gone or a
server too old to answer with the field reads as off), and `KanbanBoardHeader`'s two FILL markers
are gone — `checked` takes that value and `onChange` calls `onToggleDeepseekFlash`, which
`KanbanPanel` guards on `currentBoardId` before sending `updateBoard(currentBoardId,
{ deepseekFlash: next })`, the same `PATCH` and the same post-write re-read `autonomy`'s own
toggle takes. Nothing reads `deepseekFlash` for a decision yet even so: it is for a driver that
will spawn sessions FROM the board and read it at spawn time — not built in this module, and this
doc says nothing about that driver until it lands.

**Boards are GLOBAL, not per project.** The selected board is the single `kanban_settings` row
`current_board`, so switching projects does NOT change the selected board, and no board is
unmounted or refetched when the active project changes. A board's `project_id` is a LABEL — which
project this board is about — never a filter. `projectId` reaches the panel for exactly one
purpose: **on FIRST mount only, when `currentBoardId` is null, the panel asks
`boardForProject(projectId)` and selects that board if one comes back.** That is a first-run
convenience and nothing more — it fires at most once per mount, it never fires when a board is
already selected, and it never fires on a project switch.

**Lazy loading.** On mount the panel fetches EXACTLY two things: the board list and the current
board's lane counts. Each lane then fetches its OWN first page of summaries for the status set its
lane spec names. A card's DETAIL is fetched only when the drawer opens on it. The one extra
first-mount call is `boardForProject`, above.

Every lane then pages through the same tail, which the kit owns: an 8px sentinel inside the lane
body, observed by an `IntersectionObserver` that fires ONE request per intersection and re-arms when
the sentinel scrolls back out of view, beside a "Load more" button that is ALWAYS rendered — the
sentinel is a scroll affordance and a keyboard cannot reach it. `done` pages from its newest slice;
every other lane follows `sort_order` from its oldest. A page already in flight is not re-entered,
and each lane holds its own cursor, so one lane's paging cannot spend another's. The board itself
never refetches a lane to place new work: a frame carrying a card the lane already has moves it in
place, which is what the lane spec's `newestFirst` end is for.

**Writes are optimistic and reverting.** `useKanbanMutations` paints the card the SERVER returns
through the board's `applyCard`, so a refused move puts the card back where the reader found it —
the revert is the applier, run backwards. A write outcome is a toast, except where the board's own
screen is the answer: a MOVE announces through the board's single `aria-live="polite"` region
instead, in the shape `<title> moved to <lane>, position <n> of <total>`. Only the board sees both
the lane the card left and the lane it landed in, and a toast leaves — and a thing that leaves
cannot announce.

## Importing from Descent

`POST /api/kanban/import/descent` — `importFromDescent(input: { dbPath? })`, the board's one door
onto a foreign database. It reaches its source through TWO files and never opens a database itself:

**`kanban-import.transport.ts` is the foreign read, and nothing else.** It opens the `descent.db` at
`input.dbPath` (default `~/.claude/descent/descent.db`) through `better-sqlite3` with
`{ readonly: true, fileMustExist: true }`, so the worst a bug here can do to a live Descent install
is fail to open it. It checks the file's SHAPE — the nine `ov_*` tables and the columns each read
names — before a single row is read, so the wrong file and the older-Descent file are both a 404
naming what is missing rather than a driver error four tables deep. A file holding no boards is
refused rather than imported, because every card is a board's child. It reads each table one pass
into typed row arrays, closes the handle in a `finally`, and writes NOTHING, maps nothing and has
never heard of a `kanban_` table. The source file is never written.

**`kanban-import.service.ts`** calls the transport, maps the rows and hands the whole mapping to the
write seam as ONE `mutate` callback under the `import.descent` kind — which is why an import is one
event and one frame, and why a failure anywhere in the mapping rolls the whole import back: there is
no such thing as a half-imported board. Mapping, table by table: `ov_boards`→`kanban_boards`,
`ov_features`→`kanban_cards`, `ov_tags`→`kanban_card_tags`, `ov_questions`→`kanban_questions`,
`ov_issues`→`kanban_issues`, `ov_decisions`→`kanban_decisions`,
`ov_checklist_items`→`kanban_checklist_items`, `ov_attachments`→`kanban_attachments`,
`ov_events`→`kanban_events`. Ordering inside the transaction follows that list — parents before
children — and an `ov_events` row whose `feature_id` no longer resolves is imported with `card_id`
null rather than dropped, because Descent's log carries no foreign key there.

**Idempotency is `descent_id`.** Every imported row carries Descent's primary key in that column,
and every table's insert is `INSERT INTO … ON CONFLICT(descent_id) DO UPDATE SET …` naming every
non-key column — so a second run UPDATES and inserts nothing new, a row that is already here keeps
its local id, and every link that pointed at it still does. A locally created row has no
`descent_id` and can never collide. `kanban_card_tags` is the exception with no exception to make:
its key is the pair `(card_id, tag)` itself, so its insert is `INSERT OR IGNORE`.

**A re-import never overwrites a card you edited here.** For `kanban_cards` and `kanban_boards` the
upsert's `DO UPDATE` carries a guard clause:

```sql
INSERT INTO kanban_cards (…) VALUES (…)
ON CONFLICT(descent_id) DO UPDATE SET …
WHERE excluded.updated_at >= kanban_cards.updated_at
```

and the same shape, on `kanban_boards.updated_at`, for boards. A card edited in LypheCLI after its
last Descent change therefore survives a second import untouched; one Descent changed more recently
is refreshed. A `DO UPDATE` whose `WHERE` is false is not an error and not a conflict — SQLite
simply skips the row — so the import completes and the counts still reconcile: a card the guard
held is counted as neither an insert nor a refresh. The CHILD tables stay full upserts with no
guard, deliberately: they carry no local editing surface here, and a partially guarded child would
leave a card's questions half from each side.

**One setting is imported, and eighteen are not.** `ov_settings` holds the key `current_board`,
which is translated through the board id map and written to `kanban_settings`; the rest are
Descent daemon state — `mcp_active_pid`, `notif_ingest_keepalive`, `pm_capacity_governor`,
`schema_version`, `theme` and their siblings — and are skipped. One `import.descent` event is
recorded with the counts as its payload.

The result is what the dialog shows: source counts against imported counts per table, `inserted`
and `updated`, the board id map, and the current board.

## Proving it

Two probe scripts, both run against a REAL server and a REAL board. Neither is a test runner, and
neither writes anything back into the repo.

**The websocket probe** proves a real write reaches a real client, end to end:

```
node scripts/kanban-ws-probe.mjs <app-url> <token> <board-id>
```

It opens the app's `/ws` socket the way the browser client does — the token riding as the same
`?token=` query parameter `WebSocketContext` builds — waits up to 20 s for a frame, and prints ONE
line: `FRAME kind=<event kind> card=<cardId> lanes=<n>` for the first `kanban_event` frame whose
`boardId` matches, or `NO-FRAME`. A frame of any other kind is not evidence, and neither is a
`kanban_event` for a different board — the server filters neither, so the probe does. Write a card
in another shell while it waits and the frame it prints is that write.

**The UI probe** opens the real app in a real browser, walks to the tab the way a reader does, and
reports whether the words a caller expects are on the screen:

```
node scripts/kanban-ui-probe.mjs <app-url> <token> <project-name> <tab-label> [expect...]
```

It drives headless Chrome over the DevTools protocol by hand — no playwright runner, no test
framework — because the things it checks (a tab renders, a lane paints its cards, a drawer opens)
exist only after React has run, and a curl of the endpoint would answer none of them. It prints ONE
line, `PROBE OK` or `PROBE FAILED`, and exits; everything that explains a failure goes to stderr.
The browser binary is playwright's own download, already on this box — point
`CHROME_HEADLESS_SHELL` somewhere else to use a different one. It is on a watchdog clock, so a page
that never answers still produces its one line rather than hanging a caller.

Both take the url and the token as ARGUMENTS and reach for nothing ambient, so a server booted on a
spare port against the real database is the whole invocation: mint a token for the first user from
that database's own `jwt_secret`, boot, probe, stop. Neither probe mints a token itself and neither
keeps state between runs, which is what makes each one re-runnable against the same board.
