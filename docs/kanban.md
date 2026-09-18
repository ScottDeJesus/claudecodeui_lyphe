# The Kanban board

Forty-two routes under `/api/kanban`, behind `authenticateToken` on the MOUNT
(`server/index.ts:226` — no route file imports the guard), wired in `kanban.module.ts`, plus one
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
Descent") has to be a mapping rather than a translation. What came across with them is Descent's
daemon, one module over: **the driver in `server/modules/kanban-metis/` DOES schedule, build and
resume — THIS module does none of the three** (§"The driver"). The autonomy switch stays a UI gate
and a governor column the driver reads; the leases stay rows an external process takes and
refreshes, and the only thing here that reads one for a decision is `claimableCount`, which the
driver asks before it spawns (§"The services"). This module owns the data model and the verbs; the
driver owns every decision taken over them, and reads them through this module's barrel rather than
through a second copy of anything.

## The tables

Thirteen tables and ten indexes, all declared in ONE idempotent script,
`server/modules/database/kanban-schema.ts`'s `KANBAN_SCHEMA_SQL`, exec'd from `runMigrations` in
`migrations.ts:565` — after the projects rebuild, because `kanban_boards.project_id` references
`projects(project_id)`. There is no version counter: every statement is `IF NOT EXISTS`, and that
is what makes a re-run at every boot safe. The consequence is the trap, stated in that file's own
header — once a database has these tables, editing a column here changes nothing on it, and a
later change needs an explicit `ALTER TABLE` in `migrations.ts` beside the `sessions` columns.

| Table | What it holds |
|---|---|
| `kanban_boards` | A board: its name, the project it is ABOUT (`project_id` — never a lane filter, but no longer inert either: it resolves to the ONE `--add-dir` this board's Metis is given, and a board with a null `project_id` gives her none, so she works only inside her own session directory — §"A board's Metis, launched"), `autonomy` (the driver's governor — §"The driver"), `deepseek_flash` (the board's own switch — §"The two switches"), `concurrency` (the board's own Metis dial — §"The driver"), `sort_order`, `archived`, `descent_id`. |
| `kanban_cards` | The card, every column of Descent's `ov_features` including the ones its own `_migrate` adds: title, `status` with a five-value CHECK, `priority` with a three-value CHECK, description, `closing_remarks`, `plan`, `body`, approval, `archived`, `sort_order`, the four token counters (`build_tokens_in`, `_out`, `_cache_read`, `_cache_create` — accumulated by the token watcher, §"The token watcher"), both leases (`build_lease_at`/`build_owner`, `plan_lease_at`/`plan_owner`), and the timestamps. |
| `kanban_card_tags` | The card/tag join. Descent's `ov_tags` IS a join table, so there is no tag entity here either: `(card_id, tag)` is the primary key and a tag exists only as a name attached to a card. |
| `kanban_questions` | A card's questions: `text`, `multi`, `options` and `selected` as JSON text arrays, the free-text `other`, and `answered`. |
| `kanban_issues` | Issues filed against a card, with `filed_at`, `resolved`, and who resolved it. |
| `kanban_decisions` | The record of an answer — what was asked, what was chosen, its tags. `card_id` and `question_id` are both nullable and both may name rows that are gone; a decision outlives what it decided. |
| `kanban_checklist_items` | `pending` / `active` / `done`, with a note and their own `sort_order`. |
| `kanban_attachments` | The row beside the bytes — filename, mime, size — never the bytes themselves. The file lives at a path DERIVED from the row's own id and mime, under `attachmentsRoot()` (§"The services", `kanban-attachments.service.ts`); a row whose file is missing answers 404 rather than a zero-length download. |
| `kanban_events` | The audit log: `ts`, `kind`, `board_id`, `card_id`, `actor`, `payload` as a JSON object. It is the table the write seam writes (§"The one write seam"), and one request reads it (`GET /events`). |
| `kanban_settings` | `key` / `value`. Exactly one key is live: `current_board`, the selected board — the reason boards are global (§"The panel"). |
| `kanban_id_seq` | `prefix` / `next`. The id minting arithmetic and nothing else. |
| `kanban_lessons` | The lesson STORE: what a build learned, staged for a person's review — `name`, `summary`, `body`, `trigger`, `kind` (`note` or `skill_draft`), `tags`, `status`, `source`, an optional `draft_path`. `card_id` is `ON DELETE SET NULL`, never CASCADE — a lesson OUTLIVES the card it was learned on. No CHECK on `status`, `kind` or `trigger`: Descent's lesson vocabulary grew a value twice, so the doors validate instead of a constraint. |
| `kanban_session_usage` | What one Metis session has spent, read from its transcript: the per-session ledger behind the card's rolled-up token chips. `session_id` is the primary key — one row per session, upserted as the transcript grows — and the four counters are the session's running TOTALS, never a delta: the watcher subtracts the row it stored last tick from what it counted now (§"The token watcher"). `byte_offset` records where the MAIN transcript's read cursor stood at that write; the watcher resumes from its own in-memory cursors and never reads the column back. `board_id` and `card_id` are provenance and may be NULL — `card_id` is the last card this session's spend was attributed to, and a tick that finds none leaves it alone. |

The ten indexes are all named `ix_kanban_*` so one query can count them:
`cards_board_status` and `cards_board_updated` on the two lane orderings, `card_tags_tag` for a
tag search, and one `*_card` index on each child table **except** `kanban_lessons` — its own read
is always "this status, newest first", so its index is `lessons_status` on `(status, created_at)`
instead. `events_board` is `(board_id, id)`, which is what makes the audit-log read a range scan.
`kanban_session_usage` carries no index of its own: every read of it is by its own primary key,
`session_id`.

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
  TypeScript consumer — the lease verbs, the card summaries, `claimableCount`, and the plan-runner
  module's plans-archive sweep, which reads it through `plansHeldByLease` rather than a second
  staleness rule of its own (§"The services")). One reader outside this codebase MIRRORS the value
  rather than importing it: `~/.claude/hooks/concurrency_arbiter/presence_resolve.py`'s
  `KANBAN_LEASE_STALE_SECONDS`, which the arbiter's presence ladder reads against `kanban_cards`'
  own lease columns to derive a `/pm` session's held card — a second copy of the SAME number is
  the cost of a Python hook reading this table without a shared module, so a change here must be
  carried there by hand (`concurrency_arbiter/OPERATOR.md` §"How a session's intent is resolved
  (the ladder)"). A claim
  against a fresh foreign lease returns `{ granted: false }` with the current
  card — the ordinary answer, never an exception, and never an event: a refused claim writes
  nothing. Moving a card off `active` clears the build lease. The `leaseState` a `KanbanCardSummary`
  carries (`'none' | 'held' | 'stale'`) is computed SERVER-side by the one row-to-summary mapper;
  the client reads it and never re-derives it from `buildLeaseAt`.

## The one write seam

**Every write in this module goes through `writeKanban`** (`kanban-write.service.ts`), and nothing
else in it ever opens a transaction, inserts a `kanban_events` row or sends a frame.

Twenty-nine verbs each hand-copying a transaction, an event and a fan-out is twenty-nine chances
to forget one — and the two failures that look alike are opposite bugs: an event written OUTSIDE
the transaction survives a rolled-back write, and a frame sent INSIDE it tells every client about a
write that then rolls back. One place to be right. The order is fixed:

1. Open ONE `db.transaction(...)`.
2. Run `mutate(db)` inside it and keep what it returned.
3. Append the `kanban_events` row inside the SAME transaction, so a rolled-back write leaves no
   event behind.
4. Run the spec's `afterEvent`, if it has one — still inside the transaction, so a side effect that
   cannot be rolled back on its own (a file written to disk) lands only once the audit row is in.
5. COMMIT.
6. **Outside** the transaction: read the affected card's FRESH summary and the board's lane counts
   AFTER the write, build the frame, and broadcast it. A throw here is caught and logged — the
   write has already committed, and a dead socket must not turn it into a 500.
7. Return `mutate`'s value to the verb.

A verb that needs two writes to be atomic does both inside ONE `mutate` callback — never two
`writeKanban` calls. That is what makes `approveCard` promote a `not_ready` card to `todo` AND
approve it as one event, and what makes an import of twelve thousand events one write
(§"Importing from Descent").

Two things the seam needs from the caller rather than the verb: `actor`, which defaults to
`'operator'` and rides straight into the event row — no route reads an identity off the request,
because there is none on this board today, and the parameter exists so that adding one later is a
caller change rather than a schema change — and `boardId`, which is a plain string for the
twenty-eight kinds whose board already exists, NULLABLE for the two lesson kinds that may belong to
no board at all (a staged lesson with no card behind it — §"The lessons lane"), and a FUNCTION for
the one kind that creates its board, because `board.created` mints that id inside the transaction and
it does not exist when the spec is written. `payload` takes the same plain-or-function shape for the
same reason: a staged lesson's payload names the id `mutate` just minted, so it too is resolved from
a function rather than written by hand.

The event kinds are exactly: `board.created`, `board.updated`, `board.selected`, `board.archived`,
`card.created`, `card.updated`, `card.moved`, `card.archived`, `card.restored`, `card.approved`,
`card.unapproved`, `tag.added`, `tag.removed`, `question.added`, `question.answered`, `issue.filed`,
`issue.resolved`, `checklist.added`, `checklist.updated`, `checklist.removed`, `attachment.added`,
`attachment.removed`, `lease.build_claimed`, `lease.build_refreshed`, `lease.build_released`, `lease.plan_claimed`,
`lease.plan_released`, `import.descent`, `lesson.staged`, `lesson.reviewed`, `metis.nudged`.

## The services

Eight service files, cut by cohesion rather than one file growing to twenty-nine verbs. Every write
verb takes an optional trailing `context?: KanbanWriteContext` (`{ actor?: string }`); the routes
pass nothing. The lease verbs take an explicit `owner` instead — a lease owner is a different
concept from an event actor, and both ride on the summary.

`kanban-boards.service.ts`

```
createBoard(input: { name, projectId? }, context?) -> KanbanBoard
listBoards(options?: { includeArchived? }) -> { boards, currentBoardId }
getBoard(boardId) -> KanbanBoard | null
updateBoard(boardId, patch: { name?, autonomy?, deepseekFlash?, concurrency?, projectId?, archived? }, context?) -> KanbanBoard
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
(§"The routes"). Nothing in this module spawns that session or reads `deepseekFlash`; the driver
that does both lives beside it, in `server/modules/kanban-metis/` (§"The driver", §"The two
switches").

`kanban-cards.service.ts`

```
listLaneCards(boardId, statuses: KanbanStatus[], options: { limit?, cursor? }) -> { cards, nextCursor }
createCard(boardId, input: { title, priority?, status?, description? }, context?) -> KanbanCardSummary
getCard(cardId) -> KanbanCardDetail
updateCard(cardId, patch: { title?, priority?, description?, body?, plan?, closingRemarks? }, context?) -> KanbanCardSummary
moveCard(cardId, input: { status, afterId?, beforeId? }, context?) -> KanbanCardSummary
archiveCard(cardId, context?) / restoreCard(cardId, context?) -> KanbanCardSummary
addTag(cardId, tag, context?) / removeTag(cardId, tag, context?) -> KanbanCardSummary
plansHeldByLease() -> string[]
addCardTokens(cardId, delta: { tokensIn, tokensOut, cacheRead, cacheCreate }, context?) -> KanbanCardSummary
```

`listLaneCards` is the ONLY place a status list reaches SQL, and it builds its placeholder list
from the array's length — never by interpolating a string. A one-element array is the ordinary
case, not a special one.

`plansHeldByLease` sits outside the CRUD verbs above and outside the `kanbanCardsService` object
itself: the module barrel (`server/modules/kanban/index.ts`) exports it on its own name for one
caller — the plan-runner module's plans-archive sweep, composed once in `server/index.ts` and
called afresh on every pass, never captured, so a lease taken after that module was built still
stops the plan it is on from moving (see [plan-runner.md](plan-runner.md)). It answers every plan
path a live, non-archived card's plan or build lease is holding, fresh by the same staleness
window above, and names no card: an empty list is the ordinary answer on a quiet board.

`addCardTokens` has ONE caller — the token watcher (§"The token watcher"), reaching it as
`kanbanCardsService.addCardTokens` with `actor: 'telemetry'`. It ACCUMULATES: one statement over the
four columns of the shape `build_tokens_in = build_tokens_in + ?`. Never a SET — two Metis sessions
can work one card over its life, and a SET to a session's own totals would erase the earlier one's
spend — and never a read-then-write, which drops an increment whenever a tick races a claim, a move
or another session's tick. It is an ordinary `card.updated` write and costs what any write costs:
one audit row whose payload is `{ tokens: delta }` and one `kanban_event` frame. (Descent's
telemetry wrote no event; this board has no second way to write a card — §"The one write seam".) It
does NOT stamp `updated_at`, because that column orders the Done lane and a token count is not a
card moving. A card deleted between the watcher's read and this write answers the same 404 every
card verb does, and the seam rolls the audit row back with it.

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

`kanban-checklist.service.ts` — checklist items and issues

```
fileIssue(cardId, { text }, context?) -> KanbanIssue
resolveIssue(issueId, { resolvedBy? }, context?) -> KanbanIssue
addChecklistItem(cardId, { text, note? }, context?) -> KanbanChecklistItem
updateChecklistItem(itemId, { state?, text?, note? }, context?) -> KanbanChecklistItem
removeChecklistItem(itemId, context?) -> void
```

The two surfaces are one file because they are one drawer section's worth of state: an issue and a
checklist item are both small rows hanging off a card with no lifecycle beyond theirs. Attachments
used to be the file's third surface; they moved out to their own service (below) because a verb
that has to place a file on disk beside its row is a different subject from a list of text rows.

`kanban-attachments.service.ts` — a card's attachment BYTES, and the row that indexes them

```
attachmentsRoot() -> string                              // KANBAN_ATTACHMENTS_ROOT ?? ~/.cloudcli/kanban-attachments
addAttachment(cardId, { filename, mime, bytes: Buffer }, context?) -> KanbanAttachment
resolveAttachmentFile(cardId, attachmentId) -> { path, mime, filename } | null
removeAttachment(cardId, attachmentId, context?) -> boolean
```

The on-disk layout is Descent's own (`store_schema.py:79-93`, ported): `<root>/<cardId>/<attachmentId>.<ext>`,
the extension taken from a CLOSED mime allowlist (`png`, `jpg`, `gif`, `webp`, `pdf` — no SVG, unlike
the chat-assets route, because this route streams bytes back into the app's own origin) and never
from the client's filename, so nothing the caller names can choose where a byte lands. `addAttachment`
gates in the order `server_api.py:360-399` does — mime, then non-empty, then the size cap
(`ATTACHMENT_MAX_BYTES`, 8 MiB), then a magic-byte sniff against the claimed mime — and writes the
bytes to disk BEFORE it inserts the row, so a failed write never commits a row pointing at nothing.
`removeAttachment` deletes the row and its event inside `writeKanban`'s own transaction first, then
best-effort unlinks the file; an orphan blob left by a failed unlink is not reclaimed by anything in
this repository (Descent's `purge_feature_attachments` was not ported). `resolveAttachmentFile` and
the on-disk path both resolve through `resolveUnderRoot` (`server/shared/utils.ts`), the same
separator-and-resolve containment predicate the global chat-assets folder uses
(`server/modules/assets/services/image-assets.service.ts`) — moved there as a pure extraction so the
one check has one home instead of two copies that could drift apart.

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

`kanban-lessons.service.ts` — `stageLesson`, `listLessons`, `getLesson`, `reviewLesson`,
`approvedIndex`, §"The lessons lane".

## The routes

`server/modules/kanban/routes/` is a PACKAGE, not one file: `board.routes.ts` (9 routes),
`card.routes.ts` (10), `detail.routes.ts` (14), `import.routes.ts` (1), `learning.routes.ts` (5,
§"The lessons lane") and `attachment.routes.ts` (3, below), each exporting a
`create<X>Routes(services): Router` factory; and `kanban.routes.ts`, the FACTORY that builds one
`express.Router()` and `use`s the six onto it. The package is INTERNAL — nothing outside
`kanban.module.ts` imports it, and the module's barrel exports the services and the module
constructor, never a route.

`attachment.routes.ts` is the one file in the package that handles a multipart body and streams a
file rather than parsing JSON — the upload is `multer`, in MEMORY (the service owns where a byte
lands, so the transport never opens one), capped at `ATTACHMENT_MAX_BYTES` through multer's own
`fileSize` limit so an oversized body is cut off as it arrives rather than buffered in full and then
refused, with a `fileFilter` over the same closed mime allowlist the service enforces again on the
bytes it is handed. The download sets `Content-Type` from the STORED mime (never the caller's
filename) and `X-Content-Type-Options: nosniff` — the same pair `assets.routes.ts` already sets, for
the same reason: the browser renders what the row says the file is. This route **replaced** a
metadata-only JSON `POST` that used to live in `detail.routes.ts` (body `{ filename, mime, size }`);
healed means deleted, so that body shape is gone rather than kept beside the new one.

```
GET    /api/kanban/boards                       -> { boards, currentBoardId }
POST   /api/kanban/boards                       { name, projectId? }   -> { board }
PATCH  /api/kanban/boards/:boardId              { name?, autonomy?, deepseekFlash?, concurrency?, projectId?, archived? } -> { board }
POST   /api/kanban/boards/:boardId/select                              -> { currentBoardId }
GET    /api/kanban/boards/:boardId/lanes                               -> { lanes }
GET    /api/kanban/boards/:boardId/claimable                           -> { claimable }
GET    /api/kanban/boards/:boardId/vitals                              -> { vitals }
GET    /api/kanban/projects/:projectId/board                           -> { board }
GET    /api/kanban/events?boardId=&cardId=&limit=                      -> { events }
GET    /api/kanban/boards/:boardId/cards?status=todo,questions&limit=&cursor= -> { cards, nextCursor }
POST   /api/kanban/boards/:boardId/cards        { title, priority?, status?, description? } -> { card }
GET    /api/kanban/cards/:cardId                                       -> { card }
GET    /api/kanban/cards/:cardId/plan-cost                             -> { planCost }
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
POST   /api/kanban/cards/:cardId/attachments    (multipart, field `file`) -> { attachment } | 413 | 422
GET    /api/kanban/cards/:cardId/attachments/:attachmentId             -> the bytes | 404
DELETE /api/kanban/cards/:cardId/attachments/:attachmentId             -> { ok: true } | 404   (403 on the kanban-pm mount)
POST   /api/kanban/cards/:cardId/approve                               -> { card }
POST   /api/kanban/cards/:cardId/unapprove                             -> { card }
POST   /api/kanban/cards/:cardId/build-lease/{claim,refresh,release}   { owner } -> { granted, card }
POST   /api/kanban/cards/:cardId/plan-lease/{claim,release}            { owner } -> { granted, card }
POST   /api/kanban/import/descent               { dbPath? }            -> KanbanImportResult
GET    /api/kanban/lessons?status=&limit=                              -> { lessons }
POST   /api/kanban/lessons     { name, summary, trigger, body?, tags?, cardId?, kind? } -> { lesson }
GET    /api/kanban/lessons/:lessonId                                   -> { lesson }
POST   /api/kanban/lessons/:lessonId/approve                           -> { lesson }
POST   /api/kanban/lessons/:lessonId/reject                            -> { lesson }
```

**`status` on the lane route is a COMMA-SEPARATED LIST**, parsed in the ROUTE into
`KanbanStatus[]`: split on `,`, trim, drop empties, reject the whole request with a 400 if any
member is not one of the five statuses, and reject an empty list too — silently ignoring a bad
member would answer a request for two statuses with one lane. `status=todo` and
`status=todo,questions` are both ordinary. The route — never the service — also clamps `limit` and
parses `cursor` as an opaque string.

`GET /events` clamps `limit` the same way, default 50, max 200. Without the clamp one request can
ask for the board's whole audit log, which on an imported Descent board is twelve thousand rows.

`GET /lessons` narrows to one of `KANBAN_LESSON_STATUSES` and clamps `limit` to `[1, 500]`, refusing
rather than clamping a value outside it — the two reviews are refused on the `kanban-pm` mount, not
on this one (§"The lessons lane").

Success bodies are the bare JSON objects named above. Failures are
`res.status(n).json({ error: '…' })` for a parse failure in the route, and every service failure is
an `AppError` thrown to `next(error)` and rendered by the global handler as
`{ success: false, error: { code, message } }`. Both shapes already coexist elsewhere in this
server; the board adds no third one. `express.json()` is global, so no body parser is added here.

## The frame

`GatewayEventKind` carries `'kanban_event'`, and `KanbanBoardEvent` is declared beside its siblings
in `server/shared/types.ts`, because a gateway kind and its frame belong together. It reads:

```ts
export type KanbanBoardEvent = {
  kind: 'kanban_event';
  boardId: string | null;
  event: { id: number; ts: string; kind: string; cardId: string | null; actor: string };
  card: KanbanCardSummary | null;   // the affected card, fresh, or null for a board-level write
  lanes: KanbanLaneCount[];         // the board's lane totals AFTER the write
  at: number;
};
```

**`boardId` is null for a write made against the ESTATE rather than a board** — a lesson staged
with no card behind it (§"The lessons lane") — and `lanes` is `[]` there, since a boardless write
has no lane totals to carry. Every consumer tests the board id before it trusts the rest of the
frame, so such a frame is inert where it does not apply and still a signal where it does.

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

`src/modules/kanban/` composes the tab's pane, its header — which mounts `KanbanVitalsStrip`, the
board's six counts, its design carried in its own docstring, wired through `useBoardVitals` off a
publish/subscribe store the lane feed keeps rather than a prop the header would have to carry — its
import dialog, the card drawer under
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
toggle takes. That value is read for a decision at every spawn now, by the driver in
`server/modules/kanban-metis/` — and by nothing in this module: it decides which endpoint and which
model that board's Metis opens on, and it reaches every plan-runner she starts (§"The two
switches").

**Boards are GLOBAL, not per project.** The selected board is the single `kanban_settings` row
`current_board`, so switching projects does NOT change the selected board, and no board is
unmounted or refetched when the active project changes. A board's `project_id` is a LABEL — which
project this board is about — never a lane filter: no lane, page, count or event read here is
scoped by it. It is not inert either, and it has not been since the driver landed: it resolves
through `projectsDb` to that project's path and becomes the ONE `--add-dir` this board's Metis is
given, so a board with a null `project_id` hands her no directory at all and she works only inside
her own session directory (§"A board's Metis, launched"). `projectId` reaches the panel for exactly
one purpose: **on FIRST mount only, when `currentBoardId` is null, the panel asks
`boardForProject(projectId)` and selects that board if one comes back.** That is a first-run
convenience and nothing more — it fires at most once per mount, it never fires when a board is
already selected, and it never fires on a project switch.

**Lazy loading.** On mount the panel fetches the board list, then the current board's lane counts
and its vitals together (`Promise.all`, `useKanbanLaneFeed.ts`). Each lane then fetches its OWN first
page of summaries for the status set its lane spec names. A card's DETAIL is fetched only when the
drawer opens on it. The one extra first-mount call is `boardForProject`, above. The vitals read
repeats after every lane-counts write that lands — coalesced behind one in-flight request rather than
a timer of its own — and reaches the strip through the small publish/subscribe store that file keeps,
never through this hook's own returned state; the shape is in the file's own docstring.

**The vitals strip's six registers, in ONE round trip.** `vitalsCounts`
(`kanban-vitals.service.ts`) answers the header's strip from five scalar sub-SELECTs in one
statement, every one of them excluding archived cards:

- `building` — cards in the Building lane (`status = 'active'`), where a build lease puts them and
  where they stay until the builder moves them on.
- `awaitingAnswer` — cards with at least one question nobody has answered: the operator's turn, and
  the panel's own `needsAnswer`.
- `awaitingApprove` — the SAFE approve subset (Descent's "GOTCHAS #48" mirror): not yet approved, no
  open question, sitting in a claimable/staging lane (`todo`/`questions`/`not_ready`), and
  content-complete — a non-blank plan, body or description, because an intake card carries its intent
  in `description` with `body` empty.
- `claimable` — the same predicate and the same staleness window the driver's own green light uses
  (`kanbanBoardsDb.countClaimable`), so this register and the driver can never disagree.
- `lessonsPendingEstate` — STAGED lessons awaiting a person's review. It reads the board's own lesson
  table and is NOT board-scoped: a lesson belongs to the estate and its card is provenance, so there
  is no board filter here to get wrong.
- `memoryPendingEstate` — handed IN by the composition root rather than computed here, because the
  rows behind it are `memory_candidates` and this module never imports `memory-intake`: the board
  cannot see that lane's table, and a count it computed for itself would be the board reading a
  sibling's rows sideways (§[memory-intake.md](memory-intake.md)).

Every estate-wide key carries the word ESTATE in its name, so no caller can read a number taken across
the whole install as one board's own. The read is read-only — no transaction, no audit row, no frame —
and a missing board is the board's ordinary 404, never zeros: "no such board" and "a board with
nothing on it" are different answers. A fault is NOT caught, and that is the ruling rather than an
omission: the strip draws an unknown reading as an em-dash, and the wire shape has no null to say
"unknown" with, so a refusal is the only honest way this read can say "I could not count".

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
names, plus the columns of two OPTIONAL satellite tables, `ov_lessons` and `ov_memory_candidates`,
checked only when the table is there — before a single row is read, so the wrong file and the
older-Descent file are both a 404 naming what is missing rather than a driver error four tables
deep. The two satellites' ABSENCE is never what the 404 is about: a Descent old enough to predate
either is still a board worth importing, since they are an INSTALL's satellites rather than a
board's spine. A file holding no boards is refused rather than imported, because every card is a
board's child. It reads each table one pass into typed row arrays, resolves
`descentAttachmentsRoot` from the directory of the database it actually opened — Descent keeps its
bytes beside its database — closes the handle in a `finally`, and writes NOTHING, maps nothing and
has never heard of a `kanban_` table. The source file is never written.

**`kanban-import.service.ts`** calls the transport, maps the rows and hands the whole mapping to the
write seam as ONE `mutate` callback under the `import.descent` kind — which is why an import is one
event and one frame, and why a failure anywhere in the mapping rolls the whole import back: there is
no such thing as a half-imported board. Mapping, table by table: `ov_boards`→`kanban_boards`,
`ov_features`→`kanban_cards`, `ov_tags`→`kanban_card_tags`, `ov_questions`→`kanban_questions`,
`ov_issues`→`kanban_issues`, `ov_decisions`→`kanban_decisions`,
`ov_checklist_items`→`kanban_checklist_items`, `ov_attachments`→`kanban_attachments`,
`ov_events`→`kanban_events`, `ov_lessons`→`kanban_lessons`. Ordering inside the transaction follows
that list — parents before children — and an `ov_events` row whose `feature_id` no longer resolves
is imported with `card_id` null rather than dropped, because Descent's log carries no foreign key
there. A lesson's `feature_id` is translated the same way and for the same reason: a lesson
OUTLIVES the card it was learned on (§"The lessons lane"), so one naming a card this board never
imported still lands, with a null card rather than being dropped.

**Descent's memory proposals are NOT a board table.** `ov_memory_candidates` rows go straight to the
memory-intake lane's own `importDescentCandidates` ([memory-intake.md](memory-intake.md) §"The native
module") rather than through a `kanban_` table — no board, no card, no lane, no frame — and this
mapping keeps only the count it reads back. `KanbanImportCounts` (`server/shared/kanban-types.ts`)
therefore carries `lessons` and `memory` beside the nine board tables: `lessons` is one more row
landed in `kanban_lessons` exactly like every table above it, and `memory` is that count read back
from the lane that owns the table. Nothing is refused for a `target` this lane's own staging door
would reject — an import hands over what an operator already lived with, not a fresh proposal.

**The imported attachments' BYTES are copied once the transaction has committed, never inside it.**
The mapping only PLANS the copy — a source path under the imported install's own attachment root
and a target path under this board's, both derived from ids rather than from anything the source
file sent — because a write seam holding its lock across an install's worth of file I/O would stall
every other writer on the board. `KanbanImportResult.attachmentCopies` carries that plan out as an
obligation; the route (`import.routes.ts`) discharges it with `placeAttachmentBytes`
(`kanban-import-satellites.ts`) between the write and the answer, so "imported" means the corpus is
on disk and not merely promised. It is never fatal: a source file the old install no longer has is a
line in the server log, not a failed import.

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

and the same shape, on `kanban_boards.updated_at`, for boards. A card edited in Athena after its
last Descent change therefore survives a second import untouched; one Descent changed more recently
is refreshed. A `DO UPDATE` whose `WHERE` is false is not an error and not a conflict — SQLite
simply skips the row — so the import completes and the counts still reconcile: a card the guard
held is counted as neither an insert nor a refresh. The CHILD tables stay full upserts with no
guard, deliberately: they carry no local editing surface here, and a partially guarded child would
leave a card's questions half from each side. The lessons landing beside them are no exception, even
though a lesson CAN be reviewed here: the source is still the whole truth about a row that carries a
`descent_id`, so a re-import refreshes `status` and `reviewed_at` together and a review performed
here does not outrank the install it was imported from. Memory candidates follow the identical rule
for the identical reason ([memory-intake.md](memory-intake.md) §"The native module").

**One setting is imported, and eighteen are not.** `ov_settings` holds the key `current_board`,
which is translated through the board id map and written to `kanban_settings`; the rest are
Descent daemon state — `mcp_active_pid`, `notif_ingest_keepalive`, `pm_capacity_governor`,
`schema_version`, `theme` and their siblings — and are skipped. One `import.descent` event is
recorded with the counts as its payload.

The result is what the dialog shows: source counts against imported counts per table, `inserted`
and `updated`, the board id map, and the current board. `attachmentCopies` never reaches it — the
route destructures the obligation off the result, discharges it with `placeAttachmentBytes`, and
answers with the rest, so the shape on the wire says what landed rather than a foreign install's own
on-disk paths.

## The lessons lane

A lesson is a note worth carrying into a future session — staged by whoever learned it, reviewed by
a person, and read again only once approved. `kanban-lessons.service.ts` is the ported form of
Descent's `store_lessons.py` / `store_actionable.py`; its own docstring carries the design in full,
and this is the map onto the routes and the fence around it.

**Five verbs, `ls-` ids.** `stageLesson` inserts a row at `status: 'staged'` (event `lesson.staged`)
after validating any `cardId` it names against a real card; `listLessons` and `getLesson` are the
lean index and the by-id read; `reviewLesson` moves a `staged` row to `approved` or `rejected`
(event `lesson.reviewed`) under a compare-and-set, so two reviewers racing one lesson cannot both
win; `approvedIndex` is `listLessons({ status: 'approved', limit: 50 })` under its own name — the
same call `GET /lessons?status=approved&limit=50` reaches, and the one `list_actionable`'s
`lessons` key now carries (§"The kanban-pm MCP surface"). `staged` and `rejected` rows reach a
session only through `list_lessons` / `get_lesson` / `search_history`, never through the orient
read.

**A lesson belongs to the ESTATE, not to a board.** `cardId` is nullable provenance: a lesson with
no card writes a `kanban_events` row whose `board_id` is `NULL`, which is why `KanbanWriteSpec`'s
`boardId` (§"The one write seam") is nullable now rather than only a plain string or a function. A
lesson that DOES name a card lands in that card's own board. A `kind: 'skill_draft'` lesson also
writes its body to a `.SKILL.md` file under `~/.cloudcli/pending-skills/`, through the write seam's
`afterEvent` step — after the audit row is in, so a failed append leaves no orphan file behind.

**The routes** — `GET`/`POST /api/kanban/lessons`, `GET /api/kanban/lessons/:lessonId`, and the two
reviews (§"The routes") — live in `learning.routes.ts`, mounted on BOTH kanban doors: the operator's
own `/api/kanban` and the child's `/api/kanban-pm`. The route file carries no mount-specific logic
and does not know which door served a given request.

**The review is the fence, and it is not enforced in the route.** Approving or rejecting a lesson is
a PERSON's act — a build stages, it never promotes its own note — so the refusal lives one layer
out, in `kanban-metis.routes.ts`'s `kanbanMetisSecretGuard`: a request whose decoded path matches
`REVIEW_PATH` (`/lessons/<id>/(approve|reject)`) is refused `403` before the router ever sees it,
the same way that guard already refused the importer (§"The kanban-pm MCP surface" §"The second
door, and the child's credential"). Staging and reading are ungated on that mount — filing a lesson
and reading the corpus are exactly what a build is for.

**Reviewed from the Memory tab, not from the board.** The two review routes' one caller in this app
is `LessonReviewList` ([memory-intake.md](memory-intake.md) §"Beneath the queue, the lessons") — a
section of the Memory tab rather than a control on the board itself, the same estate-not-board
placement above. It reads the staged list at the route's own ceiling through `useLessonReview` and
calls the two review verbs through the same hook.

**Reachable from a tool call, as of Phase 7.** The MCP surface's `stage_lesson`, `list_lessons` and
`get_lesson` are real tools now (§"The kanban-pm MCP surface") — `kanban-pm-tools-lessons.ts` is
the wiring from a Metis's own tool call to the store and HTTP doors this lane built.

## The driver

`server/modules/kanban-metis/` is the machine that drives the verbs above: it launches one Metis
per board, keeps a registry of them, reaps what has died, and feeds the panel. It reaches the board
only through `server/modules/kanban/index.ts`'s barrel (`kanbanBoardsService`, `kanbanCardsService`)
— never a route, a repository or an internal service. It is Descent's daemon ported in-process:
`metis-driver.service.ts` is `~/.claude/descent/pm_capacity.py`'s `tick_once` and `metis-liveness.ts`
is that daemon's `_reapable` / `stalled` pair, kept as pure arithmetic over four facts the caller
gathers — the session's age, `child.log`'s mtime, whether the child is still alive, and whether its
owner still holds a fresh lease. The decision that ends in a SIGTERM is readable without a running
server, which is the point of that split.

One `setInterval`, and inside every tick exactly ONE order — **reap, then spawn**:

1. **Reap.** Take the live set, mark the children that have exited, and retire every session a
   liveness proof names — `child-gone` first, then `stalled`, then `quiescent`. A session younger
   than `QUIESCE_MIN_AGE_MS`, or one whose lease-holder scan could not be completed, is left alone:
   doubt always resolves to "still working", because the other direction kills a live build.
2. **Spawn.** ONE live snapshot, taken after the reaper has closed what it closed, then per board:
   an archived or `autonomy = 0` board is skipped outright; a launch already in flight for that
   board blocks a second (two children in one cwd is what that guard exists to stop); then
   `live < concurrency`; then the board's churn cooldown has elapsed; then the API rate-limit hold
   (`rateLimitHold` — a cap that is live right now would kill the child on her first turn); then the
   board's relaunch ledger (`shouldRelaunch` — a board whose launches keep THROWING is retried on a
   doubling backoff and then not at all); and only then `claimableCount(boardId) > 0` — the one
   question that costs a query is asked last.

The order is not a style choice. Spawn first and a board overshoots its own dial every time a
session is dying: the tick would fill a slot the reaper is about to free, and the board would run
two Metises for one dial.

The dials — four liveness, beside the predicates that read them; three cadence, beside the tick:

| Constant | Home | Value | What it decides |
|---|---|---|---|
| `QUIESCE_MIN_AGE_MS` | `metis-liveness.ts` | 300 000 | nothing is reap-eligible before five minutes; a just-launched Metis is mid-orient |
| `QUIESCE_QUIET_MS` | `metis-liveness.ts` | 180 000 | a `child.log` silent this long is a turn that ENDED |
| `STALL_MS` | `metis-liveness.ts` | 2 700 000 | silent this long is a turn that WEDGED — the stronger proof, and the one reported first |
| `LEASE_STALE_SECONDS` | `server/shared/kanban-types.ts` (**40**), re-exported by `metis-liveness.ts` | 40 | the same staleness the lease verbs and the card summaries use; the reaper judges a board's PLAN lease with it too, so no second staleness rule exists |
| `TICK_MS` | `metis-driver.service.ts` | 15 000 | the loop's whole cadence, and the longest a click on Launch can wait |
| `kanban_boards.concurrency` | the board's own row, clamped by `clampKanbanConcurrency` in `server/shared/kanban-types.ts` | `KANBAN_CONCURRENCY_DEFAULT` 1, clamped `[0, KANBAN_CONCURRENCY_MAX]` (6), moved 1–6 by the pilot panel's stepper | how many sessions THIS board may run at once, read off the row at call time by the driver's `dialOf` and the spawner's `canSpawn` alike — never a driver-held constant; 0 is the dial switched off |
| `CHURN_COOLDOWN_MS` | `metis-driver.service.ts` | 60 000 | PER BOARD, never global — a global one lets one busy board's spawns starve every other board, and this window is what stops a board whose work cannot actually be claimed from being respawned every tick |
| `RELAUNCH_MAX_ATTEMPTS` | `metis-relaunch.service.ts` | 3 | launches for one board that THREW before the driver stops retrying it; a session of that board reaching a COMPLETED ending clears its row |
| `RELAUNCH_BACKOFF_BASE_MS` / `..._CAP_MS` | `metis-relaunch.service.ts` | 600 000, doubling, capped at 3 600 000 | how long a board waits after each recorded failed launch |
| `RATE_LIMIT_GRACE_MS` / `..._BLIND_HOLD_MS` / `..._RESET_BUFFER_MS` | `metis-relaunch.service.ts` | 120 000 / 1 800 000 / 30 000 | the hold armed by `notify_api_error.sh`'s signal: a short grace on a `reset_at` that has passed, the long window when the signal carries none, and the margin added to a future one |

`GET /api/kanban-metis/boards/:boardId/driver` answers the tick's own arithmetic for one board —
`{ autonomy, concurrency, concurrencyMax, claimable, live, lastSpawnAt, rateLimitUntil, relaunchAllowed }` — because
"nothing to do", "the driver is not running", "the cooldown is holding it", "the account is capped"
and "this board has spent its relaunch attempts" all look the same from outside, and each has a
different fix. The last two are the SAME predicates the spawn path asks, so the route cannot explain
a board differently from the way the tick treats it.

The eight routes, all behind `authenticateToken` on the mount (`server/index.ts:229`):

```
GET  /api/kanban-metis/sessions                          -> { sessions, at }
GET  /api/kanban-metis/boards/:boardId/driver            -> { autonomy, concurrency, concurrencyMax, claimable, live, lastSpawnAt, rateLimitUntil, relaunchAllowed }
POST /api/kanban-metis/boards/:boardId/launch            -> { session }
POST /api/kanban-metis/boards/:boardId/nudge             -> { nudged: true, at }
POST /api/kanban-metis/sessions/:sessionId/stop          -> { session }
POST /api/kanban-metis/sessions/:sessionId/resume        -> { session }
POST /api/kanban-metis/sessions/:sessionId/reply         { text } -> { session }
GET  /api/kanban-metis/sessions/:sessionId/transcript    -> SubagentTranscriptResult
```

**The reply route** answers a session whose child has already stopped with a person's own words as
the turn she wakes up to: a 422 when `text` is empty, a 409 naming the reason otherwise —
`she is mid-turn — stop her first, then reply` when her child is still running, or the board's own
dial in the words `canSpawn` (`metis-spawn.service.ts`) refuses with, when there is no room for the
child a reply spawns. It is `resume` with one difference — the turn — and both share the same dial
gate on the way in.

The transcript route has no service of its own. The board MINTS the session id, so the identity is
the whole mapping — there is no launch-to-session translation to perform. Knowing the id is the
authorization (the registry has to hold it) and the read itself belongs to `providers`:
`readClaudeTranscriptBySessionId` falls back to `scanProjectsRoot` when the sessions table holds no
row, and for a board session that fallback is not an edge case but the ONLY path (§"Seclusion").

**The nudge** is Descent's "Nudge Metis" against a loop rather than a sleeping daemon: it records a
`metis.nudged` event on the board (through `kanbanBoardsService`, so it lands in the audit log and
on the wire like every other act) and schedules `driver.tick()` on the NEXT MACROTASK, then answers
`{ nudged: true, at }` immediately — a reap plus a spawn can take seconds, and the caller pressed a
button. The **relaunch ledger** lives at `<KANBAN_METIS_STATE_ROOT>/relaunch-ledger.json`, one row
per board (`{ attempts, lastAt }`), written atomically; the **rate-limit signal** it is read beside
is `~/.cloudcli/rate_limit.json`, written by `~/.claude/hooks/notify_api_error.sh` and redirected
by `CLOUDCLI_RATE_LIMIT_PATH` (`{ last_rate_limit_at, reset_at }`, epoch seconds).

**The state frame.** `kanban_metis_state` (`{ kind, sessions: KanbanMetisSession[], at }`) is
broadcast to every open `/ws` socket on the shared polled-lane cadence (2 s, `createPolledLane`) —
the same loop the plan-runner and launcher-souls lanes run
([plan-runner.md](plan-runner.md) §"What the runner writes, and where"). The panel seeds from
`GET /sessions` for the case a frame cannot cover: a page mounting while nothing is moving. A
session record carries `sessionId`, `boardId`, `boardName`, `provider` (`'deepseek' | 'claude'`),
`model`, `owner`, `launchedBy` (`'operator' | 'driver'`), `state` (`'running' | 'completed' |
'stopped' | 'failed'`), `pid`, `startedAt`, `endedAt`, `lastActivityAt` (the `child.log` mtime) and
`exitCode`; the type lives in `server/shared/types.ts` beside `SoulLaunchSnapshot` and is mirrored
into `src/shared/types.ts`.

## The token watcher

`metis-telemetry.service.ts` is `~/.claude/descent/pm_telemetry.py` ported in-process: the module's
second interval, started once beside the driver's — `startTelemetryWatcher()`, called at
construction in `kanban-metis.module.ts` after the registry and the driver exist. It ticks at once,
so a build already in flight at boot starts accruing on the first pass, and then every
`TELEMETRY_TICK_MS` (30 000). The interval is unreferenced, like the driver's, and a second call is
a no-op rather than a second watcher over the same tallies. It has no route and no frame of its own;
what it leaves behind is the `kanban_session_usage` row and the card's four `build_tokens_*`
counters (§"The tables"), which the card face's token signal and the drawer's token ledger read
(§"The panel"). Its service header carries the design in full; this is the map, and the three rules
that must not move.

**What it reads.** Every session the registry holds in state `running` — and only those, so what a
session spends between its last tick and its exit is not counted: at most one tick's worth, and
never a double count. For each, the transcript `~/.claude/projects/<cwd slug>/<sessionId>.jsonl`
PLUS every subagent transcript beside it, `<cwd slug>/<sessionId>/subagents/agent-*.jsonl`:
subagents log separately, and a main-file-only tally undercounts badly. The directory is found by
scanning the projects root once per session, and for a board Metis that scan is the ONLY path — she
has no `sessions` row (§"Seclusion").

**How it counts.** `accumulateUsage(jsonlPath, fromOffset)` is the stateless one-shot reading —
`{ tokensIn, tokensOut, cacheRead, cacheCreate, seen, offset }` — and a tick reads through a
per-file tally it keeps in memory instead (a byte cursor, a `seen` set, the running counters),
because the one-shot holds no dedup state and a range read twice is counted twice.

- **Dedup on `message.id`, never on the line.** One assistant message spans several JSONL lines, one
  per content block, and every one repeats the message's whole `usage`; summing lines counts a
  message two or three times. The `seen` set persists across ticks, so a message split over a tick
  boundary still counts once. A usage-bearing line with no id is counted rather than dropped.
- **The cursor moves only past a newline.** What follows the last complete line is a half-flushed
  write: it is re-read whole next tick — never parsed as JSON, never dropped. A file that shrank
  restarts from zero.
- **The stored row is the truth, never memory.** The tallies reset on a restart and the next tick
  re-reads each transcript from byte 0, once, so the step is `delta = max(fresh, stored) − stored`
  per counter: zero after a restart, never negative, and only new spend is ever written.

**Where a delta lands.** The session row first — it is the baseline the next tick subtracts from —
through `kanbanLearningDb`, silently: no event, no frame. Then the card, best-effort, through
`addCardTokens` (§"The services"), the only half of this the board hears. A delta goes on a card
only when the session's derived lease owner (§"A board's Metis, launched") holds a FRESH build lease
on an `active` card of its own board (§"Ids, order and time"), found by paging that board's lanes
through the barrel, at most `LEASE_SCAN_PAGES` (25) pages. A session between cards — orienting, or
holding a lease that went stale — and a board too long for that scan both attribute nothing on that
tick, and the spend stays at the session level: a smaller loss than a number written onto a card
nobody is building. A tick whose four deltas are all zero writes nothing at all.

**It never raises.** The registry read has its own guard and so does each session, so one corrupt
transcript or a locked database ends neither the interval nor the sessions behind it. Each distinct
fault is written to the server log once, as `[KanbanMetis] telemetry: …`, not once per tick.

## A board's Metis, launched

`metis-spawn.service.ts` starts her, and it is the only file in the module that starts a process.
There is no policy in it: WHEN to spawn is the driver's question, and this one answers HOW.

- **Identity is minted by the server**, never by the child: a uuid handed over as `--session-id`,
  and the same uuid again as `--resume` when a session is continued.
- **The lease owner is DERIVED, never minted** — `sha256(sessionId).hex().slice(0, 16)`, sixteen
  lowercase hex, handed to the MCP child as `KANBAN_PM_OWNER`. A minted token lives only in the
  process that minted it, so a resumed or re-adopted Metis would come back unable to refresh the
  leases she already holds and would be reaped by her own stall rule. A derived one is the same
  sixteen characters every time that session id is seen, by any process, after any restart.
- **Her cwd is `~/.claude/kanban-metis/<boardId>/`**, a directory the driver creates. That path is
  not decoration: it is exactly what the seclusion predicate keys on (§"Seclusion"), so a launch
  that put its child anywhere else would pollute the operator's session list with a row per build.
- **Her session home is `~/.claude/state/kanban-metis/<sessionId>/`**, in the layout
  `~/.claude/state/dispatch-souls/<launch id>/` uses, deliberately, so liveness reads the same shape
  it already knows: `spec.json`, written BEFORE the child exists and recording the composed brief's
  path and sha256 and the opening turn VERBATIM, so a reader months later knows what she was
  actually asked and a resume sends the same words; `result.json`, the ending, written by the
  parent's exit handler while the server is alive and by re-adoption when it is not — never by the
  child; `child.log`; `child.pid`.
- **The child owns its own log — the parent pipes nothing.** She is detached and outlives the
  server, so a piped stdout is a contradiction: the moment the server restarts, the read end is gone
  and a full 64 KB pipe buffer blocks her mid-build (or kills her on `EPIPE`), while `child.log`'s
  mtime freezes — which the quiescence rule would then read as a finished turn. So the log's file
  descriptor IS her stdout and stderr (`stdio: ['pipe', fd, fd]`), and the parent closes only its
  own handle.
- **Argv**, in `~/.claude/hooks/plan_runner/souls.py`'s shape:

```
claude -p --output-format stream-json --verbose --permission-mode bypassPermissions
       (--session-id <uuid> | --resume <uuid>)      # exactly one, never both
       --model <deepseek-flash | opus>
       --append-system-prompt <the brief>
       --mcp-config <one JSON string naming kanban-pm> --strict-mcp-config
       [--add-dir <the board's project path>]
```

  `--session-id` mints a conversation and `--resume` continues one; a child handed both is a child
  arguing with itself, so exactly one is present on any spawn. `--strict-mcp-config` is what makes
  `kanban-pm` the ONLY MCP she can see: no `descent-pm`, no user-scope servers. `--add-dir` is
  DERIVED from the board rather than enumerated — `project_id` through
  `projectsDb.getProjectPathById` becomes ONE directory, and a board whose `project_id` is null gets
  NO `--add-dir` at all, so she works only inside her own cwd.
- **The opening turn.** The brief is the system prompt; it is not a turn, and `claude -p` with
  nothing written to stdin waits for input forever. One literal string goes in, then EOF:

```
Work board `<boardId>`. Call `list_actionable`, take the top claimable card, and end the turn
when nothing is claimable.
```

- **Her environment** is `userFacingEnv(extra)` from `server/shared/child-env.ts` — the server's own
  environment minus the variables that describe the server process. That subtraction is not
  cosmetic: measured 2026-09-11, a plan-runner started from an app session inherited the server's
  `TSX_TSCONFIG_PATH`, ran a probe through `tsx`, and died with `ERR_MODULE_NOT_FOUND '@/modules'`
  because every `@/…` resolved against the SERVER's folder — and a Metis who starts plan-runners is
  exactly that path. `metis-env.service.ts` never spells `process.env`: what it needs arrives as
  parameters, and the extras it hands over are `MAIN_SHELVES_LOADER_DISABLE=1` (the shelves loader's
  own bypass: a Metis is a new session and the operator's shell shelves are not hers),
  `KANBAN_METIS_BOARD_ID`, `KANBAN_METIS_SESSION_ID`, `PLAN_RUNNER_DEEPSEEK_FLAG_PATH`, plus the
  DeepSeek pair when the board's switch is on (§"The two switches").
- **Stopping** is a SIGTERM with a 15 s deadline and an escalation after it: enough for the CLI to
  finish the tool call it is in and write its result, short enough that a Metis ignoring the signal
  cannot sit on a lease the driver believes is free.

## The kanban-pm MCP surface

A Metis works her board through `kanban-pm`: the server name is `kanban-pm`, the client-facing
prefix is `mcp__kanban-pm__<tool>`, and the twenty-five tool names are IDENTICAL to `descent-pm`'s,
deliberately — the brief's prose and the hook matchers port by changing the server word alone.

**It is a LEAF.** `kanban-pm-mcp.ts` is a `#!/usr/bin/env node` stdio program, with its tools under
`server/modules/kanban-metis/mcp/`, and it hand-rolls newline-delimited JSON-RPC 2.0 over
stdin/stdout — **no new dependency**, the way Descent's own `mcp_server.py` is built. Everything
under `mcp/` imports only from `mcp/`, from `node:` builtins and from `server/shared/`: never the
module's own barrel, never `@/modules/*`, never a service. It runs as a separate PROCESS with no
server in it, so an import reaching back into the module would drag a database handle, a router and
a websocket fan-out into a stdio child that must start in milliseconds. `cli.service.ts` starts it
under the verb `kanban-pm-mcp`, and the command is resolved through ONE shared resolver —
`server/shared/mcp-command.ts`'s `resolveMcpCommand` (`dist` `.js` first, then
`node_modules/.bin/tsx` + the `.ts` source, then the `cloudcli` bin) — with two callers and one copy.

**It reads four variables and nothing else:**

```
KANBAN_PM_API_URL     the running server's own origin     (required)
KANBAN_PM_TOKEN       a bearer, sent as Authorization     (required)
KANBAN_PM_BOARD_ID    e.g. b-90                           (required)
KANBAN_PM_OWNER       16 lowercase hex, the lease owner   (required)
```

`KANBAN_PM_API_URL` is resolved ONCE, in `kanban-metis.module.ts` at construction, from the port
this process is actually listening on (`SERVER_PORT` ‖ `PORT` ‖ `3001`) and never from a constant:
two servers share one database on this box, and a child sent to the other one would write the right
rows through the wrong process, so its frames would reach nobody. An explicit `KANBAN_PM_API_URL`
already in the server's environment is honoured as an override seam and nothing else. Every tool is
one or more calls to the board's own HTTP verbs: this program opens no database and imports nothing
from `server/modules/kanban/`.

**The twenty-five tools, and the board verb behind each.** Reads first:

| Tool | Board verb |
|---|---|
| `list_features` | `GET /boards/:b/cards?status=…` across the five statuses, `+ GET /cards/:id` for tags |
| `list_features_all` | the same, once per non-archived board from `GET /boards` |
| `get_feature_plan` | `GET /cards/:id` |
| `open_design_questions` | `GET /cards/:id`, its `questions` |
| `get_learned_selections` | `GET /cards/:id` decisions, filtered by `tags`/`q` |
| `list_actionable` | `GET /boards/:b/lanes` + the `todo` / `questions` / `active` pages; `lessons` is the approved index, `GET /lessons?status=approved&limit=50` |
| `list_active_builds` | `GET /boards/:b/cards?status=active`, `is_stale` from `leaseState`, `is_mine` from the owner |
| `search_history` | `GET /events?boardId=` + a substring pass over card titles, descriptions, bodies and closing remarks, and — when `lesson` is among the kinds asked for — `GET /lessons` then one `GET /lessons/:id` per hit, capped at the caller's own `limit` |
| `list_lessons` · `get_lesson` | `GET /lessons?status=&limit=` · `GET /lessons/:id` |

Writes:

| Tool | Board verb |
|---|---|
| `create_feature` | `POST /boards/:b/cards` then `POST /cards/:id/tags` per tag |
| `attach_plan` | `PATCH /cards/:id { plan, body }` |
| `post_design_questions` | `POST /cards/:id/questions` per question, then `POST /cards/:id/move { status: 'questions' }` |
| `answer_design_question` | `POST /questions/:qid/answer { selected, other }` |
| `set_status` | `POST /cards/:id/move { status }`, and on `active` also `POST /cards/:id/build-lease/claim { owner }` |
| `set_tags` | `GET /cards/:id`, then `DELETE`/`POST /cards/:id/tags` to reach the named set |
| `file_issue` | `POST /cards/:id/issues`, then `PATCH /cards/:id { plan: '' }` and `POST /cards/:id/move { status: 'todo' }` |
| `resolve_issue` | `POST /issues/:iid/resolve` |
| `archive_feature` | `POST /cards/:id/archive` |
| `set_checklist` | `DELETE /checklist/:k` for each existing item, then `POST /cards/:id/checklist` per text |
| `set_checklist_item` | `PATCH /checklist/:k { state, note }` |
| `set_closing_remarks` | `PATCH /cards/:id { closingRemarks }` |
| `approve_feature` | `POST /cards/:id/approve` |
| `claim_plan` | `POST /cards/:id/plan-lease/claim { owner }` |
| `stage_lesson` | `POST /lessons` |

**The one cross-board read — and what it does not grant.** `list_features_all` is the only tool whose
reach exceeds the board the child was launched on: it reads `GET /boards` and then every NON-ARCHIVED
board's lane pages, pushing each card with its own `board { id, name }`, so she can put her own board
first and see what else is moving. The widening is sight, never REACH — no tool takes a board id, and
every write (`create_feature`, `set_status`, `claim_plan` and the rest) addresses `client.boardId`, the
single board in `KANBAN_PM_BOARD_ID`. A card on another board can be read and is never claimed from
here, because her `cwd` and her one `--add-dir` are her board's (§"A board's Metis, launched"). The
descriptor says the rest: read-only, and it does not change which board is current.

**The lesson tools are real, as of Phase 7.** `stage_lesson`, `list_lessons`, `get_lesson` and
`search_history`'s `lesson` kind all reach the store this lane built (§"The lessons lane") — the
three straight reads/write live in `kanban-pm-tools-lessons.ts`, and the fourth is
`kanban-pm-recall.ts`'s `searchLessons`, which opens one lesson body per hit, capped at the
caller's own `limit` and reported back as `lessons_read` / `more_lessons`. The honest-stub
sentence (`lessons are not on this board yet…`) is gone from the code now that the wiring landed.
`get_learned_selections` was never a stub: the board has kept `kanban_decisions` since this lane,
and answers from them regardless.

**The lease heartbeat lives in the MCP process**, not in the driver, because the lease verbs are
compare-and-set on the owner and a refresh from a process that is not acting as that owner defeats
the CAS. A `setInterval` at **10 000 ms** (Descent's own `HEARTBEAT_SECS`) refreshes the build and
plan leases it holds. The in-memory list of claimed ids is an OPTIMISATION only: the owner is
derivable, so a process that lost that list can still re-read `list_active_builds` and refresh what
is its own.

**The second door, and the child's credential.** `app.use('/api/kanban-pm', kanbanMetisSecretGuard,
createKanbanModule(kanbanReadings))` at `server/index.ts:240` mounts the board's own router a second time, so the
child reaches the same services over the same verbs behind a different door, and NO verb is
duplicated for it. The credential is derived, never stored:

```
secret = HMAC-SHA256(<the app's jwt_secret>, sessionId)  ->  hex
```

The child carries `<sessionId>.<digest>`; the guard recomputes that HMAC for the session id the
bearer claims and accepts it only while the registry holds that session id in state `running`.
Nothing is kept in memory between restarts — a map in memory is a map that empties on restart, and
every live Metis's next tool call would then 401 against a server that had simply forgotten her,
mid-build, with no way back but to kill her. Revocation is the registry's `running` set: a session
that leaves it stops being accepted on its next call, and nothing has to be erased. The guard also
denies the importer at the door: any path matching `/import/` is refused `403` before the router
sees it, because `POST /api/kanban/import/descent` reads a foreign database and can rewrite four
hundred cards in one transaction, and no autonomous session has business calling it. **The same
guard refuses a lesson review** — any path matching `/lessons/<id>/(approve|reject)` — ahead of the
credential check, because reviewing is a person's act and whose credential arrived is not the
question (§"The lessons lane"). **And the same guard refuses one method, not a path** — a `DELETE`
whose decoded path matches `/cards/<id>/attachments/<id>` — because staging a lesson and adding an
attachment are both how a build records its work, but destroying an operator's uploaded bytes is not:
the row's deletion is an audit line, the file is simply gone, and no lease CAS undoes an `rm`. Reading
and uploading an attachment stay open on both mounts. The operator's own authenticated mount still
carries all three verbs.

## The brief

A Metis's system prompt is assembled at spawn from
`server/modules/kanban-metis/brief/METIS.md` plus
`server/modules/kanban-metis/brief/chapters/{autonomy-cadence,learning,mcp-fallback,parallelism,plan-template,recovery}.md`,
resolved at runtime through `findApplicationRoot(getModuleDirectory(import.meta.url))` — so it reads
from the source tree whether the server runs under `tsx` or from `dist-server`. The chapters are
concatenated under their own headings into ONE string and handed over as a single
`--append-system-prompt`; its path and sha256 are recorded in `spec.json`, and a resume re-reads the
brief from disk, so a resumed Metis runs the board as it stands now rather than as it stood when she
was first launched. `~/.claude/descent/pm-chapters/` is the retired Descent board's and
is not touched by any of this — the board has its own brief, its own chapters and its own home.

**The brief is the same for every board; what is true of ONE project is not in it.** A database
connection, the vendor systems a build must not write to, who receives a notification, which repos
a checkpoint covers — these reach a Metis as `CLAUDE.md` files, from two places. The board's
project arrives as `--add-dir`, and the child's environment carries
`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` (`metis-env.service.ts`), which is what makes the
CLI read the `CLAUDE.md` of an added directory. And her cwd, `~/.claude/kanban-metis/<board id>/`,
is read the way any cwd is: a `CLAUDE.md` placed there is that board's own file, outside this
repository. A board with no project and no such file runs on the brief alone.

## Seclusion

**The synchroniser refuses to ENROL a board session's transcript, so no row is ever created.** One
predicate, in one place — `claude-session-synchronizer.provider.ts`, in `processSessionFile`,
immediately after the transcript's own `cwd` has been parsed:

```ts
export const KANBAN_METIS_SESSION_ROOT = path.join(os.homedir(), '.claude', 'kanban-metis');
// inside processSessionFile, right after projectPath is read:
if (isUnder(projectPath, KANBAN_METIS_SESSION_ROOT)) return null;
```

It is keyed on the authoritative `cwd` and on nothing else — never on the file path, because a
path-shaped test would have to guess the CLI's dash-encoding of a directory name, an encoding this
repository does not own and has no forward encoder for. The `null` reaches both call sites BEFORE
`sessionsDb.createSession`, which is what keeps `projectsDb.createProjectPath` from minting a
`projects` row. This is not "created and then filtered out of a list": the session row never
exists, which is why the panel reads her transcript by the session id the board minted, through the
route above and the `scanProjectsRoot` fallback behind it. The providers module's own scan-roots
table records the same refusal from the read side:
[server/modules/providers/README.md](../server/modules/providers/README.md).

**The hooks seam.** One module, `~/.claude/hooks/kanban_metis.py`, holds the predicate and never
raises: `SESSION_ROOT`, `board_id(payload_or_cwd)` (the leaf under that root, else `None`) and
`is_board_session(payload_or_cwd)`. Three consumers, one early return each, and the same predicate
is stated from the hooks' own side in `~/.claude/hooks/README.md` §"Metis-session scoping":

- `metis_session.maybe_stamp` gains a FOURTH create trigger: any event whose payload `cwd` is a
  board session stamps the Metis-presence marker, without a typed `/pm` — the board-issued identity
  replacing the typed one. It is the one create trigger with no `event` in its condition, and it
  deliberately falls THROUGH rather than claiming the event: a `return True` there would
  short-circuit the guard ladder for every event of a board session and silence exactly the guards
  that are meant to apply to her.
- `enforce_metis_contract._guard_stop` (G4) **stands down** — it reads Descent's sqlite store, and
  scanning it would compare her work against a board that never held it.
- The G4b autonomy branch **stands down** for the same reason: judging her turn against Descent's
  queue could block (or fail to block) her over work that is not hers. The Stop WARN pair (P5/P6)
  stands down with them, since both read the same store.

Every stand-down keys on the payload's CWD and never on the presence marker: on her first event no
marker exists yet, and the stand-down must already hold.

**What still applies to a board Metis.** G1, G2, G5 and G10 carry no Descent coupling and do
exactly what they do for an operator's session: **G1** lints the same `pm-*.plan.md` plans `/execute`
would mis-handle, **G2** blocks a git write while a build marker is live, **G5** sends a decision to
`post_design_questions` instead of a terminal prompt nobody is watching, and **G10** blocks
destructive SQL from an unattended session. **What stays Descent-only until sunset, and why each
needs no change:**

- **G3** (footprint on `set_status active`) — it fires on a literal `mcp__descent-pm__*` verb; her
  tools are `mcp__kanban-pm__*`, so it never reaches her, and the board's own claim CAS is the
  equivalent guard.
- **G4** (Stop, board-consistency) — reads Descent's store, and the code stands it down explicitly
  rather than letting it judge the wrong board.
- **G4b** (Stop, keep-flowing) — same store, same wrong question; a verdict read from Descent's
  cards could block her turn over a queue that is not hers.
- **G6** (honesty on `set_status done`) — reads a Descent card's checklist; her `done` claims travel
  through `mcp__kanban-pm__set_status`.
- **G7**, **G8** and **G9** (freshness, follow-up cards, questions on a follow-up card) — all three
  trigger on literal `mcp__descent-pm__*` tool names, so none of them ever fires on her.
- **P5/P6** (the Stop WARN pair) — both read Descent's store and stand down with G4; neither can
  block, so standing them down can never trap a turn.

## The pilot panel

`KanbanMetisPanel.tsx` is the board's fleet surface: it mounts inside `KanbanPanel.tsx` beside the
card drawer while a board is selected, folds to its header bar, and lists every session the board
has running or has run recently — each row carrying its state badge, its provider mark and model,
the clock, its board name, and — while it runs or can be resumed — a Stop or Resume button. A PANEL,
not a dialog, because watching is the whole job and a dialog cannot be watched while the board moves.

It reads, and it moves one number. `useKanbanMetis` seeds once by REST (`api.kanbanMetis`, beside `api.kanban` in
`src/shared/api.ts`) and then listens for the `kanban_metis_state` frame; `launch`, `stop`, `resume`
and `reply` each answer with the session they moved so a row (or the open conversation) repaints
without waiting for the frame behind it, while `nudge` answers `{ nudged, at }` and moves no session
at all (§"The nudge"). The hook also reads this board's own dial off the driver's own reading
(§"The driver"'s `/driver` route) — once per board, again on that board's own `board.updated`
frame and after a reconnect, never on a plain fleet frame — and hands it back as `dial: number | null`
with its ceiling beside it (`dialMax`, the route's `concurrencyMax`), `null` standing for a reading
not yet taken or one the driver could not answer, which the header draws as the plain live count
rather than a false cap. `setDial` is the one write: the panel's stepper (1 to the ceiling; beside
the figure from `sm` up, the body's first row on a phone) PATCHes the board's `concurrency`, draws
the press at once after retiring any reading already in flight, is confirmed by the `board.updated`
frame the write broadcasts, and is put back by a fresh reading when the server refuses it.

**A row is the door to its conversation, not a line with a transcript button on it.**
`KanbanMetisRow`'s whole body — mark, state badge, model, clock, board name — is one button
(`onOpen`, renamed from `onOpenTranscript`); the dedicated ghost "Transcript" button is gone, and a
`ChevronRight` at the row's end is the only mark that it opens something. The row that IS open
carries a left bar, a wash and `aria-current`, and scrolls itself back into view when it becomes the
open one (`useEffect` + `scrollIntoView({ block: 'nearest' })`) — necessary because the list itself
folds down to make room for what the row opened.

**The list never leaves.** Opening a row no longer swaps the panel body for a transcript: the list
narrows and the opened row's conversation — a new `KanbanMetisConversation.tsx` — takes the rest,
beside the list on a desktop (`md:flex-row`, the list at `md:basis-2/5`) and beneath it on a phone,
where the list itself folds to a few rows (`max-h-32`). A session dying in a neighbouring row is
never hidden by the one just opened. `KanbanMetisConversation` draws no header of its own:
`SubagentTranscriptView`'s own sticky row (Back, a label built from the session's model and state off
the same four keys `KanbanMetisRow`'s state table holds, and a "Live" badge while it runs) is the
only one, reached the same way the old panel body reached it — `sessionId={null}`,
`target={{ kind: 'metis', id }}` ([06-tool-view.md](architecture/06-tool-view.md) §"Click to read,
live"). An unlisted session — reaped, or dropped by a seed — is named by its session id alone, and
the composer is still offered; the server, not this record, is the gate on whether the child is in
fact still running. Beneath the transcript sits a composer built from `PromptInput`'s primitives
(`@/shared/ui`) rather than the 681-line `ChatComposer`: disabled with "She is mid-turn — stop her to
reply" while the session runs — a running child's stdin closed at spawn, so the server would answer a
live reply with 409 regardless, and the composer says so before the press — and a dismissible,
warn-toned `Banner` above it for a refusal the server does send back.

**Phase 18 wired the rest.** `KanbanMetisConversation`'s `onSend` calls `metis.reply(sessionId,
text)`: the draft clears only on a `landed` outcome; a `refused` one draws whatever the outcome
carries — the server's own sentence when its body sent one, the composer's own fallback text when it
did not — in the composer's own strip; and a `busy` one, the hook's own in-flight guard dropping a
second send because an earlier reply for this session is still out and not a refusal at all, draws
its own "still on its way" sentence, reachable because this `sending` state is local to the mount
while the guard is keyed on the session. That call passes `speak: false` — the one exception
`useKanbanMetis.ts`'s shared `verb` helper carries, because this composer already has a strip to draw
a refusal in and a second voice over the same send would be noise — so the sentence is handed back
rather than toasted over it. `onStop` calls the same `metis.stop` the row's own Stop button does and
toasts like every other row verb. The header's dial reading and its ⚡ Nudge button now read
`metis.dial` and call `metis.nudge()`, whose own refusal IS toasted — a bolt in a header has nowhere
of its own to draw a sentence. `SubagentTranscriptTarget` still carries the third kind, `'metis'`, so
`useSubagentTranscript` and `SubagentTranscriptView` stay reused rather than copied, and
`api.subagentTranscripts.metis` remains the one call behind it.

## The two switches

**A board's own switch, and the host-wide one, are two different files.** `kanban_boards.deepseek_flash`
is a column on the board row, toggled through the board `PATCH` (§"The panel") and read at every
spawn by the driver: on, it sends that board's Metis to DeepSeek Flash (`--model deepseek-flash`,
`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, the key as `ANTHROPIC_AUTH_TOKEN`); off,
she opens on Claude. It is written from the board row to
`~/.claude/state/kanban-deepseek/<boardId>.flag` at EVERY spawn, through the settings module's own
generalised `writeFlagFile` (the scratch-file-plus-rename writer, reached through
`server/modules/settings/index.ts`), and handed to the child as
`PLAN_RUNNER_DEEPSEEK_FLAG_PATH`.

**The precedence rule, in one sentence: a board-launched Metis and every plan-runner she starts read
that board's own flag file, and the host-wide `~/.claude/state/deepseek_flash.flag` is NEVER
consulted for them.** The seam is `flag_path()` in `~/.claude/hooks/plan_runner/deepseek.py`, which
reads `PLAN_RUNNER_DEEPSEEK_FLAG_PATH` **at call time** and falls back to the host-wide path only
when it is unset — so the two switches never mix, and a flip of the host-wide flag cannot move a
board's sessions. The host-wide file, its own reader and writer, and the client surfaces that draw
it are [plan-runner.md](plan-runner.md) §"The DeepSeek switch"; the board side of the rule is stated
here and nowhere else.

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
