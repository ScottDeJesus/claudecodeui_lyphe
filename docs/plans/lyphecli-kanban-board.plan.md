# A native Kanban board inside LypheCLI — the workspace tab that replaces Descent

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> I wanted to add some cards to LypheCLI. These cards will be essentially the same style of cards in Descent but inside of LypheCLI we'll create a new tab for Kanban. We'll have the same categories: To Do, Backlog, In Progress, Done. We'll have it horizontally scrolling. Let's make sure that it's optimized so that we're not loading all of the cards when I press the button. Right now I don't want MCP or anything seeing it besides me. I would like to have that and within that I would also like to be able to change projects, similar to Descent: I can change to EIS app project or just create different projects that host different cards.
>
> The reason why I didn't want an MCP tool registered is because cards usually have a lot of bloat with them. I don't want to bloat anything right now. I eventually would like it to be autonomous, just like in Descent, because we're going to be sunsetting Descent and we're going to move into here. I would definitely like to keep the questions, the issues, the leases, and all of the machinery for it. I just won't be using that at the moment so it's okay if you want to hide all of that stuff but I definitely want to carry it over. If SQLite 3 is better let's use that. It's okay if you want to hide it behind the LypheCLI 2. I don't want to keep the Descent card skin. I want to keep the Verve skins or the Verve look. I just want to extract functionality and fields but I want to use the native Verve components that we have here.
>
> Awesome, good to go.

**THIS PLAN DELIVERS:**
A new always-visible workspace tab, **Kanban**, inside LypheCLI, backed by eleven new
`kanban_`-prefixed tables in the app's existing SQLite file (`~/.cloudcli/auth.db`, created by
one idempotent addition to `runMigrations`). The schema carries Descent's whole card model on
day one — boards, cards (priority, description, closing remarks, plan, body, approved /
approved_at, archived, `sort_order REAL` for midpoint drag-drop, the four `build_tokens_*`
counters, build and plan leases), tags, questions, issues, decisions, checklist items with
notes, attachments, an events audit log and a settings table — with Descent's five statuses
(`not_ready`, `todo`, `questions`, `active`, `done`) and its three priorities (`low`,
`medium`, `high`) preserved verbatim. One server module, `server/modules/kanban/`, exposes the
whole model as SERVICE VERBS behind thin routes under `/api/kanban` (a future MCP adapter calls
the same verbs; no MCP tool is registered here). Every write records an event row in the same
transaction and broadcasts one `kanban_event` frame over the existing `/ws` socket, so a board
open in another window updates without polling. The tab shows four horizontally scrolling lanes
— To Do, Backlog, In Progress, Done — paging each lane on its own (Done newest-first), fetching
a card's body, questions, issues, checklist and attachments only when the card is opened, and
mounting nothing at all until the tab is active. A per-board **autonomy** switch, off by
default, gates the fifth Open-questions lane, the approve gate, the leases, the checklist, the
token chips, the issues and the closing remarks IN THE UI ONLY — every one of them is complete
in the data and in the service whatever the switch says. Two new system components join the
shared Verve kit (`KanbanLane`, `KanbanCard`) with their own stylesheet
`src/shared/ui/verve/board.css`, ruled by Iris and quoted in §Interfaces as settled fact. A
one-shot, idempotent importer copies a Descent `descent.db` — boards, cards, tags, questions,
issues, decisions, checklist, attachments, events and the one setting that matters — into the
new tables, mapping Descent ids so a second run updates instead of duplicating. The Descent
proxy module (`server/modules/descent/`) is not touched; the board does not go through it. No
test file is written; every phase is proven against a real server on port 7893, real curl
calls with a real JWT, a real websocket client, a real headless Chromium driving the built SPA,
and a real copy of `descent.db`.

**OPERATOR VERDICT:** CONFIRMED -- 2026-09-15 -- Scott: "Accept — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = ["/home/lyphe/.claude/descent"]

[budget]
max_cycles = 40
max_spawns = 200
max_fix_passes = 2
max_attempts = 2
max_review_passes = 1
max_replans = 3
```

## Interfaces

Everything in this section is a measured fact with its anchor, or a decision already made.
Nothing here is for the child to re-derive.

### Repo conventions that bind every phase

- Backend: `server/modules/<feature>/` with `<feature>.module.ts` (composition root),
  `<feature>.routes.ts` (router factory), `<feature>.service.ts` (domain logic), `index.ts`
  (barrel). Cross-module imports go through the other module's `index.ts` only.
  (`.agents/skills/backend-module-standards/SKILL.md`; `server/modules/descent/descent.module.ts:33`
  `export function createDescentModule(): Router`.)
- Frontend: `src/modules/<feature>/` with an `index.ts` barrel; `@/...` imports only, never a
  relative path; `type` aliases, never `interface`; no module-local `types.ts` / `utils.ts` /
  `constants.ts`. (`.agents/skills/frontend-module-standards/SKILL.md`.)
- Server application imports END IN `.js` even when the target file is `.ts`
  (`server/modules/auth/auth.middleware.ts:5` imports `'@/shared/utils.js'`).
- Scripts: `npm run typecheck` = `tsc --noEmit` over both tsconfigs; `npm run lint` =
  `oxlint src/ server/`; `npm run build:client` = `vite build` into `dist/`.
  (`package.json:44-53`.)

### Where the new code lives

| Path | What |
|---|---|
| `server/modules/database/kanban-schema.ts` | `KANBAN_SCHEMA_SQL` — every `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, one script |
| `server/modules/database/migrations.ts` | two lines: the import and one `db.exec(KANBAN_SCHEMA_SQL);` inside `runMigrations` |
| `server/modules/database/repositories/kanban-ids.db.ts` | id minting |
| `server/modules/database/repositories/kanban-boards.db.ts` | boards + settings rows |
| `server/modules/database/repositories/kanban-cards.db.ts` | cards, tags, lane paging, sort_order |
| `server/modules/database/repositories/kanban-card-tags.db.ts` | the card/tag join table |
| `server/modules/database/repositories/kanban-questions.db.ts` | questions and decisions |
| `server/modules/database/repositories/kanban-checklist.db.ts` | checklist items, attachments, issues |
| `server/modules/database/repositories/kanban-leases.db.ts` | the two compare-and-set lease statements |
| `server/modules/database/repositories/kanban-events.db.ts` | the audit log |
| `server/modules/database/repositories/kanban-import.db.ts` | the Descent importer's upserts |
| `server/modules/kanban/kanban.module.ts` · `index.ts` | the composition root and the barrel |
| `server/modules/kanban/routes/` | `kanban.routes.ts` (the factory) · `board.routes.ts` · `card.routes.ts` · `detail.routes.ts` · `import.routes.ts` |
| `server/modules/kanban/kanban-write.service.ts` | `writeKanban<T>` — the ONE write seam: transaction, event, frame, broadcast |
| `server/modules/kanban/kanban-broadcast.service.ts` | the websocket fan-out the seam calls |
| `server/modules/kanban/kanban-boards.service.ts` · `kanban-cards.service.ts` · `kanban-questions.service.ts` · `kanban-checklist.service.ts` · `kanban-leases.service.ts` · `kanban-import.service.ts` | the verbs |
| `server/modules/kanban/kanban-import.transport.ts` | the readonly reader of a foreign `descent.db` |
| `server/shared/kanban-types.ts` | the shared server types (see the note under §Module size) |
| `src/shared/kanban-types.ts` | the client mirror of that file (see the note under §Module size) |
| `src/shared/ui/KanbanLane.tsx` · `KanbanCard.tsx` · `verve/board.css` | the kit |
| `src/modules/kanban/` | the panel, its `card-drawer/` and its `utils/` |
| `scripts/kanban-ui-probe.mjs` · `scripts/kanban-ws-probe.mjs` | the two real-system probes |

### The database

- The handle is `getConnection()` from `@/modules/database/index.js`, called per query — never
  held in a module-level variable (`server/modules/database/connection.ts:109`; the repository
  pattern at `repositories/projects.db.ts:20`).
- Migrations are one imperative, idempotent function `runMigrations(db)`
  (`migrations.ts:491-566`), run unconditionally at every boot from
  `initializeDatabase()` (`init-db.ts:9,11`), itself called at `server/index.ts:384`. There is no
  version counter; `IF NOT EXISTS` is what makes a re-run safe. A new table's `db.exec(...)`
  belongs beside the others near `migrations.ts:521`, its indexes inside the same script.
- The file is `process.env.DATABASE_PATH || ~/.cloudcli/auth.db` (`connection.ts:36-38`);
  `server/load-env.ts:33` only sets a variable that is NOT already set, so an inline
  `DATABASE_PATH=…` on the command line wins.
- `PRAGMA foreign_keys = ON` is set in `INIT_SCHEMA_SQL` (`schema.ts:259`), so every `REFERENCES`
  below is enforced.
- `projects` is `project_id TEXT PRIMARY KEY` (`schema.ts:89-97`); the client's `Project` type
  carries it as `projectId` (`src/shared/types.ts:109-119`). That is the column a board links to.

### The schema — every column (Descent's model, mapped)

`kanban_boards`
```
id             TEXT PRIMARY KEY NOT NULL
name           TEXT NOT NULL
project_id     TEXT NULL REFERENCES projects(project_id) ON DELETE SET NULL
autonomy       INTEGER NOT NULL DEFAULT 0
sort_order     REAL NOT NULL DEFAULT 0
archived       INTEGER NOT NULL DEFAULT 0
created_at     TEXT NOT NULL
updated_at     TEXT NOT NULL
descent_id     TEXT NULL UNIQUE
```

`kanban_cards` (Descent's `ov_features`, every column including the ones its `_migrate` adds)
```
id                       TEXT PRIMARY KEY NOT NULL
board_id                 TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE
title                    TEXT NOT NULL
status                   TEXT NOT NULL DEFAULT 'not_ready'
                           CHECK (status IN ('not_ready','todo','questions','active','done'))
priority                 TEXT NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low','medium','high'))
description              TEXT NOT NULL DEFAULT ''
closing_remarks          TEXT NOT NULL DEFAULT ''
plan                     TEXT NULL
body                     TEXT NOT NULL DEFAULT ''
approved                 INTEGER NOT NULL DEFAULT 0
approved_at              TEXT NULL
archived                 INTEGER NOT NULL DEFAULT 0
sort_order               REAL NOT NULL DEFAULT 0
build_tokens_in          INTEGER NOT NULL DEFAULT 0
build_tokens_out         INTEGER NOT NULL DEFAULT 0
build_tokens_cache_read  INTEGER NOT NULL DEFAULT 0
build_tokens_cache_create INTEGER NOT NULL DEFAULT 0
build_lease_at           TEXT NULL
build_owner              TEXT NULL
plan_lease_at            TEXT NULL
plan_owner               TEXT NULL
created_at               TEXT NOT NULL
updated_at               TEXT NOT NULL
descent_id               TEXT NULL UNIQUE
```

`kanban_card_tags` (Descent's `ov_tags` IS the join table; there is no separate one)
```
card_id  TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE
tag      TEXT NOT NULL
PRIMARY KEY (card_id, tag)
```

`kanban_questions`
```
id           TEXT PRIMARY KEY NOT NULL
card_id      TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE
text         TEXT NOT NULL DEFAULT ''
multi        INTEGER NOT NULL DEFAULT 0
options      TEXT NOT NULL DEFAULT '[]'      -- JSON array of strings
selected     TEXT NOT NULL DEFAULT '[]'      -- JSON array of strings
other_on     INTEGER NOT NULL DEFAULT 0
other        TEXT NOT NULL DEFAULT ''
answered     INTEGER NOT NULL DEFAULT 0
sort_order   INTEGER NOT NULL DEFAULT 0
created_at   TEXT NOT NULL
answered_at  TEXT NULL
descent_id   TEXT NULL UNIQUE
```

`kanban_issues`
```
id           TEXT PRIMARY KEY NOT NULL
card_id      TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE
text         TEXT NOT NULL DEFAULT ''
resolved     INTEGER NOT NULL DEFAULT 0
filed_at     TEXT NOT NULL
resolved_at  TEXT NULL
resolved_by  TEXT NULL
descent_id   TEXT NULL UNIQUE
```

`kanban_decisions`
```
id           TEXT PRIMARY KEY NOT NULL
card_id      TEXT NULL REFERENCES kanban_cards(id) ON DELETE SET NULL
question_id  TEXT NULL
question     TEXT NOT NULL DEFAULT ''
choice       TEXT NOT NULL DEFAULT '[]'      -- JSON array of strings
tags         TEXT NOT NULL DEFAULT '[]'      -- JSON array of strings
created_at   TEXT NOT NULL
descent_id   TEXT NULL UNIQUE
```

`kanban_checklist_items`
```
id          TEXT PRIMARY KEY NOT NULL
card_id     TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE
text        TEXT NOT NULL
state       TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','done'))
sort_order  INTEGER NOT NULL DEFAULT 0
note        TEXT NOT NULL DEFAULT ''
created_at  TEXT NOT NULL
done_at     TEXT NULL
descent_id  TEXT NULL UNIQUE
```

`kanban_attachments`
```
id          TEXT PRIMARY KEY NOT NULL
card_id     TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE
filename    TEXT NOT NULL DEFAULT ''
mime        TEXT NOT NULL DEFAULT ''
size        INTEGER NOT NULL DEFAULT 0
created_at  TEXT NOT NULL
descent_id  TEXT NULL UNIQUE
```

`kanban_events`
```
id         INTEGER PRIMARY KEY AUTOINCREMENT
ts         TEXT NOT NULL
kind       TEXT NOT NULL
board_id   TEXT NULL
card_id    TEXT NULL
actor      TEXT NOT NULL DEFAULT 'operator'
payload    TEXT NOT NULL DEFAULT '{}'        -- JSON object
descent_id TEXT NULL UNIQUE
```

`kanban_settings`
```
key         TEXT PRIMARY KEY NOT NULL
value       TEXT NULL
updated_at  TEXT NOT NULL
```

`kanban_id_seq`
```
prefix  TEXT PRIMARY KEY NOT NULL
next    INTEGER NOT NULL DEFAULT 0
```

The nine indexes, all named `ix_kanban_*` so one query can count them:
```
ix_kanban_cards_board_status      ON kanban_cards(board_id, status, sort_order)
ix_kanban_cards_board_updated     ON kanban_cards(board_id, status, updated_at)
ix_kanban_card_tags_tag           ON kanban_card_tags(tag)
ix_kanban_questions_card          ON kanban_questions(card_id)
ix_kanban_issues_card             ON kanban_issues(card_id)
ix_kanban_decisions_card          ON kanban_decisions(card_id)
ix_kanban_checklist_card          ON kanban_checklist_items(card_id)
ix_kanban_attachments_card        ON kanban_attachments(card_id)
ix_kanban_events_board            ON kanban_events(board_id, id)
```

There is deliberately no index on `descent_id`: the column is declared `NULL UNIQUE`, and a
UNIQUE constraint already builds its own index, so a second one would be dead weight on every
insert. **`descent_id` is nullable-UNIQUE on purpose, and no builder may make it `NOT NULL`**:
SQLite permits MANY NULL rows under one UNIQUE constraint, and that is exactly what lets a
locally-created card (no Descent ancestor, `descent_id` null) sit in the same table as an
imported one while the importer's `ON CONFLICT(descent_id)` still keys cleanly on the rows that
have one.

### Ids, ordering and time

- **Id minting.** `mintId(prefix)` reads and bumps `kanban_id_seq` in the caller's transaction
  and returns `` `${prefix}-${next}` ``. Prefixes: `b` boards, `c` cards, `q` questions,
  `i` issues, `d` decisions, `k` checklist, `a` attachments. Descent's own ids are never reused
  as primary keys — they live in `descent_id`.
- **Timestamps** are ISO-8601 UTC seconds, `new Date().toISOString()`, in every `*_at` column.
- **`sort_order` is REAL and moves by midpoint.** `moveCard` takes `afterId` (the card that will
  sit directly ABOVE the moved card) and `beforeId` (directly below); either may be null.
  - both null → `1000`
  - `afterId` null → `min(sort_order of the target lane) - 1000`
  - `beforeId` null → `max(sort_order of the target lane) + 1000`
  - both present → `(after.sort_order + before.sort_order) / 2`
  - when the two neighbours are closer than `1e-6`, the lane is RENORMALISED first inside the
    same transaction — every card in that lane rewritten to `(index + 1) * 1000` in its current
    order — and the midpoint recomputed.
- **A LANE IS A SET OF STATUSES, never a single one.** With autonomy off the To Do lane must
  show `todo` AND `questions` cards together, so every lane query takes `statuses:
  KanbanStatus[]` and filters with `status IN (…)` — a placeholder list built from the array's
  length, never string-interpolated. A one-element array is the ordinary case, not a special one.
  Which statuses compose which lane is PANEL POLICY and lives in exactly one place,
  `src/modules/kanban/utils/lanePolicy.ts` (§The panel); the service takes whatever set it is
  given and the kit never hears the word `status` at all.
- **Lane order.** Every lane but `done` is `ORDER BY sort_order ASC, id ASC`. `done` is
  `ORDER BY updated_at DESC, id DESC` (newest first).
- **Paging** is keyset, never OFFSET, and the keyset spans the whole status set — one ordered
  page across `status IN (…)`, never one page per status stitched client-side. The cursor is the
  literal string `<key>|<id>`; `limit` defaults to 50 and is clamped to 200. Non-`done`:
  `WHERE sort_order > ? OR (sort_order = ? AND id > ?)`. `done`:
  `WHERE updated_at < ? OR (updated_at = ? AND id < ?)`. `nextCursor` is null when the page
  came back shorter than `limit`.
- **`laneCounts` stays PER STATUS** — five rows, one per status, exactly as the schema stores
  them. The panel sums the rows its lane policy composes. The server never learns the lanes.

### Server types — `server/shared/kanban-types.ts`

```ts
export type KanbanStatus = 'not_ready' | 'todo' | 'questions' | 'active' | 'done';
export type KanbanPriority = 'low' | 'medium' | 'high';

export type KanbanBoard = {
  id: string; name: string; projectId: string | null; autonomy: boolean;
  sortOrder: number; archived: boolean; createdAt: string; updatedAt: string;
};

export type KanbanLaneCount = { status: KanbanStatus; total: number };

/** Computed SERVER-side from build_lease_at against KANBAN_LEASE_STALE_SECONDS.
 *  The client maps this through and never re-derives it from buildLeaseAt. */
export type KanbanLeaseState = 'none' | 'held' | 'stale';

/** Descent's DEFAULT_STALE_SECS (descent/store_lease.py:27). The ONE home for this number.
 *  Consumers: the summary mapper in kanban-cards.db.ts, and kanban-leases.service.ts. */
export const KANBAN_LEASE_STALE_SECONDS = 40;

/** The optional trailing argument every WRITE verb takes. Absent actor means 'operator'. */
export type KanbanWriteContext = { actor?: string };

export type KanbanCardSummary = {
  id: string; boardId: string; title: string; status: KanbanStatus; priority: KanbanPriority;
  sortOrder: number; tags: string[]; openQuestions: number; openIssues: number;
  checklistDone: number; checklistTotal: number; buildTokens: number;
  approved: boolean; archived: boolean;
  buildLeaseAt: string | null; buildOwner: string | null;
  planLeaseAt: string | null; planOwner: string | null;
  leaseState: KanbanLeaseState;   // computed server-side; the client never derives it
  createdAt: string; updatedAt: string;
};

export type KanbanQuestion = {
  id: string; cardId: string; text: string; multi: boolean; options: string[];
  selected: string[]; otherOn: boolean; other: string; answered: boolean;
  sortOrder: number; createdAt: string; answeredAt: string | null;
};
export type KanbanIssue = {
  id: string; cardId: string; text: string; resolved: boolean;
  filedAt: string; resolvedAt: string | null; resolvedBy: string | null;
};
export type KanbanDecision = {
  id: string; cardId: string | null; questionId: string | null; question: string;
  choice: string[]; tags: string[]; createdAt: string;
};
export type KanbanChecklistItem = {
  id: string; cardId: string; text: string; state: 'pending' | 'active' | 'done';
  sortOrder: number; note: string; createdAt: string; doneAt: string | null;
};
export type KanbanAttachment = {
  id: string; cardId: string; filename: string; mime: string; size: number; createdAt: string;
};

export type KanbanCardDetail = KanbanCardSummary & {
  description: string; body: string; plan: string | null; closingRemarks: string;
  approvedAt: string | null;
  buildTokensIn: number; buildTokensOut: number;
  buildTokensCacheRead: number; buildTokensCacheCreate: number;
  questions: KanbanQuestion[]; issues: KanbanIssue[]; decisions: KanbanDecision[];
  checklist: KanbanChecklistItem[]; attachments: KanbanAttachment[];
};

export type KanbanEventRow = {
  id: number; ts: string; kind: string; boardId: string | null; cardId: string | null;
  actor: string; payload: Record<string, unknown>;
};

export type KanbanLeaseResult = { granted: boolean; card: KanbanCardSummary };

export type KanbanImportCounts = {
  boards: number; cards: number; tags: number; questions: number; issues: number;
  decisions: number; checklist: number; attachments: number; events: number; settings: number;
};
export type KanbanImportResult = {
  source: KanbanImportCounts; imported: KanbanImportCounts; inserted: number; updated: number;
  boardIdMap: Record<string, string>; currentBoardId: string | null;
};
```

`server/shared/types.ts` is 1672 lines and `src/shared/types.ts` is 2078; the house ceiling is
300 with a hard stop at 800, and "avoid adding lines to large files — extract instead". So the
Kanban domain types live in their own sibling `server/shared/kanban-types.ts` rather than being
appended to `types.ts`, and **the rule is SYMMETRIC: the client mirror is
`src/shared/kanban-types.ts`, an exact field-for-field mirror of the server file** (frame, lane
count, card summary, card detail, the question / issue / decision / checklist / attachment
shapes, `KanbanLeaseState`, the import result, and the client-only view types the panel and the
kit exchange). `src/shared/` already holds ten such siblings beside `types.ts` —
`authToken.ts`, `constants.ts`, `uiPreferences.ts`, `userSettings.ts` and the rest — so this is
the existing convention, not a new one. The frontend standard's "place a type two files share in
`src/shared/types.ts`" (`frontend-module-standards/SKILL.md:77`) yields here to the house module-size
rule, exactly as the no-tests clause yields in §Project Constraints; a builder never has to weigh
the two alone.

**`src/shared/types.ts` takes EXACTLY ONE edit in this entire plan** — `AppTab` gains
`| 'kanban'` (:54), in Phase 9 — and `server/shared/types.ts` takes exactly two, both in Phase 2:
`'kanban_event'` on `GatewayEventKind` and the `KanbanBoardEvent` declaration. Nothing else in
this plan may open either file.

### The one write seam — `kanban-write.service.ts`

**Every write in this module goes through `writeKanban`, and nothing else ever inserts a
`kanban_events` row or broadcasts a frame.** Twenty-seven verbs each hand-copying a transaction,
an event insert and a fan-out is twenty-seven chances to forget one; this is one place to be
right. It is built in Phase 2 with the first verbs, and every verb added in Phases 3, 4 and 6 is
written through it from its first line.

```ts
import type { Database } from 'better-sqlite3';

export function writeKanban<T>(
  spec: {
    kind: KanbanEventKind;                 // one of the kinds listed below
    boardId: string;
    cardId?: string | null;                // null for a board-level write
    actor?: string;                        // default 'operator'
    payload?: Record<string, unknown>;     // default {}
  },
  mutate: (db: Database) => T,
): T;
```

In this exact order, and no other:

1. Open ONE `db.transaction(...)`.
2. Run `mutate(db)` inside it and keep its return value.
3. Insert the `kanban_events` row inside the SAME transaction — so a rolled-back write leaves no
   event behind.
4. COMMIT.
5. **Outside** the transaction: read the affected card's FRESH summary through
   `kanbanCardsDb.getSummary(cardId)` (null when `cardId` is null) and the board's lane counts
   AFTER the write, build the `KanbanBoardEvent` frame, and call `broadcastKanbanEvent(frame)`.
   A throw here is caught and logged; it never fails a write that has already committed.
6. Return `mutate`'s value to the verb.

The event kinds are exactly:
`board.created`, `board.updated`, `board.selected`, `board.archived`, `card.created`,
`card.updated`, `card.moved`, `card.archived`, `card.restored`, `card.approved`,
`card.unapproved`, `tag.added`, `tag.removed`, `question.added`, `question.answered`,
`issue.filed`, `issue.resolved`, `checklist.added`, `checklist.updated`,
`checklist.removed`, `attachment.added`, `lease.build_claimed`, `lease.build_refreshed`,
`lease.build_released`, `lease.plan_claimed`, `lease.plan_released`, `import.descent`.

### The service verbs

Five service files, cut by cohesion rather than one file growing to eighteen verbs. Every WRITE
verb takes an optional trailing `context?: KanbanWriteContext`; the routes pass nothing, so the
actor is `'operator'` today, and an in-process MCP adapter passes its own name tomorrow without
a signature changing. Lease verbs take an explicit `owner` instead — a lease owner is a
different concept from an event actor, and both ride on `KanbanCardSummary`.

`kanban-boards.service.ts`
```ts
createBoard(input: { name: string; projectId?: string | null }, context?: KanbanWriteContext): KanbanBoard
listBoards(options?: { includeArchived?: boolean }): { boards: KanbanBoard[]; currentBoardId: string | null }
getBoard(boardId: string): KanbanBoard | null
updateBoard(boardId: string, patch: { name?: string; autonomy?: boolean; projectId?: string | null; archived?: boolean }, context?: KanbanWriteContext): KanbanBoard
selectBoard(boardId: string, context?: KanbanWriteContext): { currentBoardId: string }
boardForProject(projectId: string): KanbanBoard | null
laneCounts(boardId: string): KanbanLaneCount[]
listEvents(options: { boardId?: string; cardId?: string; limit?: number }): KanbanEventRow[]
```
`kanban-cards.service.ts`
```ts
listLaneCards(boardId: string, statuses: KanbanStatus[], options: { limit?: number; cursor?: string | null }): { cards: KanbanCardSummary[]; nextCursor: string | null }
createCard(boardId: string, input: { title: string; priority?: KanbanPriority; status?: KanbanStatus; description?: string }, context?: KanbanWriteContext): KanbanCardSummary
getCard(cardId: string): KanbanCardDetail
updateCard(cardId: string, patch: { title?: string; priority?: KanbanPriority; description?: string; body?: string; plan?: string | null; closingRemarks?: string }, context?: KanbanWriteContext): KanbanCardSummary
moveCard(cardId: string, input: { status: KanbanStatus; afterId?: string | null; beforeId?: string | null }, context?: KanbanWriteContext): KanbanCardSummary
archiveCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary
restoreCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary
addTag(cardId: string, tag: string, context?: KanbanWriteContext): KanbanCardSummary
removeTag(cardId: string, tag: string, context?: KanbanWriteContext): KanbanCardSummary
```
`kanban-questions.service.ts` — questions, the decisions they write, and the approve gate
```ts
addQuestion(cardId: string, input: { text: string; options?: string[]; multi?: boolean; otherOn?: boolean }, context?: KanbanWriteContext): KanbanQuestion
answerQuestion(questionId: string, input: { selected: string[]; other?: string }, context?: KanbanWriteContext): KanbanQuestion
approveCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary
unapproveCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary
```
`kanban-checklist.service.ts` — checklist items, attachments and issues
```ts
fileIssue(cardId: string, input: { text: string }, context?: KanbanWriteContext): KanbanIssue
resolveIssue(issueId: string, input?: { resolvedBy?: string }, context?: KanbanWriteContext): KanbanIssue
addChecklistItem(cardId: string, input: { text: string; note?: string }, context?: KanbanWriteContext): KanbanChecklistItem
updateChecklistItem(itemId: string, patch: { state?: 'pending' | 'active' | 'done'; text?: string; note?: string }, context?: KanbanWriteContext): KanbanChecklistItem
removeChecklistItem(itemId: string, context?: KanbanWriteContext): void
addAttachment(cardId: string, input: { filename: string; mime: string; size: number }, context?: KanbanWriteContext): KanbanAttachment
```
`kanban-leases.service.ts`
```ts
claimBuildLease(cardId: string, owner: string): KanbanLeaseResult
refreshBuildLease(cardId: string, owner: string): KanbanLeaseResult
releaseBuildLease(cardId: string, owner: string): KanbanLeaseResult
claimPlanLease(cardId: string, owner: string): KanbanLeaseResult
releasePlanLease(cardId: string, owner: string): KanbanLeaseResult
```
`kanban-import.service.ts`
```ts
importFromDescent(input: { dbPath?: string }, context?: KanbanWriteContext): KanbanImportResult
```

Four rules bind every verb:

1. **No verb writes outside `writeKanban`.** The transaction, the event row and the broadcast
   are the seam's, not the verb's. A verb that needs two writes to be atomic does both inside
   ONE `mutate` callback — never two `writeKanban` calls.
2. **The actor is `context?.actor ?? 'operator'`**, threaded straight into the seam's `actor`
   field and so into the `kanban_events` row. No route reads it from the request; there is no
   per-user identity on this board today, and the parameter exists so that adding one later is
   a caller change rather than a schema change.
3. **The approve gate** (Descent's, `descent/README.md:428`): `approveCard` refuses with
   `AppError(…, { statusCode: 409 })` unless the card has ZERO unanswered questions AND at
   least one of `plan`, `body`, `description` is non-empty. A card in `not_ready` that passes
   the gate is promoted to `todo` AND approved in ONE transaction — one `mutate`, one event.
4. **A lease is claimable when it is unclaimed, already the caller's, or STALE** — stale meaning
   `build_lease_at` is null, unparseable, or older than **40 seconds**
   (`descent/store_lease.py:27` `DEFAULT_STALE_SECS = 40`). A claim against a fresh foreign
   lease returns `{ granted: false }` with the current card, never an exception. Moving a card
   off `active` clears `build_lease_at` and `build_owner`. **The 40-second number is written
   once, as `KANBAN_LEASE_STALE_SECONDS` in `server/shared/kanban-types.ts`**, and both its
   consumers import it: `kanban-leases.service.ts` decides a claim with it, and the summary
   mapper in `kanban-cards.db.ts` derives the `leaseState` field
   (`'none' | 'held' | 'stale'`) with it on every `KanbanCardSummary`. No builder may spell `40`
   anywhere else. The client READS `leaseState` and never recomputes it; `buildLeaseAt` and
   `buildOwner` stay on the wire for tooltip TEXT only, never for a decision.

### The routes — `/api/kanban`, mounted with the guard on the mount

```
GET    /api/kanban/boards                      -> { boards, currentBoardId }
POST   /api/kanban/boards                      { name, projectId? }            -> { board }
PATCH  /api/kanban/boards/:boardId             { name?, autonomy?, projectId?, archived? } -> { board }
POST   /api/kanban/boards/:boardId/select                                      -> { currentBoardId }
GET    /api/kanban/boards/:boardId/lanes                                       -> { lanes: KanbanLaneCount[] }
GET    /api/kanban/boards/:boardId/cards?status=todo,questions&limit=&cursor=  -> { cards, nextCursor }
POST   /api/kanban/boards/:boardId/cards       { title, priority?, status?, description? } -> { card }
GET    /api/kanban/projects/:projectId/board                                   -> { board }
GET    /api/kanban/cards/:cardId                                               -> { card: KanbanCardDetail }
PATCH  /api/kanban/cards/:cardId               { title?, priority?, description?, body?, plan?, closingRemarks? } -> { card }
POST   /api/kanban/cards/:cardId/move          { status, afterId?, beforeId? } -> { card }
POST   /api/kanban/cards/:cardId/archive                                       -> { card }
POST   /api/kanban/cards/:cardId/restore                                       -> { card }
POST   /api/kanban/cards/:cardId/tags          { tag }                         -> { card }
DELETE /api/kanban/cards/:cardId/tags/:tag                                     -> { card }
POST   /api/kanban/cards/:cardId/questions     { text, options?, multi?, otherOn? } -> { question }
POST   /api/kanban/questions/:questionId/answer { selected, other? }           -> { question }
POST   /api/kanban/cards/:cardId/issues        { text }                        -> { issue }
POST   /api/kanban/issues/:issueId/resolve     { resolvedBy? }                 -> { issue }
POST   /api/kanban/cards/:cardId/checklist     { text, note? }                 -> { item }
PATCH  /api/kanban/checklist/:itemId           { state?, text?, note? }        -> { item }
DELETE /api/kanban/checklist/:itemId                                           -> { ok: true }
POST   /api/kanban/cards/:cardId/attachments   { filename, mime, size }        -> { attachment }
POST   /api/kanban/cards/:cardId/approve                                       -> { card }
POST   /api/kanban/cards/:cardId/unapprove                                     -> { card }
POST   /api/kanban/cards/:cardId/build-lease/claim   { owner }                 -> { granted, card }
POST   /api/kanban/cards/:cardId/build-lease/refresh { owner }                 -> { granted, card }
POST   /api/kanban/cards/:cardId/build-lease/release { owner }                 -> { granted, card }
POST   /api/kanban/cards/:cardId/plan-lease/claim    { owner }                 -> { granted, card }
POST   /api/kanban/cards/:cardId/plan-lease/release  { owner }                 -> { granted, card }
GET    /api/kanban/events?boardId=&cardId=&limit=                              -> { events }
POST   /api/kanban/import/descent              { dbPath? }                     -> KanbanImportResult
```

- **The routes are a PACKAGE, not one file.** `server/modules/kanban/routes/` holds
  `board.routes.ts` (Phase 2), `card.routes.ts` (Phase 3), `detail.routes.ts` (Phase 4) and
  `import.routes.ts` (Phase 6), each exporting a `create<X>Routes(services): Router` factory; and
  `kanban.routes.ts`, the FACTORY that builds one `express.Router()` and mounts the four onto it.
  Thirty-one routes in one file is born over the 300-line ceiling; each phase adds a sibling
  instead of growing a single file, and only `kanban.routes.ts` is touched by more than one phase
  (one `router.use(...)` line per sibling).
- **`status` on the lane route is a COMMA-SEPARATED LIST**, parsed in the route into
  `KanbanStatus[]`: split on `,`, trim, drop empties, reject the whole request with a 400 if any
  member is not one of the five statuses, and reject an empty list too. `status=todo` and
  `status=todo,questions` are both ordinary. The route — never the service — also clamps `limit`
  to 200 (default 50) and parses `cursor` as an opaque string.
- **`GET /events` clamps `limit` to 200 the same way** (default 50). Without the clamp one
  request can ask for the board's whole audit log, which on an imported Descent board is twelve
  thousand rows.
- Mount: `app.use('/api/kanban', authenticateToken, createKanbanModule());` in `server/index.ts`,
  in the flat mount block, directly after the descent mount at `server/index.ts:185`. The MOUNT
  carries the guard; no route file imports `authenticateToken`
  (`server/modules/plan-runner/plan-runner.routes.ts:35` says so in a comment).
- Success bodies are bare JSON objects as named above; failures are
  `res.status(n).json({ error: '…' })` for a parse failure in the route, and every service
  failure is an `AppError` from `@/shared/utils.js` thrown to `next(error)` and rendered by the
  global handler at `server/index.ts:282-303` as `{ success: false, error: { code, message } }`.
  Both shapes already coexist in this server (`plan-runner.routes.ts:54`, `server/index.ts:285`).
- `express.json()` is global (`server/index.ts:129-139`); no body parser is added.

### The websocket frame

- `GatewayEventKind` (`server/shared/types.ts:204-210`) gains `'kanban_event'`.
- Declared in `server/shared/types.ts` beside `SessionUpsertedEvent` (:242-255), because
  `GatewayEventKind` lives there and a frame belongs beside its siblings — this is the ONE
  kanban type in that file. It carries the comment convention of `server/shared/types.ts:264`,
  reading **"Mirrored field-for-field in `src/shared/kanban-types.ts`"**. The client mirror is
  that sibling file and NOT `src/shared/types.ts` (§Module size).
- **Only `writeKanban` builds and sends this frame** (§The one write seam). No verb, route or
  repository constructs one.
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
- Broadcast exactly like `session-upsert-broadcast.service.ts:80-92`: build the object,
  `JSON.stringify` once, `connectedClients.forEach` sending to every client whose
  `readyState === WS_OPEN_STATE`. Both symbols come from `@/modules/websocket/index.js`
  (`plan-runner.module.ts:8` imports them that way). There is no per-user or per-project
  filtering anywhere in this server's broadcasts, and this frame adds none.
- The client subscribes with `useWebSocket()` from `@/shared/context/WebSocketContext`
  (`RunnerFeed.tsx:5,31`); `subscribe(listener)` returns its own unsubscribe closure
  (`WebSocketContext.tsx:170-175`) and hands each listener the loose `ServerEvent`
  (`src/shared/types.ts:230-236`), so the panel filters on `event.kind === 'kanban_event'`
  itself. **The board does NOT use the live-bus**: `src/modules/live-bus/topics.ts:19-29`
  allows only `runner:*` and `souls:*`, the bus exists to retain a value for components mounted
  elsewhere, and this panel is the only consumer and is mounted only while its tab is active.

### The client API surface

`src/shared/api.ts` gains one group beside `planRunner` (`api.ts:619-624`), built on the same
`get` / `post` / `patch` / `del` helpers (`api.ts:157-171`) — `authenticatedFetch` attaches the
bearer token automatically (`api.ts:86,95-97`); no caller passes a token.

```ts
kanban: {
  boards: () => get('/api/kanban/boards'),
  createBoard: (body: { name: string; projectId?: string | null }) => post('/api/kanban/boards', body),
  updateBoard: (id: string, body: Record<string, unknown>) => patch(`/api/kanban/boards/${encodeURIComponent(id)}`, body),
  selectBoard: (id: string) => post(`/api/kanban/boards/${encodeURIComponent(id)}/select`, {}),
  lanes: (id: string) => get(`/api/kanban/boards/${encodeURIComponent(id)}/lanes`),
  laneCards: (id: string, statuses: string[], cursor?: string | null, limit = 50) => get(`/api/kanban/boards/${encodeURIComponent(id)}/cards?status=${encodeURIComponent(statuses.join(','))}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  createCard: (id: string, body: Record<string, unknown>) => post(`/api/kanban/boards/${encodeURIComponent(id)}/cards`, body),
  boardForProject: (projectId: string) => get(`/api/kanban/projects/${encodeURIComponent(projectId)}/board`),
  card: (id: string) => get(`/api/kanban/cards/${encodeURIComponent(id)}`),
  updateCard: (id: string, body: Record<string, unknown>) => patch(`/api/kanban/cards/${encodeURIComponent(id)}`, body),
  moveCard: (id: string, body: Record<string, unknown>) => post(`/api/kanban/cards/${encodeURIComponent(id)}/move`, body),
  archiveCard: (id: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/archive`, {}),
  addTag: (id: string, tag: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/tags`, { tag }),
  removeTag: (id: string, tag: string) => del(`/api/kanban/cards/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`),
  addQuestion: (id: string, body: Record<string, unknown>) => post(`/api/kanban/cards/${encodeURIComponent(id)}/questions`, body),
  answerQuestion: (id: string, body: Record<string, unknown>) => post(`/api/kanban/questions/${encodeURIComponent(id)}/answer`, body),
  fileIssue: (id: string, body: { text: string }) => post(`/api/kanban/cards/${encodeURIComponent(id)}/issues`, body),
  resolveIssue: (id: string, body: Record<string, unknown>) => post(`/api/kanban/issues/${encodeURIComponent(id)}/resolve`, body),
  addChecklistItem: (id: string, body: Record<string, unknown>) => post(`/api/kanban/cards/${encodeURIComponent(id)}/checklist`, body),
  updateChecklistItem: (id: string, body: Record<string, unknown>) => patch(`/api/kanban/checklist/${encodeURIComponent(id)}`, body),
  approveCard: (id: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/approve`, {}),
  unapproveCard: (id: string) => post(`/api/kanban/cards/${encodeURIComponent(id)}/unapprove`, {}),
  events: (query: string) => get(`/api/kanban/events${query}`),
  importDescent: (body: { dbPath?: string }) => post('/api/kanban/import/descent', body),
},
```

### The tab — every call site that must carry `'kanban'`

Measured; this list is complete (a grep of `'runner'` and `'memory'` across `src/`).

| File:line | Change |
|---|---|
| `src/shared/types.ts:54` | `AppTab` union gains `\| 'kanban'` |
| `src/modules/project-workspace/WorkspaceTabs.tsx:45-50` | `BASE_TABS` gains `{ id: 'kanban', labelKey: 'tabs.kanban', icon: KanbanSquare }` after the `git` entry; `KanbanSquare` added to the `lucide-react` import at `:1-10` |
| `src/modules/project-workspace/WorkspaceMain.tsx:389-393` | a new block after the runner block: `{activeTab === 'kanban' && (<div className="h-full overflow-hidden"><KanbanPanel projectId={selectedProject.projectId} /></div>)}`. `selectedProject: Project \| null` is already a prop of this component (`:27`, `:73`) and the component early-returns at `:293` when it is null, so below that line it is non-null and `.projectId` needs no guard — the same access `:167` already makes |
| `src/modules/project-workspace/hooks/useProjectsState.ts:349` | `VALID_TABS` Set gains `'kanban'` — without it a persisted `localStorage.activeTab === 'kanban'` is rejected and silently falls back to `'chat'` |
| `src/modules/project-workspace/ProjectCommandPalette.tsx:52` | the `visibleTabs` seed becomes `['chat', 'files', 'git', 'kanban']` |
| `src/modules/command-palette/CommandPalette.tsx:70-78` | `NAV_TABS` gains a `kanban` row; its own doc comment at `:64-69` names this exact trap |
| `src/modules/i18n/locales/<lang>/common.json` | all ELEVEN locales gain `"kanban": "Kanban"` inside the `tabs` block (en at `:20-30`). The ten non-English files are missing `memory` and `runner` today; add `kanban` to every one of the eleven anyway |

`useWorkspaceTabGates.ts` is **not** touched: the convention for an always-visible tab is the
absence of a gate field, exactly as `chat`, `files` and `git` have none
(`useWorkspaceTabGates.ts:61-70`), and `ProjectSidebarRegion.tsx:40-53` therefore needs no new
prop. Choosing a conversation returns to chat from the board as from every tab.

**Boards are GLOBAL, not per project.** The selected board is a single `kanban_settings` row
(`current_board`), so switching projects does NOT change the selected board, and no board is
unmounted or refetched when the active project changes. `projectId` reaches the panel for exactly
one purpose, stated once here and implemented in Phase 10: **on FIRST mount only, when
`currentBoardId` is null, the panel asks `boardForProject(projectId)` and selects that board if
one comes back.** It is a first-run convenience and nothing more — it never fires again, it never
fires when a board is already selected, and it never fires on a project switch. A board's
`project_id` column is a LABEL (which project this board is about), never a filter.

The panel mounts only while its tab is active — the `&&` short-circuit above is the mechanism,
the same one memory and runner use (`WorkspaceMain.tsx:383-393`). Nothing in
`src/modules/kanban/` may be imported anywhere that renders unconditionally.

### Iris's ruling on the two kit components (settled fact, not a step)

Two flat files in the kit, `src/shared/ui/KanbanLane.tsx` and `src/shared/ui/KanbanCard.tsx`,
both exported from `src/shared/ui/index.ts`. Paint lives in a THIRD stylesheet,
`src/shared/ui/verve/board.css`, side-effect-imported from the barrel beside `controls.css`
(435 lines) and `feedback.css` (386) — both are at their stated ceiling. Markers: `.vv-lane`,
`.vv-lane__head`, `.vv-lane-card`, and the `--over` / `--lifted` / `--ghost` / `--leased` /
`--muted` variants. **The lane takes DATA, not children** — `ActionMenu`, `Tabs` and `Select`
all take arrays, and a lane that renders its own cards is the only way it can own the drop index
without introspecting `children`.

```ts
export type CardPriority = 'low' | 'medium' | 'high';

export type KanbanCardSignals = {
  openQuestions?: number;
  openIssues?: number;
  checklist?: { done: number; total: number };
  /** Preformatted spend ("128k"). The card never does token math. */
  tokens?: string;
  approval?: 'unapproved' | 'approved';
  /** 'stale' is a lease older than 40s. */
  lease?: 'held' | 'stale';
};

export type KanbanCardModel = {
  id: string; title: string; priority: CardPriority; tags: string[];
  /** Absent = autonomy OFF: the face is title + priority + tags and nothing else. */
  signals?: KanbanCardSignals;
};

type KanbanCardProps = {
  card: KanbanCardModel;
  selected?: boolean;            // the drawer is open on this card
  dragging?: boolean;            // lifted, by pointer or keyboard
  muted?: boolean;               // the PANEL's decision, passed down through the lane
  dropEdge?: 'top' | 'bottom';   // the insertion line; owned by the lane
  tabStop?: boolean;             // roving tab stop — exactly one card per lane
  onOpen: (id: string) => void;
  onMove: (id: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void;
  menuItems: ActionMenuItem[];
};

type KanbanLaneProps = {
  /** OPAQUE to the kit. The panel's own lane key; the kit never compares it to a literal. */
  laneId: string;
  title: string;
  /** Server-side total. `null` while the first page is in flight — never 0 as a stand-in. */
  count: number | null;
  cards: KanbanCardModel[];
  selectedCardId?: string | null;
  /** Passed straight down to every card in this lane. The panel decides which lane is muted. */
  muted?: boolean;
  loading?: boolean; hasMore?: boolean; loadingMore?: boolean;
  onLoadMore: () => void;
  onOpenCard: (id: string) => void;
  /** The card lands in this lane at `index`; the board computes the fractional sort_order. */
  onDropCard: (cardId: string, laneId: string, index: number) => void;
  onMoveCard: (cardId: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void;
  /** OPTIONAL. Absent means this lane shows no `+` button and no empty-state add action. */
  onAddCard?: () => void;
  cardMenuItems: (card: KanbanCardModel) => ActionMenuItem[];
  menuItems: ActionMenuItem[];
};
```

- **The kit speaks no Descent.** Neither component may contain the strings `todo`,
  `not_ready`, `questions`, `active` or `done`, and neither may branch on `laneId` at all. Every
  board policy — which lane offers an add button, which lane is muted, which lane's menu carries
  "Clear done", which statuses compose a lane — is the PANEL's, decided in
  `src/modules/kanban/utils/lanePolicy.ts`. What arrives here is a title, a count, an array of
  cards, an optional `muted`, an optional `onAddCard` and a menu array. That is what makes these
  two files reusable kit rather than a Descent board wearing a kit's name.
- **Internals.** `KanbanCard` uses `Badge` (tags and every signal), `Meter` `variant="inline"`
  (checklist), `Tooltip` (lease and token chips), `ActionMenu` (`iconOnly`, `portal`), `cn`.
  `KanbanLane` uses `ScrollArea` (body), `Button` (`variant="ghost" size="icon"` for `+`,
  `variant="tonal"` for Load more), `ActionMenu`, `EmptyState`, `Spinner`, `.vv-skeleton`, and
  `KanbanCard`. Neither imports anything outside `@/shared/ui` and `@/shared/utils`.
- **Drag is native HTML5** — `draggable` plus `dataTransfer.setData('text/plain', cardId)`, the
  idiom already shipped at `src/modules/chat-gutters/GutterWidgetFrame.tsx`. No npm dependency
  is added, and there is no hand-rolled pointer-event drag engine: HTML5 DnD does not fire on
  touch, so the coarse-pointer path is the card menu's "Move to" rows.
- **States.** default `.vv-card` ground with `--shadow-rest` at `--radius-card`; hover lifts 2px
  with `--shadow-hover` over `--dur-quick`/`--ease-enter` and fades the `…` in (always in the
  DOM, pinned visible under `@media (pointer: coarse)`); focus-visible keeps the app's global
  2px `--accent` ring untouched; lifted card gets `--shadow-lift`, `scale(1.02)`, `rotate(1deg)`,
  cursor `grabbing`; the vacated slot stays in place at `opacity:.35` with no shadow; a lane
  accepting a drop takes `--surface2` on its body and `--accent` on its 1px border with no fill
  wash; the drop placeholder is a 2px `--accent` insertion line on the neighbour card's top or
  bottom edge, never a phantom box; selected is a 2px `--accent` left edge plus `--accent-soft`
  at half strength; loading is three `.vv-skeleton` blocks at 64/48/48px with the header count
  rendering `—` and never `0`; an empty lane is `EmptyState` with no icon and an "Add card"
  action rendered only when `onAddCard` is given; the paging tail is an 8px sentinel with a centred
  `Spinner` while loading and a `Button variant="tonal"` "Load more" always rendered as the
  keyboard-reachable fallback; a leased card takes a 2px `--accent` left edge and a
  `Badge tone="positive" vv-badge--compact` reading `◐ Building` whose dot carries `.vv-pulse`,
  and a STALE lease swaps to `Badge tone="warn"` reading `◐ Stalled` with no pulse.
- **Density.** Lane width `--kb-lane-w: 300px` declared on the board root, re-declared as
  `min(86vw, 300px)` under 640px so the next lane peeks; lane gap `gap-3`; strip
  `flex h-full min-h-0 overflow-x-auto px-3 pb-3`; lane header `h-11 px-3 border-b border-border`
  sticky at the body's top; lane body `p-2` with `gap-2` between cards (the LANE owns the gap,
  the card sets no margin); card `p-3 rounded-[var(--radius-card)]` with no fixed height; title
  `line-clamp-2 text-sm font-medium leading-snug text-foreground`. Face at rest: title, the
  priority mark, up to 3 tags then `+n`, and — autonomy ON only — one signal row of at most four
  `vv-badge--compact` badges plus the inline checklist `Meter` at a 3px track. Hover or open
  only: the `…` menu, the card id, the description snippet, timestamps, tags 4 and beyond, the
  token breakdown. A face at rest never exceeds four text lines.
- **Colour as language.** Priority is an ink ladder, never a fill, and `medium` is SILENT:
  `high` renders `▲ High` in `text-warn-ink` (amber, never red — an unstarted card is neither
  destructive nor denied), `medium` renders NOTHING on the face (it is the default nearly every
  card carries; printing it turns the ladder into wallpaper), `low` renders `↓ Low` in
  `text-ink-faint`. This is lifted from the shipped `src/modules/task-master/TaskCard.tsx:23-28`.
  Lanes carry no colour at all — a lane's identity is its position and its name; a card in a lane
  the PANEL marked `muted` renders at opacity .8, a WEIGHT change rather than a hue. The budget is **at most two
  toned elements on a face at rest, of which at most one may be `warn` or `danger`**, with this
  precedence: open issues (`Badge tone="danger"`, `✕ 2 issues`) > lease > unapproved
  (`Badge tone="warn"`, `▲ Needs approval`) > high priority > open questions
  (`Badge tone="info"`, `i 3 questions`). Anything below the cut keeps its glyph and its count
  and renders `text-ink-muted`. Every toned thing carries a word or a count; a bare dot is
  forbidden. Never coloured: the card title, tags (always `Badge variant="outline"` +
  `vv-badge--compact` — a tag is a name, not a verdict), the card id, the token chip, the
  checklist label and value, lane headers, lane counts, lane backgrounds, board chrome. The
  checklist `Meter`'s accent fill is the one accent on a face and is exempt from the budget.
- **Lane header**, left to right: title (`text-small font-semibold text-foreground`), count
  (`text-xs text-ink-faint vv-tabular`, `—` when null), spacer, `+`
  (`Button variant="ghost" size="icon"`, `aria-label="Add card to {title}"`, rendered only when
  `onAddCard` is given), `ActionMenu iconOnly` rendering whatever `menuItems` array it was
  handed. The panel supplies `onAddCard` for its To Do and Backlog lanes only, and puts Collapse
  lane / Sort by priority / Sort by newest into every lane's `menuItems` with Clear done
  (`isDanger`) added for its Done lane — the kit knows none of that.
- **Board header**, `h-12 px-3 border-b border-border`, no background of its own so it inherits
  the workspace tab's chrome and introduces no page-level shell: left, the board switcher
  (`Select size="sm" ariaLabel="Board"`); right, a visible "Autonomy" label plus
  `Switch label="Autonomy"`, then `ActionMenu iconOnly` with New board / Rename / Archive, a
  divider, and **Import from Descent…** which opens a `Dialog`. Turning autonomy off while the
  `questions` lane holds cards does NOT hide them — the lane stays until it empties, with a
  `Banner` saying why.
- **Accessibility.** Focusable: the board switcher, the autonomy switch, the board overflow,
  each lane's `+` and overflow, ONE card per lane (roving `tabIndex`, the pattern `Tabs` already
  uses), and the focused card's own `…`. Lane root `<section role="group" aria-labelledby>`;
  lane body `<ul>`; card root
  `<li tabIndex={tabStop ? 0 : -1} aria-labelledby aria-describedby aria-roledescription="draggable card">`.
  No `aria-grabbed` — it is deprecated and no assistive technology reports it. Keys: `↑`/`↓`
  move focus between cards, `←`/`→` between lanes at the same index, `Home`/`End` to first and
  last, **`Ctrl/Cmd + ←`/`→` moves the CARD to the adjacent lane and `Ctrl/Cmd + ↑`/`↓` reorders
  it within the lane**, `Enter` or `Space` opens the drawer, `Escape` closes it and returns focus
  to the card. Focus follows the card through every move, and the BOARD (not the component) owns
  one `aria-live="polite"` region that speaks the outcome — "Fix login moved to In Progress,
  position 2 of 7". A `Toast` must never stand in for that announcement.
- **Verified present before this ruling was accepted**: `Button` variant `tonal`
  (`Button.tsx:26`), `Meter` variant `inline` (`Meter.tsx:21`), `Badge` variants
  `default | secondary | destructive | outline` (`Badge.tsx:22-27`), `.vv-badge--compact`
  (`verve/controls.css:95`), `.vv-skeleton` and `.vv-pulse` (`verve/tokens.css:174,178`),
  `.vv-tabular` (`tokens.css:125`), `--warn-ink` / `--ink-faint` / `--accent-soft` /
  `--shadow-lift` / `--radius-card` (`tokens.css:63,44,51,142,137`), the Tailwind colours
  `text-warn-ink` and `text-ink-faint` (`tailwind.config.js:84-85`), `Card`'s `interactive` prop
  (`Card.tsx:7`), `ActionMenuItem` (`ActionMenu.tsx:11-22`), `Select` props
  (`Select.tsx:7-16`), `Switch` props (`Switch.tsx:1-6`), `EmptyState` props
  (`EmptyState.tsx:5-17`), `Tone = 'neutral' | 'info' | 'positive' | 'warn' | 'danger'`
  (`src/shared/types.ts:251`).

### The panel

`src/modules/kanban/`
```
index.ts                          barrel: KanbanPanel only — nothing else leaves this module
KanbanPanel.tsx                   the tab pane: board header + the lane rail
KanbanBoardHeader.tsx             switcher, autonomy switch, overflow menu
KanbanImportDialog.tsx            the Descent import dialog
card-drawer/KanbanCardDrawer.tsx  the Dialog shell and the fetch-on-open
card-drawer/DrawerBody.tsx        title, description, markdown body, tags, priority
card-drawer/DrawerQuestions.tsx   questions and their answer controls
card-drawer/DrawerChecklist.tsx   the checklist and its Meter
card-drawer/DrawerIssuesAndTokens.tsx  issues, the token breakdown, approve, closing remarks
hooks/useKanbanBoards.ts          board list, current board, autonomy
hooks/useKanbanLanes.ts           lane counts, per-lane paging, the kanban_event subscription
hooks/useKanbanMutations.ts       writes, toasts, optimistic move
hooks/useKanbanDrag.ts            the HTML5 drag reducer and the keyboard move
utils/lanePolicy.ts               which statuses compose which lane — the ONE place
utils/cardModel.ts                toCardModel: wire summary -> kit view model — the ONE place
```

The drawer is the largest screen on this board — five field groups, half of them autonomy-gated —
so it is a DIRECTORY from the moment it is composed, not a file that grows past the ceiling and
gets split later under a builder who is mid-phase. Its four children are imported by
`KanbanCardDrawer.tsx` alone; nothing outside `card-drawer/` imports them, and nothing outside
`src/modules/kanban/` imports anything but the barrel's `KanbanPanel`.

`utils/` holds the two module-private helpers the frontend standard sanctions by name — "a large
module-private utility may be placed in `src/modules/<feature>/utils/`… give it a descriptive
name; do not name it `utils.ts`" (`frontend-module-standards/SKILL.md:88-89`).

**`utils/lanePolicy.ts` — lane composition, decided in one place.**

```ts
export type KanbanLaneSpec = {
  id: string;                 // the opaque laneId handed to the kit
  titleKey: string;           // i18n key; the kit receives the resolved string
  statuses: KanbanStatus[];   // what listLaneCards is asked for, and what laneCounts is summed over
  canAdd: boolean;            // decides whether the panel passes onAddCard
  muted: boolean;             // decides whether the panel passes muted
};

/** The board's lanes, left to right, for a given autonomy setting. */
export function kanbanLanes(autonomy: boolean): KanbanLaneSpec[];
```

With autonomy **off** it returns four lanes and the To Do lane carries TWO statuses:

| id | title | statuses | canAdd | muted |
|---|---|---|---|---|
| `todo` | To Do | `['todo', 'questions']` | yes | no |
| `not_ready` | Backlog | `['not_ready']` | yes | no |
| `active` | In Progress | `['active']` | no | no |
| `done` | Done | `['done']` | no | yes |

With autonomy **on** it returns five: To Do narrows to `['todo']`, and `Open questions`
(`['questions']`, no add, not muted) is inserted between To Do and In Progress. A lane's count is
the SUM of its statuses' rows in `laneCounts`, computed here; the server never learns the lanes,
and neither does the kit.

**`utils/cardModel.ts` — the one wire-to-view conversion.**

```ts
export function toCardModel(summary: KanbanCardSummary, options: { autonomy: boolean }): KanbanCardModel;
```

It is the ONLY place a `KanbanCardSummary` becomes a `KanbanCardModel`: it maps `leaseState`
(`'none'` → `signals.lease` absent, `'held'`/`'stale'` → that word), formats `buildTokens` into
the preformatted string the card renders (`"128k"` — the card never does token math), folds the
four counts into `signals`, and returns `signals: undefined` entirely when `options.autonomy` is
false, which is what makes an autonomy-off face title + priority + tags and nothing else. The
panel, the lanes and the drawer all call it; no component builds a `KanbanCardModel` by hand.

- Data flow copies `src/modules/plan-runner`: plain `useState`/`useEffect`/`useRef`/`useCallback`
  (there is no react-query and no SWR in this repo), `api.kanban.*` for every call, `useToast`
  from `@/shared/context/ToastContext` for every write outcome, `Spinner` for loading,
  `EmptyState` for empty and for unreachable, `ScrollArea` for the scroll container.
- On mount the panel fetches EXACTLY two things: `api.kanban.boards()` and
  `api.kanban.lanes(currentBoardId)`. Each lane then fetches its own first page of summaries for
  the status set its lane spec names. A card's detail is fetched only by `KanbanCardDrawer` when
  the card is opened. The ONE extra first-mount call is `boardForProject` — made only when
  `boards()` came back with `currentBoardId === null`, and followed by `selectBoard` when a board
  comes back (§The tab). It never fires again.
- `done` pages on scroll from the newest slice; every other lane pages from its `Load more` tail
  and its `IntersectionObserver` sentinel.
- Autonomy comes from the board row. OFF hides the `questions` lane (folding its cards into To Do
  through the lane policy above), every signal on a card face (`toCardModel` returns no
  `signals`), the approve control, the leases, the checklist, the token chips, the issues and the
  closing remarks. It hides NOTHING on the server and skips no write.

### The Descent importer

- **The foreign read is a TRANSPORT, not part of the service.** `kanban-import.transport.ts`
  owns every byte that comes out of the other database and nothing else: it opens the `descent.db`
  at `input.dbPath` (default `~/.claude/descent/descent.db`) through `better-sqlite3` with
  `{ readonly: true, fileMustExist: true }`; it VALIDATES that the nine `ov_*` tables it needs
  exist (`select name from sqlite_master where type='table'`) and throws
  `AppError(…, { statusCode: 404 })` naming the first missing one; it reads each table into a
  TYPED row array (`DescentBoardRow`, `DescentFeatureRow`, … declared in that file, since only it
  and the service use them); and it closes the handle in a `finally`. It writes nothing, maps
  nothing and knows nothing about `kanban_*`. The source file is never written.
- `kanban-import.service.ts` calls the transport, maps the rows, and writes them through
  `kanbanImportDb` inside ONE transaction. It never opens a database itself. This is the same
  seam the rest of the module keeps — a service does not hold a foreign connection — and it is
  what lets the mapping be read without the reading being re-argued.
- Mapping, table by table: `ov_boards`→`kanban_boards`, `ov_features`→`kanban_cards`,
  `ov_tags`→`kanban_card_tags`, `ov_questions`→`kanban_questions`, `ov_issues`→`kanban_issues`,
  `ov_decisions`→`kanban_decisions`, `ov_checklist_items`→`kanban_checklist_items`,
  `ov_attachments`→`kanban_attachments`, `ov_events`→`kanban_events`.
- **Idempotency rule**: every imported row carries the Descent primary key in `descent_id`
  (for `kanban_card_tags`, whose key is composite, the pair `(card_id, tag)` is itself the key
  and the insert is `INSERT OR IGNORE`). Every other table uses
  `INSERT INTO … ON CONFLICT(descent_id) DO UPDATE SET …` naming every non-key column, so a
  second run UPDATES and inserts nothing new. A row whose `descent_id` is already present keeps
  its LypheCLI id; `boardIdMap` maps Descent board id to LypheCLI board id.
- **A re-import never overwrites a card you edited here — DESCENT WINS ONLY WHEN IT IS NEWER.**
  For `kanban_cards` and `kanban_boards` the upsert's `DO UPDATE` carries a guard clause:

  ```sql
  INSERT INTO kanban_cards (…) VALUES (…)
  ON CONFLICT(descent_id) DO UPDATE SET …
  WHERE excluded.updated_at >= kanban_cards.updated_at
  ```

  and the same shape, on `kanban_boards.updated_at`, for boards. A card edited in LypheCLI after
  its last Descent change therefore survives a second import untouched; one Descent changed more
  recently is refreshed. A `DO UPDATE` whose `WHERE` is false is not an error and not a conflict —
  SQLite simply skips the row — so the import completes and the counts still reconcile.
  The child tables (questions, issues, decisions, checklist, attachments, events) stay FULL
  upserts with no guard: they carry no local editing surface in this plan's UI, and a partially
  guarded child would leave a card's questions half from each side.
- Ordering inside one transaction: boards, cards, tags, questions, issues, decisions, checklist,
  attachments, events. `ov_events.feature_id` carries no foreign key in Descent and may name a
  card that no longer exists; such an event is imported with `card_id` set to the mapped id when
  it resolves and to null when it does not.
- **Settings**: exactly ONE key is imported, `current_board`, translated through `boardIdMap`
  and written to `kanban_settings`. The other eighteen rows in the live `ov_settings`
  (`mcp_active_pid`, `notif_ingest_keepalive`, `pm_capacity_governor`, `schema_version`, `theme`
  and so on — measured 2026-09-15) are Descent daemon state and are deliberately skipped.
- One `import.descent` event is recorded with the counts as its payload.
- Measured source size, 2026-09-15: 1 board, 449 cards, 1706 tags, 252 questions, 15 issues,
  685 decisions, 694 checklist items, 27 attachments, 12695 events. Descent is live, so these
  numbers WILL have grown by the time this runs — every check below compares source counts to
  imported counts rather than to a literal.

## Project Constraints

Copied verbatim to every child. These are the rules and the mechanics, both.

1. **No test files, ever.** No `*.test.ts`, no `*.spec.ts`, no vitest file, no new entry under
   any `tests/` directory. The repo's backend and frontend standards documents each ask for
   tests; that clause is OVERRIDDEN by the operator's standing rule, and the checks in this plan
   are the verification. If a standards document and this line disagree, this line wins.
2. **No branches, and no git writes of any kind inside the run** — no `add`, `commit`, `stash`,
   `checkout`, `restore`, `reset`, `clean`, `push`. The work ends in the working tree. A probe is
   undone from a backup copy taken by the same command, never with `git checkout --`.
3. **Healed means deleted.** No SUPERSEDED block, no "previously this was…", no pointer to
   removed text, no dead tempting code left behind.
4. **Module size.** 300 LOC is the default ceiling, 500 soft, 800 hard. When a file in this plan
   would cross 300, split it by cohesion into a sibling module rather than growing it. Several
   splits are already made FOR you, at plan time, and are not yours to re-merge: the routes
   package, the three detail services, the drawer directory. Never append a hundred lines to
   `server/shared/types.ts` (1672 lines) or `src/shared/types.ts` (2078). Those two files take
   exactly three edits between them in this whole plan — `'kanban_event'` and the
   `KanbanBoardEvent` declaration in the server file (Phase 2, because `GatewayEventKind` lives
   beside them), and `AppTab | 'kanban'` in the client file (Phase 9). Every other Kanban type
   lives in `server/shared/kanban-types.ts` and its client mirror `src/shared/kanban-types.ts`.
5. **Never touch `server/modules/descent/`** — that module is the memory-intake and accounts
   proxy, and the board does not go through it. Never register an MCP tool: no file under
   `server/modules/*/mcp*`, no entry in any MCP manifest. Both are out of scope for every phase.
6. **The real-system harness.** These three snippets are proven working on this box
   (2026-09-15); use them verbatim rather than inventing a variant.

```bash
# (a) Mint a JWT for the first user, from the real database's own secret. Proven: 200 with it,
#     401 without it, against a live server.
mint_token() {
  python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
}

# (b) Boot a SECOND server on port 7893 against the real database, wait for it, and keep the
#     operator's local-server.json marker intact. The marker copy is the doctrine's backup-copy
#     revert: this server rewrites ~/.cloudcli/local-server.json and deletes it on exit.
boot_probe_server() {
  cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
  SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts \
    > /tmp/kanban-server.log 2>&1 &
  echo $! > /tmp/kanban-server.pid
  for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
}

# (c) Stop it and put the marker back.
stop_probe_server() {
  kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
  sleep 1
  cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
}
```

7. **Probe data is cleaned up by the command that made it.** A phase that creates a board names
   it `probe-phase<N>` and archives it before the command ends
   (`PATCH /api/kanban/boards/<id>` with `{"archived": true}`), so re-running the check finds
   exactly one live probe board again. `GET /api/kanban/boards` returns non-archived boards
   unless `?includeArchived=1` is passed — that is what makes every check idempotent.
8. **A second server writing the same SQLite file is expected and fine.** The operator's own
   server may be running on port 3011 against the same `auth.db`. On a `SQLITE_BUSY` the command
   is run once more; if it fails again, file `[BLOCKED: sqlite busy]` rather than changing the
   pragma or the file path.
9. **Never run `npm run dev`** (it starts Vite and the server together and never exits). Use
   `npm run build:client` plus the boot snippet above. Any command that can exceed two minutes
   carries a `timeout` or runs in the background.
10. **`docs/kanban.md` is the ONE documentation home for this board.** No phase — and no doc
    sweep in any phase — creates `server/modules/kanban/README.md`,
    `src/modules/kanban/README.md`, `docs/kanban-*.md` or any other new document about the
    board. Prometheus updates `docs/kanban.md`, `docs/README.md` and the ONE existing file
    Phase 13 names (`src/shared/ui/verve/README.md`), and nothing else. Two homes for one
    subject is the drift this rule prevents.
11. **The divergence rule.** If reality differs from this plan — a file is not where it says, a
    signature differs, a check fails for a reason the plan does not name — STOP, report the
    divergence verbatim, and do not improvise a fix.

## Phase 1 — The schema and its migration
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 1800
manifest = [
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/migrations.ts",
]
forbidden = [
  "server/modules/descent",
  "server/modules/database/schema.ts",
  "server/modules/database/connection.ts",
  "server/modules/database/init-db.ts",
]
athena = [
  "A CREATE TABLE is missing IF NOT EXISTS, so a second boot throws and the whole server fails to start",
  "A column from the Interfaces schema is missing or renamed -- especially one of the four build_tokens_*, the two plan-lease columns, closing_remarks, or descent_id",
  "A CHECK constraint spells a status or priority value differently from Descent's five statuses and three priorities",
  "The new exec was placed outside runMigrations' try block, or after the final LAST_SCANNED_AT exec, so it never runs",
  "An index was created with a name that does not start with ix_kanban_, so the count check passes or fails for the wrong reason",
  "schema.ts or connection.ts was edited instead of adding the sibling file",
]

[[steps]]
kind = "edit"
path = "server/modules/database/kanban-schema.ts"
what = "Create the file exporting one const, KANBAN_SCHEMA_SQL: a single SQL script holding every CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS from the Interfaces schema section, in the order boards, cards, card_tags, questions, issues, decisions, checklist_items, attachments, events, settings, id_seq, then the NINE indexes named there. There is no index on descent_id: the column is declared NULL UNIQUE and a UNIQUE constraint already builds one. descent_id stays nullable on every table -- never NOT NULL -- because SQLite permits many NULLs under one UNIQUE constraint, which is what lets locally-created rows sit beside imported ones. Copy the shape of PROJECTS_TABLE_SCHEMA_SQL in schema.ts:89-97, with a doc comment naming migrations.ts as its only consumer."
check = "grep -c 'CREATE TABLE IF NOT EXISTS kanban_' server/modules/database/kanban-schema.ts"
expect = "11"

[[steps]]
kind = "edit"
path = "server/modules/database/migrations.ts"
what = "Import KANBAN_SCHEMA_SQL into the import block at the top of the file and add one line, db.exec(KANBAN_SCHEMA_SQL); inside runMigrations' try block beside the other table execs near line 521. Nothing else in this file changes."
check = "grep -c 'KANBAN_SCHEMA_SQL' server/modules/database/migrations.ts"
expect = "2"

[[steps]]
kind = "run"
cmd = "node_modules/.bin/tsc --noEmit -p server/tsconfig.json"
check = "node_modules/.bin/tsc --noEmit -p server/tsconfig.json > /tmp/kanban-p1-typecheck.log 2>&1 && echo TYPECHECK-OK || tail -5 /tmp/kanban-p1-typecheck.log"
expect = "TYPECHECK-OK"
timeout_s = 600

[[verify]]  # boot a server against a scratch database and list the kanban tables it created
cmd = """
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
rm -f /tmp/kanban-schema-check.db /tmp/kanban-schema-check.db-journal
DATABASE_PATH=/tmp/kanban-schema-check.db SERVER_PORT=7894 timeout 45 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p1-boot.log 2>&1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
python3 -c "import sqlite3; print(','.join(r[0] for r in sqlite3.connect('/tmp/kanban-schema-check.db').execute(\\"select name from sqlite_master where type='table' and name like 'kanban%' order by name\\")))"
"""
expect = "kanban_attachments,kanban_boards,kanban_card_tags,kanban_cards,kanban_checklist_items,kanban_decisions,kanban_events,kanban_id_seq,kanban_issues,kanban_questions,kanban_settings"
timeout_s = 180

[[verify]]  # count the nine named indexes in the scratch database
cmd = "python3 -c \"import sqlite3; print(sqlite3.connect('/tmp/kanban-schema-check.db').execute(\\\"select count(*) from sqlite_master where type='index' and name like 'ix_kanban_%'\\\").fetchone()[0])\""
expect = "9"

[[verify]]  # prove the cards table really references the boards table
cmd = "python3 -c \"import sqlite3; print(sqlite3.connect('/tmp/kanban-schema-check.db').execute(\\\"pragma foreign_key_list('kanban_cards')\\\").fetchone()[2])\""
expect = "kanban_boards"
```

**What to build.** Two files: one new, one two-line edit. Nothing else.

**Sirens.** You will want to add the new tables to `INIT_SCHEMA_SQL` in `schema.ts` because
several tables are declared in both places — do not; `schema.ts` sits at 310 lines already and
`runMigrations` runs on every boot including a fresh install, so one exec is enough. You will
want to set `PRAGMA journal_mode = WAL` because the board writes often — do not; nothing in this
repo sets it and changing the journal mode of a live database is not this phase's work. You will
want to write a migration version number — do not; this repo has no version counter and
idempotent DDL is the mechanism. You will see the boot log fill with unrelated warnings from
other modules; they are not yours. The boot command runs for its full 45 seconds by design — the
server does not exit on its own, `timeout` ends it, and the tables were written in the first
second.

## Phase 2 — The write seam, the module, boards, events, mount
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/kanban",
  "server/modules/database/repositories/kanban-ids.db.ts",
  "server/modules/database/repositories/kanban-boards.db.ts",
  "server/modules/database/repositories/kanban-cards.db.ts",
  "server/modules/database/repositories/kanban-events.db.ts",
  "server/modules/database/index.ts",
  "server/shared/kanban-types.ts",
  "server/shared/types.ts",
  "server/index.ts",
  "src/shared/api.ts",
]
forbidden = [
  "server/modules/descent",
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/auth",
  "server/modules/websocket",
  "src/shared/types.ts",
  "src/modules",
]
athena = [
  "A write bypasses writeKanban -- a db.transaction, a kanban_events insert, or a broadcast written inside a verb instead of inside the seam",
  "writeKanban inserts the event outside the transaction that made the change, so a rolled-back write leaves an event behind, or broadcasts INSIDE the transaction, so a rolled-back write still told every client it happened",
  "The mount was added without authenticateToken, or a route file imports the guard itself instead of taking it at the mount",
  "createBoard does not mint its id through kanban_id_seq inside the same transaction, so two concurrent creates collide",
  "listBoards returns archived boards, which breaks every idempotent probe in this plan",
  "selectBoard writes the current board somewhere other than kanban_settings key current_board",
  "The actor is read from the request instead of defaulting to 'operator' from the optional context argument",
  "leaseState is computed with a literal 40 somewhere instead of importing KANBAN_LEASE_STALE_SECONDS",
  "A repository holds getConnection() in a module-level variable instead of calling it per query",
  "Business logic leaked into a route file instead of staying in the service",
  "All thirty-one routes were written into one kanban.routes.ts instead of the routes/ package",
]

[[steps]]
kind = "edit"
path = "server/shared/kanban-types.ts"
what = "Create the shared server types file with exactly the type aliases named in the Interfaces server-types section, plus the exported const KANBAN_LEASE_STALE_SECONDS = 40 with the doc comment naming its two consumers. Every exported type carries a doc comment naming its consumers, per the backend standards. Use type aliases, never interface."
check = "grep -c '^export type Kanban\\|^export const KANBAN_LEASE_STALE_SECONDS' server/shared/kanban-types.ts"
expect_re = "^(1[0-9]|[2-9][0-9])$"

[[steps]]
kind = "edit"
path = "server/shared/types.ts"
what = "Two edits and no others in this 1672-line file: add 'kanban_event' to the GatewayEventKind union at lines 204-210, and declare KanbanBoardEvent exactly as written in the Interfaces websocket section, beside SessionUpsertedEvent at lines 242-255, carrying the comment convention of line 264 and reading 'Mirrored field-for-field in src/shared/kanban-types.ts'. Import the card-summary and lane-count types it references from './kanban-types.js'."
check = "grep -c 'kanban_event\\|kanban-types' server/shared/types.ts"
expect_re = "^[3-9]$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-ids.db.ts"
what = "Create kanbanIdsDb with one method, mintId(prefix: string): string, which reads kanban_id_seq for that prefix, bumps it with an INSERT ... ON CONFLICT(prefix) DO UPDATE SET next = next + 1 RETURNING next, and returns the string prefix-next. Follow the plain-object repository shape of projects.db.ts:18-45 and call getConnection() inside the method."
check = "grep -c 'kanban_id_seq' server/modules/database/repositories/kanban-ids.db.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-boards.db.ts"
what = "Create kanbanBoardsDb: insertBoard, getBoard, getBoardByProject, listBoards(includeArchived), updateBoard(patch), getSetting and setSetting against kanban_settings, and laneCounts(boardId) returning ONE ROW PER STATUS with a COUNT over non-archived cards -- five rows, never lane-shaped. Rows map to the KanbanBoard type of server/shared/kanban-types.ts, where autonomy and archived are booleans in TypeScript and 0 or 1 in SQLite."
check = "grep -c 'kanban_boards' server/modules/database/repositories/kanban-boards.db.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-cards.db.ts"
what = "Create this file with ONE public method only: getSummary(cardId) returning a KanbanCardSummary or null -- the card row, its tags, its grouped open-question / open-issue / checklist-done / checklist-total counts, and the leaseState field derived from build_lease_at against KANBAN_LEASE_STALE_SECONDS imported from server/shared/kanban-types.js. The write seam needs it to build a frame, which is why it lands here and not in Phase 3. Do NOT write the lane paging, the insert, the update, the move or the renormalisation -- those are Phase 3's and belong in this same file then."
check = "grep -c 'getSummary\\|KANBAN_LEASE_STALE_SECONDS' server/modules/database/repositories/kanban-cards.db.ts"
expect_re = "^[2-9]$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-events.db.ts"
what = "Create kanbanEventsDb: recordEvent with kind, boardId, cardId, actor and payload inserting one kanban_events row with an ISO timestamp and a JSON-stringified payload and RETURNING the inserted row, and listEvents with boardId, cardId and limit returning KanbanEventRow objects newest first with payload parsed back to an object. recordEvent's only caller is the write seam."
check = "grep -c 'kanban_events' server/modules/database/repositories/kanban-events.db.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-broadcast.service.ts"
what = "Create broadcastKanbanEvent(frame: KanbanBoardEvent): void -- JSON.stringify once, then connectedClients.forEach sending to every client whose readyState equals WS_OPEN_STATE, both imported from '@/modules/websocket/index.js'. Copy session-upsert-broadcast.service.ts:80-92. A send that throws is caught PER CLIENT so one dead socket cannot stop the fan-out. Its only caller is the write seam."
check = "grep -c 'connectedClients' server/modules/kanban/kanban-broadcast.service.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-write.service.ts"
what = "Create writeKanban<T> exactly as signed and ordered in the Interfaces write-seam section: open one db.transaction, run mutate(db), insert the kanban_events row inside that same transaction with actor defaulting to 'operator', commit, then OUTSIDE the transaction read kanbanCardsDb.getSummary(cardId) when cardId is given, read the board's lane counts, build the KanbanBoardEvent frame and call broadcastKanbanEvent -- catching and logging a broadcast throw so it never fails a committed write -- and return mutate's value. This is the ONLY place in the module that opens a transaction, inserts an event or broadcasts."
check = "grep -c 'export function writeKanban' server/modules/kanban/kanban-write.service.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-boards.service.ts"
what = "Create the board verbs exactly as signed in the Interfaces service-verbs section: createBoard, listBoards, getBoard, updateBoard, selectBoard, boardForProject, laneCounts, listEvents. EVERY write goes through writeKanban -- no verb opens a transaction, records an event or broadcasts on its own -- and every write verb takes the optional trailing context argument and passes context?.actor through. A missing board throws AppError with statusCode 404; a blank name throws AppError with statusCode 400."
check = "grep -c 'writeKanban' server/modules/kanban/kanban-boards.service.ts"
expect_re = "^[3-9]$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/board.routes.ts"
what = "Create createBoardRoutes(services): Router carrying the seven board routes plus GET /events from the Interfaces route table. Routes parse and validate transport input, clamp the events limit to 200 with a default of 50, call one service verb, and shape the response; no business logic, no database access, no import of authenticateToken, and no actor. Errors go to next(error)."
check = "grep -c 'router\\.' server/modules/kanban/routes/board.routes.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/kanban.routes.ts"
what = "Create createKanbanRouter(services): Router -- the factory. It builds one express.Router() and mounts the sibling route factories onto it with router.use(...). This phase mounts createBoardRoutes only; Phases 3, 4 and 6 each add exactly one more line here. This file holds no route handler of its own, ever."
check = "grep -c 'createBoardRoutes' server/modules/kanban/routes/kanban.routes.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban.module.ts"
what = "Create createKanbanModule(): Router -- the composition root, following descent.module.ts:33. It builds the services and hands them to createKanbanRouter from './routes/kanban.routes.js'. No env reads are needed."
check = "grep -c 'export function createKanbanModule' server/modules/kanban/kanban.module.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/kanban/index.ts"
what = "Create the barrel exporting createKanbanModule and the service verbs a future in-process MCP adapter will call, with a comment naming server/index.ts as the consumer and /api/kanban as the prefix, following server/modules/descent/index.ts:3. The routes/ package is internal and is never exported."
check = "grep -c 'createKanbanModule' server/modules/kanban/index.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/index.ts"
what = "Add the import of createKanbanModule from './modules/kanban/index.js' to the import block, and one mount line mounting /api/kanban behind authenticateToken with createKanbanModule(), directly after the descent mount at line 185."
check = "grep -c \"app.use('/api/kanban', authenticateToken, createKanbanModule())\" server/index.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add the kanban group to the api object beside planRunner (api.ts:619-624) with the board entries from the Interfaces api surface: boards, createBoard, updateBoard, selectBoard, lanes, boardForProject, events. The card entries arrive in Phase 3."
check = "grep -c 'api/kanban/boards' src/shared/api.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/kanban-p2-tc.log 2>&1 && npm run lint > /tmp/kanban-p2-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p2-tc.log; tail -5 /tmp/kanban-p2-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the write seam is the ONLY place a transaction, an event or a broadcast is written
cmd = "test $(grep -rlE 'db\\.transaction|recordEvent|broadcastKanbanEvent' server/modules/kanban --include='*.ts' | grep -v 'kanban-write.service.ts' | grep -v 'kanban-broadcast.service.ts' | wc -l) -eq 0 && echo ONE-SEAM"
expect = "ONE-SEAM"

[[verify]]  # create a board through the real route, read it back, archive it
cmd = """
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p2-server.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
BID=$(curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"name":"probe-phase2"}' http://127.0.0.1:7893/api/kanban/boards | python3 -c 'import sys, json; print(json.load(sys.stdin)["board"]["id"])')
curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/kanban/boards/$BID/select" > /dev/null
RESULT=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7893/api/kanban/boards | python3 -c "
import sys, json
d = json.load(sys.stdin)
live = [b for b in d['boards'] if b['name'] == 'probe-phase2']
print('boards=%d current=%s autonomy=%s' % (len(live), 'yes' if d['currentBoardId'] == '$BID' else 'no', live[0]['autonomy'] if live else 'missing'))
")
LANES=$(curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/kanban/boards/$BID/lanes" | python3 -c 'import sys, json; print("lanes=%d" % len(json.load(sys.stdin)["lanes"]))')
EVENTS=$(curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/kanban/events?boardId=$BID&limit=10" | python3 -c 'import sys, json; d=json.load(sys.stdin)["events"]; print("events=%d actor=%s" % (len(d), d[0]["actor"] if d else "none"))')
curl -s -X PATCH -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"archived":true}' "http://127.0.0.1:7893/api/kanban/boards/$BID" > /dev/null
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "$RESULT $LANES $EVENTS"
"""
expect = "boards=1 current=yes autonomy=False lanes=5 events=2 actor=operator"
timeout_s = 300

[[verify]]  # prove the guard is on the mount
cmd = "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3011/api/kanban/boards || echo NO-SERVER"
expect_re = "^(401|000|NO-SERVER)$"
```

**What to build.** The write seam first, then the module skeleton and the board half of it.
Cards arrive next phase.

**Sirens.** You will want to write a verb's transaction, event row and broadcast inline "just
this once, it is three lines" — that is the twenty-seven-copy bug this phase exists to prevent.
`writeKanban` is the only place any of the three appears, and the first verify greps for exactly
that. You will see `kanban-cards.db.ts` in your manifest and want to write the lane paging while
you are in the file — do not; this phase writes `getSummary` and nothing else there, because the
seam needs it to build a frame, and Phase 3 owns the rest of that file. You will want to write
all thirty-one routes into one `kanban.routes.ts` because the router is right there — the routes
are a package, this phase adds `board.routes.ts`, and `kanban.routes.ts` only mounts siblings.
You will see `createApiSuccessResponse` in `server/shared/utils.ts:70-77` documented as the
canonical envelope — do NOT adopt it; the two reference modules (plan-runner, descent) ship bare
JSON and this module matches them, so the shapes in the route table are exact. You will want to
have a route import `authenticateToken` — do not; the mount carries it. You will want to add
`server/modules/kanban/types.ts` — the standards forbid a module-local types file; shared server
types go in `server/shared/kanban-types.ts`. You will be tempted to hold the database handle in a
module-level `const db = getConnection()` — every repository in this repo calls it per query, and
so does yours. You will want to read the acting user off the request now that `actor` exists — do
not; routes pass no context and the actor is `'operator'`, which is what the check asserts.
`autonomy` reads `False` in the expected output because the check formats a JSON `false` through
Python; if the API returned `0` instead of a JSON boolean the check fails, which is intended —
the field is a boolean on the wire. `src/shared/types.ts` is forbidden this phase: the frame is
declared server-side here, and its client mirror is Phase 5's.

## Phase 3 — Cards: summaries, multi-status lane paging, create, update, move, tags
Depends on: Phase 2

```toml
[phase]
id = "3"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "server/modules/kanban",
  "server/modules/database/repositories/kanban-cards.db.ts",
  "server/modules/database/repositories/kanban-card-tags.db.ts",
  "server/modules/database/index.ts",
  "server/shared/kanban-types.ts",
  "src/shared/api.ts",
  "/home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_3/",
]
forbidden = [
  "server/modules/descent",
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/kanban/kanban-write.service.ts",
  "server/modules/kanban/kanban-broadcast.service.ts",
  "server/shared/types.ts",
  "src/shared/types.ts",
  "server/index.ts",
]
athena = [
  "A card verb opens its own transaction, records its own event or broadcasts, instead of going through writeKanban",
  "listLaneCards takes one status instead of an array, or builds its IN clause by string-interpolating the statuses instead of by placeholders",
  "The keyset page is fetched per status and stitched, rather than one ordered page across status IN (...), so a two-status lane pages wrongly",
  "moveCard computes a midpoint that collides with an existing sort_order, or never renormalises when two neighbours are closer than 1e-6",
  "Lane paging uses OFFSET instead of the keyset cursor, so a card inserted mid-scroll is skipped or repeated",
  "The done lane is ordered by sort_order rather than updated_at descending, so it does not page newest first",
  "listLaneCards returns archived cards, or the lane counts and the lane pages disagree about what is in a lane",
  "laneCounts returns lane-shaped rows instead of one row per status, putting panel policy on the server",
  "A card summary's counts are computed with a query per card rather than one grouped query per page",
  "Moving a card off the active status leaves build_lease_at and build_owner set",
  "The limit parameter is not clamped, or an unknown status in the comma list is accepted instead of refused with a 400",
]

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-cards.db.ts"
what = "Grow the file Phase 2 opened, keeping its getSummary as written. Add insertCard, getCardRow, listLane(boardId, statuses: KanbanStatus[], limit, cursor) implementing the keyset paging and ordering rules from Interfaces with a status IN (...) clause whose placeholders are built from the array's length -- never string-interpolated -- as ONE ordered page across the whole set, updateCard, setStatusAndOrder, setArchived, laneBounds returning min and max sort_order for a status set, renormaliseLane, and one grouped counts query returning openQuestions, openIssues, checklistDone and checklistTotal for a set of card ids in ONE statement. If this file crosses 300 lines, split it by cohesion into a sibling (kanban-cards-paging.db.ts) rather than growing it."
check = "grep -c 'status IN' server/modules/database/repositories/kanban-cards.db.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-card-tags.db.ts"
what = "Create kanbanCardTagsDb: listTagsForCards(cardIds) returning one array per card in a single query, addTag and removeTag against kanban_card_tags."
check = "grep -c 'kanban_card_tags' server/modules/database/repositories/kanban-card-tags.db.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-cards.service.ts"
what = "Create the card verbs exactly as signed in Interfaces, every write through writeKanban and every write verb carrying the optional trailing context argument: listLaneCards(boardId, statuses, options), createCard, getCard, updateCard, moveCard, archiveCard, restoreCard, addTag, removeTag. moveCard implements the midpoint rule including the renormalisation branch, clears the build lease when the card leaves the active status, and passes a payload carrying the from and to status to the card.moved event. A move plus its renormalisation is ONE mutate callback, never two writeKanban calls."
check = "grep -ci 'renormalis' server/modules/kanban/kanban-cards.service.ts server/modules/database/repositories/kanban-cards.db.ts | awk -F: '{s+=$2} END {print s}'"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/card.routes.ts"
what = "Create createCardRoutes(services): Router carrying the card routes from the Interfaces route table: the lane page, create, detail, patch, move, archive, restore, and the two tag routes. Parse the status query parameter as a COMMA-SEPARATED LIST into KanbanStatus[] -- split, trim, drop empties -- and reject with a 400 both an empty list and any member that is not one of the five statuses, before the service is called. Clamp limit to 200 with a default of 50 and pass cursor through as an opaque string."
check = "grep -c 'cards/:cardId' server/modules/kanban/routes/card.routes.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/kanban.routes.ts"
what = "Mount createCardRoutes onto the router beside createBoardRoutes, and add the cards service field to the KanbanServices type this factory receives so it can hand the service to createCardRoutes. The identifier createCardRoutes appears on exactly ONE line of this file (reach it through a namespace import such as import * as cardRoutes if a named import would make it two). Nothing else in this file changes."
check = "grep -c 'createCardRoutes' server/modules/kanban/routes/kanban.routes.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add the card entries to the api.kanban group: laneCards taking a statuses string array and joining it with commas exactly as written in the Interfaces api surface, createCard, card, updateCard, moveCard, archiveCard, addTag, removeTag."
check = "grep -c 'statuses.join' src/shared/api.ts"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/kanban-p3-tc.log 2>&1 && npm run lint > /tmp/kanban-p3-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p3-tc.log; tail -5 /tmp/kanban-p3-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the seam still holds: no card verb transacts, records or broadcasts on its own
cmd = "test $(grep -rlE 'db\\.transaction|recordEvent|broadcastKanbanEvent' server/modules/kanban --include='*.ts' | grep -v 'kanban-write.service.ts' | grep -v 'kanban-broadcast.service.ts' | wc -l) -eq 0 && echo ONE-SEAM"
expect = "ONE-SEAM"

[[verify]]  # page a lane, page a TWO-STATUS lane (3 todo cards + 1 questions card = 4, the questions card inside it), move the middle card to the top and another to a second lane, read the order back
cmd = """
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p3-server.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
export TOKEN
RESULT=$(python3 - <<'PY'
import json, os, urllib.request, urllib.error
BASE, TOKEN = 'http://127.0.0.1:7893/api/kanban', os.environ['TOKEN']
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method,
                                     headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        return error.code, {}
board = call('POST', '/boards', {'name': 'probe-phase3'})[1]['board']
ids = [call('POST', '/boards/%s/cards' % board['id'], {'title': 'probe %d' % n, 'status': 'todo'})[1]['card']['id'] for n in range(3)]
qid = call('POST', '/boards/%s/cards' % board['id'], {'title': 'probe q', 'status': 'questions'})[1]['card']['id']
page = call('GET', '/boards/%s/cards?status=todo&limit=2' % board['id'])[1]
first_page, cursor = len(page['cards']), page['nextCursor'] is not None
rest = call('GET', '/boards/%s/cards?status=todo&limit=2&cursor=%s' % (board['id'], page['nextCursor']))[1]
both = call('GET', '/boards/%s/cards?status=todo,questions&limit=10' % board['id'])[1]['cards']
bad = call('GET', '/boards/%s/cards?status=todo,nonsense&limit=10' % board['id'])[0]
call('POST', '/cards/%s/move' % ids[1], {'status': 'todo', 'afterId': None, 'beforeId': ids[0]})
top = call('GET', '/boards/%s/cards?status=todo&limit=10' % board['id'])[1]['cards']
call('POST', '/cards/%s/move' % ids[2], {'status': 'active', 'afterId': None, 'beforeId': None})
lanes = {lane['status']: lane['total'] for lane in call('GET', '/boards/%s/lanes' % board['id'])[1]['lanes']}
call('PATCH', '/boards/%s' % board['id'], {'archived': True})
print('page=%d more=%s rest=%d both=%d qin=%s bad=%d top=%s todo=%d active=%d lease=%s ordered=%s' % (
    first_page, cursor, len(rest['cards']), len(both), any(card['id'] == qid for card in both), bad, top[0]['id'] == ids[1],
    lanes['todo'], lanes['active'], top[0]['leaseState'],
    all(top[i]['sortOrder'] < top[i + 1]['sortOrder'] for i in range(len(top) - 1))))
PY
)
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "$RESULT"
"""
expect = "page=2 more=True rest=1 both=4 qin=True bad=400 top=True todo=2 active=1 lease=none ordered=True"
timeout_s = 300
```

**What to build.** The card half of the module. No questions, issues, checklist or leases yet.

**Sirens.** You will want `listLaneCards` to take one status because every call site in this
phase passes one — it takes an ARRAY, because with autonomy off the To Do lane asks for `todo`
AND `questions` in one ordered page, and that is the whole reason the signature is shaped this
way. You will want to satisfy a two-status lane by querying each status and concatenating — that
breaks the keyset cursor the moment the page boundary falls between them; it is ONE query with
`status IN (…)`. You will want to build that `IN` clause with a template string — build the
placeholders from the array's length and bind the values. You will want to compute each card's
counts with a query per card because it reads cleanly — one grouped query per page is the rule,
and a 50-card lane must not cost 200 round trips. You will want to reorder a lane by rewriting
every row on every move — midpoint is the rule and renormalisation is the exception, taken only
when the gap closes below 1e-6. You will want `moveCard` to accept a numeric index — it does
not; it takes the two neighbour ids, because an index is a lie the moment another session moves
a card. You will want `laneCounts` to return the four lanes the UI shows — it returns one row
per STATUS; which statuses make a lane is the panel's policy and the server never learns it. You
will see that `getCard` returns a detail shape whose questions, issues, decisions, checklist and
attachments do not exist yet — return empty arrays for them this phase and fill them in Phase 4;
do not stub the tables. `kanban-write.service.ts` is forbidden this phase: if a card verb seems
to need the seam to change, that is a divergence to report, not an edit to make.

## Phase 4 — Card details: questions, issues, decisions, checklist, attachments, approve, leases
Depends on: Phase 3

```toml
[phase]
id = "4"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "server/modules/kanban",
  "server/modules/database/repositories/kanban-questions.db.ts",
  "server/modules/database/repositories/kanban-checklist.db.ts",
  "server/modules/database/repositories/kanban-leases.db.ts",
  "server/modules/database/repositories/kanban-cards.db.ts",
  "server/modules/database/repositories/kanban-approvals.db.ts",
  "server/modules/database/index.ts",
  "server/shared/kanban-types.ts",
  "src/shared/api.ts",
]
forbidden = [
  "server/modules/descent",
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/kanban/kanban-write.service.ts",
  "server/modules/kanban/kanban-broadcast.service.ts",
  "server/shared/types.ts",
  "src/shared/types.ts",
  "server/index.ts",
]
athena = [
  "A detail verb opens its own transaction, records its own event or broadcasts, instead of going through writeKanban",
  "The approve gate lets a card with an unanswered question through, or refuses a card that has a description but no plan and no body",
  "A not_ready card that passes the gate is approved without being promoted to todo, or is promoted in a second transaction instead of the same mutate callback",
  "The 40-second staleness is spelled as a literal instead of importing KANBAN_LEASE_STALE_SECONDS, or the leaseState on the summary disagrees with what a claim decides",
  "A REFUSED lease claim still records an event or broadcasts a frame, when it wrote nothing",
  "A claim by the SAME owner is refused rather than being an idempotent re-claim",
  "answerQuestion does not set answered and answered_at, or does not record the matching kanban_decisions row in the same mutate callback",
  "A question's options or selected array is stored as anything other than a JSON array of strings",
  "Posting a question does not move the card into the questions status, or moving it loses its sort_order",
  "The eighteen detail verbs were written into one kanban-details.service.ts instead of the three cohesive services",
  "The approve gate's card write was folded into kanban-cards.db.ts, pushing that file past the 300-line ceiling, instead of living in its kanban-approvals.db.ts sibling",
  "setApproved promotes a not_ready card in a second UPDATE rather than the same statement that approves it, or unapproveCard un-promotes the card, or either path rewrites sort_order",
]

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-questions.db.ts"
what = "Create kanbanQuestionsDb with the statements for kanban_questions and kanban_decisions: insert, list-by-card, get-by-id and update, plus the unanswered-question count the approve gate reads. JSON columns (options, selected, choice, tags) are parsed on read and stringified on write. BOTH table names appear in this one file -- the decisions insert and list live beside the questions statements, because answerQuestion writes them in one mutate callback -- and the check below reads each name on its own rather than counting occurrences: a file that names one table many times and the other never is not this deliverable."
check = "test $(grep -c 'kanban_questions' server/modules/database/repositories/kanban-questions.db.ts) -ge 1 && test $(grep -c 'kanban_decisions' server/modules/database/repositories/kanban-questions.db.ts) -ge 1 && echo BOTH-TABLES"
expect = "BOTH-TABLES"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-checklist.db.ts"
what = "Create kanbanChecklistDb with the statements for kanban_checklist_items, kanban_attachments and kanban_issues: insert, list-by-card, get-by-id, update and the checklist delete. All THREE table names appear in this one file, and the check below reads each on its own rather than counting occurrences: a file rich in checklist statements and silent on attachments or issues is not this deliverable."
check = "test $(grep -c 'kanban_checklist_items' server/modules/database/repositories/kanban-checklist.db.ts) -ge 1 && test $(grep -c 'kanban_attachments' server/modules/database/repositories/kanban-checklist.db.ts) -ge 1 && test $(grep -c 'kanban_issues' server/modules/database/repositories/kanban-checklist.db.ts) -ge 1 && echo THREE-TABLES"
expect = "THREE-TABLES"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-leases.db.ts"
what = "Create kanbanLeasesDb with the two compare-and-set statements on kanban_cards for the build lease and the plan lease, matching only when the lease is null, already the caller's, unparseable, or older than KANBAN_LEASE_STALE_SECONDS imported from server/shared/kanban-types.js, plus the clear statements. Never spell 40 here."
check = "grep -c 'KANBAN_LEASE_STALE_SECONDS' server/modules/database/repositories/kanban-leases.db.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-approvals.db.ts"
what = "Create kanbanApprovalsDb with the ONE statement the approve gate writes: setApproved({ id, approved, promoteTo? }) sets approved, approved_at and updated_at on kanban_cards, and status too when promoteTo is given -- ONE UPDATE, so a not_ready card's promotion cannot land without its approval. Un-approving clears the flag and the stamp and nothing else; neither path touches sort_order. It returns false when no such card exists. This statement is a SIBLING of kanban-cards.db.ts and is never another statement inside it: that file measures 299 lines against a 300-line ceiling, and these columns have exactly two callers, approveCard and unapproveCard. Export kanbanApprovalsDb from server/modules/database/index.ts beside the other kanban repositories, and run it on the caller's connection through getConnection() so a statement issued inside the write seam's transaction joins that transaction instead of opening a second."
check = "test $(grep -c 'setApproved' server/modules/database/repositories/kanban-approvals.db.ts) -ge 1 && test $(grep -c 'kanbanApprovalsDb' server/modules/database/index.ts) -ge 1 && echo APPROVALS-REPO"
expect = "APPROVALS-REPO"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-questions.service.ts"
what = "Create the questions verbs exactly as signed in Interfaces -- addQuestion, answerQuestion, approveCard, unapproveCard -- every write through writeKanban and every one carrying the optional trailing context argument. addQuestion also moves the card to the questions status when it is currently todo, in the SAME mutate callback. answerQuestion writes the kanban_decisions row in the same mutate callback. approveCard implements the approve gate from rule 3 of Interfaces, including promoting a not_ready card to todo and approving it in ONE mutate callback. approveCard and unapproveCard write the card's approved columns through kanbanApprovalsDb.setApproved -- the repository above -- and never through a statement of their own; the promotion rides on that same call's promoteTo, inside the one mutate callback."
check = "grep -c 'writeKanban' server/modules/kanban/kanban-questions.service.ts"
expect_re = "^[3-9]$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-checklist.service.ts"
what = "Create the checklist, attachment and issue verbs exactly as signed in Interfaces -- fileIssue, resolveIssue, addChecklistItem, updateChecklistItem, removeChecklistItem, addAttachment -- every write through writeKanban with the optional trailing context argument."
check = "grep -c 'writeKanban' server/modules/kanban/kanban-checklist.service.ts"
expect_re = "^[4-9]$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-leases.service.ts"
what = "Create the five lease verbs exactly as signed in Interfaces, implementing rule 4: a claim succeeds when the lease is unclaimed, already the caller's, or stale by KANBAN_LEASE_STALE_SECONDS. A SUCCESSFUL claim, refresh or release goes through writeKanban and records its lease.* event; a REFUSED claim writes nothing, records nothing, broadcasts nothing, and returns { granted: false } with the current summary and a 200. Lease verbs take an explicit owner and no context argument."
check = "grep -c 'granted' server/modules/kanban/kanban-leases.service.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/detail.routes.ts"
what = "Create createDetailRoutes(services): Router carrying the detail routes from the Interfaces route table: questions, answer, issues, resolve, checklist add and patch and delete, attachments, approve, unapprove, and the five lease routes."
check = "grep -c 'build-lease\\|plan-lease' server/modules/kanban/routes/detail.routes.ts"
expect_re = "^([5-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/kanban.routes.ts"
what = "Add exactly one line: mount createDetailRoutes onto the router beside the two already there. Nothing else in this file changes."
check = "grep -c 'createDetailRoutes' server/modules/kanban/routes/kanban.routes.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-cards.service.ts"
what = "getCard now returns the real questions, issues, decisions, checklist and attachments instead of the empty arrays Phase 3 left, reading them through the two new repositories. No other verb in this file changes."
check = "grep -c 'kanbanQuestionsDb\\|kanbanChecklistDb' server/modules/kanban/kanban-cards.service.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add the remaining api.kanban entries: addQuestion, answerQuestion, fileIssue, resolveIssue, addChecklistItem, updateChecklistItem, approveCard, unapproveCard."
check = "grep -c 'api/kanban/questions\\|api/kanban/issues\\|api/kanban/checklist' src/shared/api.ts"
expect_re = "^([3-9]|[1-9][0-9]+)$"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/kanban-p4-tc.log 2>&1 && npm run lint > /tmp/kanban-p4-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p4-tc.log; tail -5 /tmp/kanban-p4-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the seam still holds, and 40 is written in exactly one place
cmd = "test $(grep -rlE 'db\\.transaction|recordEvent|broadcastKanbanEvent' server/modules/kanban --include='*.ts' | grep -v 'kanban-write.service.ts' | grep -v 'kanban-broadcast.service.ts' | wc -l) -eq 0 && test $(grep -rn 'KANBAN_LEASE_STALE_SECONDS = 40' server/shared/kanban-types.ts | wc -l) -eq 1 && echo ONE-SEAM-ONE-CONSTANT"
expect = "ONE-SEAM-ONE-CONSTANT"

[[verify]]  # exercise the whole detail surface against the real routes, including both sides of the approve gate and a foreign lease
cmd = """
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p4-server.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
export TOKEN
RESULT=$(python3 - <<'PY'
import json, os, urllib.request, urllib.error
BASE, TOKEN = 'http://127.0.0.1:7893/api/kanban', os.environ['TOKEN']
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method,
                                     headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        return error.code, {}
board = call('POST', '/boards', {'name': 'probe-phase4'})[1]['board']
card = call('POST', '/boards/%s/cards' % board['id'], {'title': 'probe detail', 'status': 'todo', 'description': 'a real description'})[1]['card']
question = call('POST', '/cards/%s/questions' % card['id'], {'text': 'which shape', 'options': ['a', 'b']})[1]['question']
gate_closed = call('POST', '/cards/%s/approve' % card['id'])[0]
call('POST', '/questions/%s/answer' % question['id'], {'selected': ['a']})
gate_open = call('POST', '/cards/%s/approve' % card['id'])[0]
issue = call('POST', '/cards/%s/issues' % card['id'], {'text': 'a real defect'})[1]['issue']
call('POST', '/issues/%s/resolve' % issue['id'], {'resolvedBy': 'probe'})
item = call('POST', '/cards/%s/checklist' % card['id'], {'text': 'step one', 'note': 'a note'})[1]['item']
call('PATCH', '/checklist/%s' % item['id'], {'state': 'done'})
mine = call('POST', '/cards/%s/build-lease/claim' % card['id'], {'owner': 'probe-a'})[1]
again = call('POST', '/cards/%s/build-lease/claim' % card['id'], {'owner': 'probe-a'})[1]
foreign = call('POST', '/cards/%s/build-lease/claim' % card['id'], {'owner': 'probe-b'})[1]
detail = call('GET', '/cards/%s' % card['id'])[1]['card']
call('PATCH', '/boards/%s' % board['id'], {'archived': True})
print('gate=%d,%d q=%d,%s i=%d,%s k=%d,%s lease=%s,%s,%s state=%s decisions=%d' % (
    gate_closed, gate_open, len(detail['questions']), detail['questions'][0]['answered'],
    len(detail['issues']), detail['issues'][0]['resolved'],
    len(detail['checklist']), detail['checklist'][0]['state'],
    mine['granted'], again['granted'], foreign['granted'], detail['leaseState'], len(detail['decisions'])))
PY
)
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "$RESULT"
"""
expect = "gate=409,200 q=1,True i=1,True k=1,done lease=True,True,False state=held decisions=1"
timeout_s = 300
```

**What to build.** The rest of the model's verbs and routes, in three cohesive services.

**Sirens.** You will want one `kanban-details.service.ts` holding all eighteen verbs because they
arrived in one phase — that file is born over the ceiling; the three services here are cut by
what changes together, and the two repositories match them. You will want to make `approveCard`
forgiving because a refusal mid-demo is annoying — do not; the gate is Descent's and the 409 is
the point. You will want to add an `unapprove` shortcut that also un-promotes the card — do not;
unapprove clears `approved` and `approved_at` and nothing else. You will want to treat a foreign
fresh lease as an error — it is a normal answer: granted false with the current card and a 200,
and because it wrote nothing it records no event and sends no frame. You will want to re-derive
staleness with a literal `40` in the service because the import feels indirect — the number is
written once in `server/shared/kanban-types.ts` and the verify greps for exactly one occurrence.
You will want to store the options array as a comma-joined string — it is a JSON array of
strings, exactly as Descent stores it. The approve gate's 409 comes back through the global error
handler as a success-false envelope; that is the shape, and the check reads only the status code.
You will want to put `setApproved` into
`kanban-cards.db.ts` because every other card column is written there — do not; that file sits one
line under the ceiling and the approve gate's statement has its own sibling, `kanban-approvals.db.ts`,
already in this phase's manifest. `kanban-write.service.ts` is forbidden this phase.

## Phase 5 — The client's view of the frame, and the proof it arrives
Depends on: Phase 4

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 1500
manifest = [
  "src/shared/kanban-types.ts",
  "scripts/kanban-ws-probe.mjs",
]
forbidden = [
  "server/modules/descent",
  "server/modules/websocket",
  "server/modules/kanban",
  "server/shared/types.ts",
  "src/shared/types.ts",
  "server/index.ts",
  "server/modules/database",
  "src/modules",
]
athena = [
  "A type in the client mirror has drifted from its server twin -- a renamed field, a widened union, a dropped null",
  "The mirror was written into src/shared/types.ts instead of the sibling file, against the one-edit rule",
  "The mirror imports from server code instead of standing alone, which would couple the client bundle to the server tsconfig",
  "The probe script hard-codes a token, a port or a board id instead of taking them as arguments",
  "The probe reports success on any frame rather than on a kanban_event frame whose boardId matches",
  "The probe never exits, so the phase's verify hangs until its timeout instead of failing fast",
  "One of the seventeen types the step names is missing from the mirror, or a server-only shape (KanbanEventKind, KanbanWriteContext) was mirrored in as dead code with no client consumer",
  "TaskMaster's own TaskBoardView / TaskKanbanColumn lines in src/shared/types.ts were edited, renamed or deleted to make a check pass",
]

[[steps]]
kind = "edit"
path = "src/shared/kanban-types.ts"
what = "Create the client mirror of server/shared/kanban-types.ts: KanbanStatus, KanbanPriority, KanbanLeaseState, KanbanBoard, KanbanLaneCount, KanbanCardSummary, KanbanQuestion, KanbanIssue, KanbanDecision, KanbanChecklistItem, KanbanAttachment, KanbanCardDetail, KanbanEventRow, KanbanLeaseResult, KanbanImportCounts, KanbanImportResult, and KanbanBoardEvent -- the websocket frame, mirrored field-for-field from its declaration in server/shared/types.ts. Field for field, name for name, null for null. Those SEVENTEEN names are the whole deliverable: the server twin's KanbanEventKind and KanbanWriteContext are the write seam's own argument types, they have no client consumer, and mirroring them would be dead code -- leave them out, and the verify below excludes them by name rather than demanding a byte-identical name set. It imports nothing from server/; it is a standalone mirror, and the header comment says so and names server/shared/kanban-types.ts as its twin. Use type aliases, never interface, no const and no function, and give every type the brief comment the frontend standards ask for. The file may already exist from an earlier attempt of this phase: read it, hold it against this spec name by name and field by field, and correct what differs instead of deleting and rewriting it."
check = "grep -c '^export type Kanban' src/shared/kanban-types.ts"
expect_re = "^(1[0-9]|[2-9][0-9])$"

[[steps]]
kind = "edit"
path = "scripts/kanban-ws-probe.mjs"
what = "Create a small node script taking an app url, a token and a board id, opening the /ws socket with the token as a query parameter, collecting frames for up to 20 seconds, and printing one line reading FRAME kind=<event kind> card=<cardId> lanes=<n> for the first kanban_event whose boardId matches, or NO-FRAME, then exiting. It imports WebSocket from 'ws', already a dependency. It may already exist from an earlier attempt of this phase: read it against this spec and correct what differs rather than rewriting it."
check = "node --check scripts/kanban-ws-probe.mjs && echo PARSES"
expect = "PARSES"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/kanban-p5-tc.log 2>&1 && npm run lint > /tmp/kanban-p5-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p5-tc.log; tail -5 /tmp/kanban-p5-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the mirror carries its twin's type names plus the frame, declares no Kanban type in src/shared/types.ts, imports no server code, and exports nothing but types
cmd = """
diff <(grep -oE "^export type Kanban[A-Za-z]+" server/shared/kanban-types.ts | grep -vE "^export type (KanbanEventKind|KanbanWriteContext)$" | sort) <(grep -oE "^export type Kanban[A-Za-z]+" src/shared/kanban-types.ts | grep -vE "^export type KanbanBoardEvent$" | sort) > /tmp/kanban-p5-mirror.diff 2>&1
if [ -s /tmp/kanban-p5-mirror.diff ]; then echo "NAME DRIFT vs the server twin (< server only, > client only):"; cat /tmp/kanban-p5-mirror.diff; exit 0; fi
test "$(grep -cE "^export type KanbanBoardEvent" src/shared/kanban-types.ts || true)" -eq 1 || { echo "NO FRAME TYPE in src/shared/kanban-types.ts"; exit 0; }
test "$(grep -cE "^export (type|interface) Kanban" src/shared/types.ts || true)" -eq 0 || { echo "A Kanban type is declared in src/shared/types.ts:"; grep -nE "^export (type|interface) Kanban" src/shared/types.ts; exit 0; }
test "$(grep -cE "^[[:space:]]*import[^;]*server/" src/shared/kanban-types.ts || true)" -eq 0 || { echo "THE MIRROR IMPORTS FROM server/:"; grep -nE "^[[:space:]]*import[^;]*server/" src/shared/kanban-types.ts; exit 0; }
test "$(grep -cE "^export (interface|const|function|class) " src/shared/kanban-types.ts || true)" -eq 0 || { echo "THE MIRROR EXPORTS A NON-TYPE:"; grep -nE "^export (interface|const|function|class) " src/shared/kanban-types.ts; exit 0; }
echo MIRRORED
"""
expect = "MIRRORED"
timeout_s = 120

[[verify]]  # open a real websocket, create a card through the real route, and read the frame that arrives
cmd = """
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p5-server.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
BID=$(curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"name":"probe-phase5"}' http://127.0.0.1:7893/api/kanban/boards | python3 -c 'import sys, json; print(json.load(sys.stdin)["board"]["id"])')
node scripts/kanban-ws-probe.mjs http://127.0.0.1:7893 "$TOKEN" "$BID" > /tmp/kanban-p5-frame.txt 2>&1 &
sleep 3
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"probe frame","status":"todo"}' "http://127.0.0.1:7893/api/kanban/boards/$BID/cards" > /dev/null
sleep 6
curl -s -X PATCH -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"archived":true}' "http://127.0.0.1:7893/api/kanban/boards/$BID" > /dev/null
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
{ grep -o 'kind=card.created' /tmp/kanban-p5-frame.txt | head -1 || true; }
"""
expect = "kind=card.created"
timeout_s = 300
```

**What to build.** The client's mirror of the frame and the domain, the websocket probe, and the
end-to-end proof that a real write reaches a real socket.

**The fan-out is already built.** `writeKanban` broadcasts and `kanban-broadcast.service.ts`
fans out — both landed in Phase 2, because a write seam that calls a function which does not
exist cannot typecheck, and the seam had to be there before the first verb was written through
it. `server/modules/kanban/` is therefore FORBIDDEN this phase. What is genuinely open here is
the client's half: the mirror the panel will type its frames against, and a probe that proves a
real `card.created` crosses a real socket to a real client.

**Sirens.** You will want to put these types in `src/shared/types.ts` because that is where the
frontend standard sends a shared type — that file is 2078 lines and is forbidden here; it takes
exactly one edit in this whole plan, `AppTab | 'kanban'`, in Phase 9. You will want the mirror to
`import type` from `server/shared/` to guarantee it cannot drift — the client tsconfig does not
compile server code, and a real mirror with a verify comparing the two is the mechanism this repo
already uses (`server/shared/types.ts:264`). You will want to fix a server-side field you notice
is wrong while mirroring it — that is a divergence to report, not an edit to make; the server
module is forbidden. You will want the probe to resolve on the first frame of any kind — it must
match `kind === 'kanban_event'` AND the board id, or a `session_upserted` frame from another
window passes the phase. You will want the probe to wait out its full 20 seconds even on success
— print and exit, or the verify pays the wait every run.

**Two more, from the attempt that blocked here.** You will see `src/shared/types.ts` already
matching the word `kanban` three times — TaskMaster's own
`TaskBoardView = 'kanban' | 'list' | 'grid'` and its two comments at `:1756`, `:1757` and `:1765`,
plus `TaskKanbanColumn` at `:1766`. That is another feature's committed prior art, not drift and
not this board's: do not touch it, do not rename it, do not "clean it up" to make a check pass,
and do not count it as a violation. The rule this phase actually keeps is that no `Kanban*` type
is DECLARED in that file, and the verify above reads exactly that (`^export type Kanban`, zero
matches) rather than the bare word. And you will find `src/shared/kanban-types.ts` and
`scripts/kanban-ws-probe.mjs` already on disk from that earlier attempt — read them against this
spec and correct what differs; do not assume they are right because they exist, and do not delete
and rewrite them wholesale.

## Phase 6 — The Descent importer, server side
Depends on: Phase 4

```toml
[phase]
id = "6"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "server/modules/kanban",
  "server/modules/database/repositories/kanban-import.db.ts",
  "server/modules/database/index.ts",
  "server/shared/kanban-types.ts",
  "src/shared/api.ts",
]
forbidden = [
  "server/modules/descent",
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/kanban/kanban-write.service.ts",
  "server/modules/kanban/kanban-broadcast.service.ts",
  "server/shared/types.ts",
  "src/shared/types.ts",
  "server/index.ts",
]
athena = [
  "The service opens the source database itself instead of going through kanban-import.transport.ts, putting a foreign connection in a service",
  "The transport opens the source without readonly or without fileMustExist, so a run can write to descent.db",
  "The transport does not check that the ov_* tables exist, so a wrong file fails deep in the mapping instead of with a 404",
  "The cards or boards upsert has no WHERE excluded.updated_at >= ... guard, so a re-import silently overwrites a card edited in LypheCLI",
  "The guard was copied onto the child tables too, leaving a card's questions half from each side",
  "A second run inserts duplicates because a table's upsert does not key on descent_id",
  "A re-import mints new LypheCLI ids for rows that already exist, breaking every link that pointed at them",
  "The import broadcasts one frame per imported card instead of exactly one import.descent frame with card null",
  "An event whose feature_id names a missing card aborts the whole import instead of landing with a null card id",
  "Descent daemon settings other than current_board are imported",
  "The import runs outside one transaction, so a failure halfway leaves a half-imported board",
  "Card sort_order, approved_at, the build_tokens_* counters or the lease columns are dropped in the mapping",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-import.transport.ts"
what = "Create the foreign-read transport described in the Interfaces importer section: open the source descent.db with better-sqlite3 and the options readonly true and fileMustExist true; validate that the nine ov_* tables exist by querying sqlite_master and throw AppError with statusCode 404 naming the first missing one; read each table into a TYPED row array whose row types are declared in this file; close the handle in a finally. It writes nothing, maps nothing, and never mentions a kanban_ table."
check = "grep -c 'readonly: true' server/modules/kanban/kanban-import.transport.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-import.db.ts"
what = "Create kanbanImportDb: one upsert statement per target table, each keyed on descent_id with ON CONFLICT DO UPDATE naming every non-key column, plus the INSERT OR IGNORE for kanban_card_tags and the lookup that maps a descent id to an existing LypheCLI id. The kanban_cards and kanban_boards upserts -- and ONLY those two -- carry the trailing WHERE excluded.updated_at >= <table>.updated_at guard from the Interfaces importer section, so Descent wins only when it is newer. If this file crosses 300 lines, split it by cohesion into a sibling rather than growing it."
check = "grep -c 'WHERE excluded.updated_at' server/modules/database/repositories/kanban-import.db.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-import.service.ts"
what = "Create importFromDescent: call kanban-import.transport.ts for the source rows, then write EVERYTHING through ONE writeKanban call whose spec is kind import.descent with cardId null and whose mutate callback does the whole mapping in the order boards, cards, tags, questions, issues, decisions, checklist, attachments, events. Map ids through descent_id, translate current_board through the board id map into kanban_settings, skip every other ov_settings row, and return the KanbanImportResult shape. Because the seam records one event and sends one frame per call, the import produces exactly one import.descent event and exactly one frame carrying card null and the board's fresh lane counts -- never one per row."
check = "grep -c 'writeKanban' server/modules/kanban/kanban-import.service.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/import.routes.ts"
what = "Create createImportRoutes(services): Router carrying POST /import/descent, reading an optional dbPath from the body and returning the KanbanImportResult. A missing or unreadable source file surfaces as the transport's 404 with a plain error message."
check = "grep -c 'import/descent' server/modules/kanban/routes/import.routes.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/kanban.routes.ts"
what = "Add exactly one line: mount createImportRoutes onto the router beside the three already there. Nothing else in this file changes."
check = "grep -c 'createImportRoutes' server/modules/kanban/routes/kanban.routes.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add importDescent to the api.kanban group."
check = "grep -c 'importDescent' src/shared/api.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/kanban-p6-tc.log 2>&1 && npm run lint > /tmp/kanban-p6-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p6-tc.log; tail -5 /tmp/kanban-p6-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # the seam still holds, and the service opens no database of its own
cmd = "test $(grep -rlE 'db\\.transaction|recordEvent|broadcastKanbanEvent' server/modules/kanban --include='*.ts' | grep -v 'kanban-write.service.ts' | grep -v 'kanban-broadcast.service.ts' | wc -l) -eq 0 && test $(grep -c \"from 'better-sqlite3'\" server/modules/kanban/kanban-import.service.ts) -eq 0 && echo SEAM-AND-TRANSPORT"
expect = "SEAM-AND-TRANSPORT"

[[verify]]  # import a real copy of descent.db twice into a scratch database, compare row counts, and prove exactly one import event per run
cmd = """
cp ~/.claude/descent/descent.db /tmp/kanban-descent-source.db
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
rm -f /tmp/kanban-import.db /tmp/kanban-import.db-journal
DATABASE_PATH=/tmp/kanban-import.db SERVER_PORT=7895 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p6-server.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7895/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"username":"probe","password":"probe-pass-123"}' http://127.0.0.1:7895/api/auth/register | python3 -c 'import sys, json; print(json.load(sys.stdin)["token"])')
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"dbPath":"/tmp/kanban-descent-source.db"}' http://127.0.0.1:7895/api/kanban/import/descent > /tmp/kanban-p6-run1.json
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"dbPath":"/tmp/kanban-descent-source.db"}' http://127.0.0.1:7895/api/kanban/import/descent > /tmp/kanban-p6-run2.json
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
python3 - <<'PY'
import sqlite3
source = sqlite3.connect('/tmp/kanban-descent-source.db')
target = sqlite3.connect('/tmp/kanban-import.db')
pairs = [('ov_boards', 'kanban_boards'), ('ov_features', 'kanban_cards'), ('ov_tags', 'kanban_card_tags'),
         ('ov_questions', 'kanban_questions'), ('ov_issues', 'kanban_issues'), ('ov_decisions', 'kanban_decisions'),
         ('ov_checklist_items', 'kanban_checklist_items'), ('ov_attachments', 'kanban_attachments')]
same = all(source.execute('select count(*) from ' + a).fetchone()[0] == target.execute('select count(*) from ' + b).fetchone()[0] for a, b in pairs)
events_ok = target.execute('select count(*) from kanban_events').fetchone()[0] >= source.execute('select count(*) from ov_events').fetchone()[0]
imports = target.execute("select count(*) from kanban_events where kind='import.descent'").fetchone()[0]
current = target.execute("select count(*) from kanban_settings where key='current_board'").fetchone()[0]
settings = target.execute('select count(*) from kanban_settings').fetchone()[0]
print('counts=%s events=%s imports=%d current=%d settings=%d' % (same, events_ok, imports, current, settings))
PY
"""
expect = "counts=True events=True imports=2 current=1 settings=1"
timeout_s = 900

[[verify]]  # a card edited locally after its Descent row survives a re-import
cmd = """
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('/tmp/kanban-import.db')
row = db.execute("select id, updated_at from kanban_cards where descent_id is not null order by id limit 1").fetchone()
db.execute("update kanban_cards set title='locally edited', updated_at='2999-01-01T00:00:00Z' where id=?", (row[0],))
db.commit()
db.close()
PY
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
DATABASE_PATH=/tmp/kanban-import.db SERVER_PORT=7895 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p6-server2.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7895/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"username":"probe","password":"probe-pass-123"}' http://127.0.0.1:7895/api/auth/login | python3 -c 'import sys, json; print(json.load(sys.stdin)["token"])')
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"dbPath":"/tmp/kanban-descent-source.db"}' http://127.0.0.1:7895/api/kanban/import/descent > /dev/null
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
python3 - <<'PY'
import sqlite3
n = sqlite3.connect('/tmp/kanban-import.db').execute("select count(*) from kanban_cards where title='locally edited'").fetchone()[0]
print('kept' if n == 1 else 'OVERWRITTEN')
PY
"""
expect = "kept"
timeout_s = 600

[[verify]]  # the source database was not modified by the import
cmd = "python3 -c \"import hashlib; a=hashlib.sha256(open('/tmp/kanban-descent-source.db','rb').read()).hexdigest(); b=hashlib.sha256(open('/home/lyphe/.claude/descent/descent.db','rb').read()).hexdigest(); print('SAME' if a==b else 'SOURCE-LIVE-OR-DRIFTED')\""
expect_re = "^(SAME|SOURCE-LIVE-OR-DRIFTED)$"
```

**What to build.** The transport, the importer, its repository and its route. The dialog that
calls it is Phase 12.

**Sirens.** You will want to open the source database inside `kanban-import.service.ts` because
it is one line of `better-sqlite3` — the foreign read is a transport; a service in this module
never holds a foreign connection, and the verify greps for exactly that. You will want to call
`writeKanban` per table, or per row, because the mapping is long — it is called ONCE, and the
whole mapping happens inside its single `mutate` callback; 449 cards must produce one event and
one frame, not 449 of each. You will want to preserve Descent's ids as the primary keys because
the mapping is extra work — do not; `f-449` would collide with a locally minted id the first time
a card is created, and `descent_id` is what makes a re-import an update. You will want to put the
`updated_at` guard on every table for consistency — only cards and boards carry it; a guarded
child table would leave a card's questions half from each side. You will want to import all
nineteen `ov_settings` rows because they are right there — exactly one is imported,
`current_board`; the rest are Descent daemon state (`mcp_active_pid`, `pm_capacity_governor`,
`schema_version`, `theme` and the like) and mean nothing here. You will want to open the source
read-write so you can mark rows as imported — the source is opened readonly and is never written;
the last verify hashes it to prove that. Descent is a LIVE system: its row counts will differ
from the numbers in Interfaces by the time this runs, which is why every assertion compares
source to target rather than to a literal, and why the hash check accepts a drifted source while
still refusing one this run modified.

## Phase 7 — Kit scaffold: KanbanLane and KanbanCard, composed
Depends on: none

```toml
[phase]
id = "7"
kind = "scaffold"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/shared/ui/KanbanLane.tsx",
  "src/shared/ui/KanbanCard.tsx",
  "src/shared/ui/verve/board.css",
  "src/shared/ui/index.ts",
]
forbidden = [
  "src/shared/ui/verve/controls.css",
  "src/shared/ui/verve/feedback.css",
  "src/shared/ui/verve/tokens.css",
  "src/modules/task-master",
  "package.json",
]
athena = [
  "A colour literal or a hex value appears in either component file instead of a vv- class or a token",
  "The medium priority renders a visible mark on the card face, which the ruling forbids",
  "A lane is toned, or a done card is dimmed with opacity in a way that drops its text below contrast",
  "More than two toned elements can appear on one card face at rest, or the precedence order is not the ruled one",
  "The lane takes children instead of the cards array, so it cannot own the drop index",
  "A component branches on laneId, or contains one of the strings todo / not_ready / questions / active / done, putting board policy in the kit",
  "The + button or the empty-state add action is decided by a lane id instead of by whether onAddCard was passed",
  "muted is derived inside the lane from its own id rather than taken as the prop the panel passes",
  "A new npm dependency was added for drag and drop",
  "The card renders a nested interactive element inside another button, breaking keyboard order",
]

[[steps]]
kind = "edit"
path = "src/shared/ui/KanbanCard.tsx"
what = "Compose the card to the Iris ruling in Interfaces: the prop type verbatim, the markup and the Verve components, every state's classes, the density numbers, the colour ladder with medium silent, the two-tone budget and its precedence, and the li with its roving tabIndex and aria attributes. muted is taken as a prop and never derived. Every handler body is the marker /* FILL(8): <what it must do> */ and nothing else; no logic ships in this phase. Every user-facing word arrives as a prop, and no Descent status word appears anywhere in the file."
check = "grep -c 'text-warn-ink' src/shared/ui/KanbanCard.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/ui/KanbanLane.tsx"
what = "Compose the lane to the ruling: the prop type verbatim -- laneId an OPAQUE string, muted and onAddCard optional -- the header composition, the ScrollArea body, the skeleton, empty and paging-tail states, the insertion-edge rendering, and the Load more button. The + button and the empty-state add action render only when onAddCard is present; the ActionMenu renders whatever menuItems array it was handed; muted is passed straight down to every card. Every handler body is the marker /* FILL(8): <what it must do> */ -- the drop index maths, the IntersectionObserver and the keyboard resolver are Phase 8's."
check = "grep -c 'ScrollArea' src/shared/ui/KanbanLane.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/ui/verve/board.css"
what = "Create the third Verve stylesheet holding every .vv-lane, .vv-lane__head, .vv-lane-card and variant rule the two components reference. Colours come from tokens only. Nothing here duplicates a rule in controls.css or feedback.css."
check = "grep -c '^\\.vv-lane' src/shared/ui/verve/board.css"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/ui/index.ts"
what = "Side-effect import board.css beside the controls.css and feedback.css imports, and export KanbanLane and KanbanCard plus their public types in the existing alphabetical export block."
check = "grep -c 'board.css' src/shared/ui/index.ts"
expect = "1"

[[steps]]
kind = "run"
cmd = "node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint:client"
check = "node_modules/.bin/tsc --noEmit -p tsconfig.json > /tmp/kanban-p7-tc.log 2>&1 && npm run lint:client > /tmp/kanban-p7-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p7-tc.log; tail -5 /tmp/kanban-p7-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # no colour literal in either component, and no drag dependency added
cmd = "test $(grep -lE '#[0-9a-fA-F]{3,8}|rgba?\\(' src/shared/ui/KanbanCard.tsx src/shared/ui/KanbanLane.tsx | wc -l) -eq 0 && test $(grep -cE 'dnd-kit|react-dnd|react-beautiful-dnd' package.json) -eq 0 && echo CLEAN"
expect = "CLEAN"

[[verify]]  # the kit speaks no Descent: no status word, no laneId branch
cmd = "test $(grep -cE \"'(todo|not_ready|questions|active|done)'\" src/shared/ui/KanbanCard.tsx src/shared/ui/KanbanLane.tsx | awk -F: '{s+=$2} END {print s}') -eq 0 && echo NO-DESCENT"
expect = "NO-DESCENT"

[[verify]]  # the markers Phase 8 will fill are present and named
cmd = "test $(grep -rc 'FILL(8)' src/shared/ui/KanbanCard.tsx src/shared/ui/KanbanLane.tsx | awk -F: '{s+=$2} END {print s}') -ge 4 && echo MARKED"
expect = "MARKED"

[[verify]]  # the client still builds with the two new components in the barrel
cmd = "npm run build:client > /tmp/kanban-p7-build.log 2>&1 && echo BUILD-OK || tail -8 /tmp/kanban-p7-build.log"
expect = "BUILD-OK"
timeout_s = 600
```

**What to build.** Composition and paint. No behaviour.

**Sirens.** You will want to generalise `src/modules/task-master/TaskCard.tsx` into this card
because they look alike — do not; that file is forbidden this phase. TaskCard is inert
presentation whose click opens a modal, while this card is a drag handle with lease, approval and
optimistic-move lifecycle, and collapsing them would put write state into a presentational
component. What you inherit from it is the three-step priority ladder and "high is amber, never
red", already argued there. You will want to squeeze the new rules into `controls.css` — it and
`feedback.css` are forbidden this phase for exactly that reason. You will want to render the
`medium` priority because the card looks unbalanced without it — that silence is the ruling's
load-bearing line: nearly every card is medium, and printing it turns the ladder into wallpaper.
You will want to install a drag library — `package.json` is forbidden this phase. You will want
to implement the drop maths while you are in the file — leave the marker; Phase 8 fills it, and a
half-written reducer here is what that split exists to prevent. You will want to write
`laneId === 'done' && muted` or `laneId !== 'done' && <AddButton/>` because it is obviously
right for this board — `laneId` is an OPAQUE string to these two files, and the moment either
compares it to a literal the kit stops being kit and becomes a Descent board wearing a kit's
name. `muted` is a prop. The `+` renders because `onAddCard` was passed. The menu renders what
`menuItems` holds. The panel decides all three, in `utils/lanePolicy.ts`. The gate here is the
CLIENT tsconfig and `oxlint src/` only, not the full `npm run typecheck` — this phase runs in the
same wave as Phase 1 and the two must not gate on each other's tree.

## Phase 8 — Kit fill: the components' behaviour, and the UI probe
Depends on: Phase 7

```toml
[phase]
id = "8"
kind = "fill"
scaffold_of = "7"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/shared/ui/KanbanLane.tsx",
  "src/shared/ui/KanbanCard.tsx",
  "scripts/kanban-ui-probe.mjs",
]
forbidden = [
  "src/shared/ui/verve/board.css",
  "src/shared/ui/verve/controls.css",
  "src/shared/ui/verve/feedback.css",
  "package.json",
  "src/modules",
]
athena = [
  "A FILL marker was deleted without its behaviour being implemented",
  "The drop index is computed from the event target rather than from the pointer position against the card rectangles, so dropping on a gap misplaces the card",
  "The IntersectionObserver is created per render or never disconnected, so a long-lived board leaks observers",
  "The keyboard move handler swallows the arrow keys the lane needs for focus movement, or fires on a plain arrow instead of the modified one",
  "The component reaches for data or an api call instead of calling the props it was given",
  "A filled handler branches on laneId or introduces a Descent status word, putting board policy back into the kit",
  "The probe script hard-codes a token, a port or a project name instead of taking them as arguments",
]

[[steps]]
kind = "edit"
path = "src/shared/ui/KanbanCard.tsx"
what = "Replace every FILL(8) marker with its behaviour: the native HTML5 drag handlers putting the card id on dataTransfer, the open handler, and the keyboard handler that fires onMove for Ctrl or Cmd with an arrow and leaves a plain arrow to the lane. No marker remains and no api call appears."
check = "grep -c 'dataTransfer' src/shared/ui/KanbanCard.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/ui/KanbanLane.tsx"
what = "Replace every FILL(8) marker: the dragover handler computing the insertion index from the pointer against the rendered card rectangles, the drop handler calling onDropCard with that index, the IntersectionObserver sentinel calling onLoadMore once per intersection and disconnecting on unmount, and the roving tabIndex bookkeeping."
check = "grep -c 'IntersectionObserver' src/shared/ui/KanbanLane.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "scripts/kanban-ui-probe.mjs"
what = "Create the headless probe: node scripts/kanban-ui-probe.mjs <appUrl> <token> <projectName> <tabLabel> [expect...]. It spawns the playwright chrome-headless-shell at /home/lyphe/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell (overridable with CHROME_HEADLESS_SHELL) with a remote debugging port, drives it over CDP using the ws package, navigates to the app, writes the token into localStorage under the key auth-token, reloads, clicks the project by its visible name when no role=tab element is present yet, clicks the tab whose aria-label matches, waits for every expected string to appear in document.body.innerText, and prints a last line of PROBE OK or PROBE FAILED. These mechanics are proven on this box; keep them."
check = "node --check scripts/kanban-ui-probe.mjs && echo PARSES"
expect = "PARSES"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/kanban-p8-tc.log 2>&1 && npm run lint > /tmp/kanban-p8-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p8-tc.log; tail -5 /tmp/kanban-p8-lint.log)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # every marker is gone
cmd = "{ grep -rc 'FILL(8)' src/shared/ui/KanbanCard.tsx src/shared/ui/KanbanLane.tsx | awk -F: '{s+=$2} END {print s}' || true; }"
expect = "0"

[[verify]]  # the kit still speaks no Descent after the fill
cmd = "test $(grep -cE \"'(todo|not_ready|questions|active|done)'\" src/shared/ui/KanbanCard.tsx src/shared/ui/KanbanLane.tsx | awk -F: '{s+=$2} END {print s}') -eq 0 && echo NO-DESCENT"
expect = "NO-DESCENT"

[[verify]]  # the components still hold no data access of their own
cmd = "test $(grep -rcE \"from '@/shared/api'|api\\.kanban\" src/shared/ui/KanbanCard.tsx src/shared/ui/KanbanLane.tsx | awk -F: '{s+=$2} END {print s}') -eq 0 && echo PURE"
expect = "PURE"

[[verify]]  # the client builds
cmd = "npm run build:client > /tmp/kanban-p8-build.log 2>&1 && echo BUILD-OK || tail -8 /tmp/kanban-p8-build.log"
expect = "BUILD-OK"
timeout_s = 600
```

**What to build.** The behaviour behind Phase 7's markers, and the probe every later UI phase runs.

**Sirens.** You will want to restyle something while you are in the file — the paint is
`board.css` and it is forbidden this phase; a class that is missing is a divergence to report.
You will want the lane to fetch its own next page — it calls `onLoadMore` and nothing else; the
data lives in the panel. You will want a handler to check `laneId` to decide something — it is an
opaque string here; whatever the decision is, the panel already made it and passed it as a prop. You will want to implement the drop as "append to the end" because the
index maths is fiddly — the index is what makes a drop land where the reader aimed, and the
insertion line already promised it.

## Phase 9 — Board scaffold: the tab, the panel, the lane policy, the screens
Depends on: Phase 8

```toml
[phase]
id = "9"
kind = "scaffold"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/modules/kanban",
  "src/shared/types.ts",
  "src/modules/project-workspace/WorkspaceTabs.tsx",
  "src/modules/project-workspace/WorkspaceMain.tsx",
  "src/modules/project-workspace/ProjectCommandPalette.tsx",
  "src/modules/project-workspace/hooks/useProjectsState.ts",
  "src/modules/command-palette/CommandPalette.tsx",
]
forbidden = [
  "src/modules/project-workspace/hooks/useWorkspaceTabGates.ts",
  "src/modules/project-workspace/ProjectSidebarRegion.tsx",
  "src/shared/ui/KanbanCard.tsx",
  "src/shared/ui/KanbanLane.tsx",
  "src/shared/kanban-types.ts",
  "server/modules/kanban",
  "src/shared/api.ts",
]
athena = [
  "The panel is mounted unconditionally or imported somewhere that renders before the tab is active",
  "AppTab gained 'kanban' but VALID_TABS did not, so a persisted activeTab of kanban silently falls back to chat",
  "More than the one sanctioned line changed in src/shared/types.ts",
  "The tab was added to the strip but not to both command palette lists, so the row is filtered out and never shows",
  "The lane composition is written inline in KanbanPanel instead of coming from utils/lanePolicy.ts, so the same policy will be re-decided in the drawer and the drag hook",
  "lanePolicy does not fold questions cards into the To Do lane when autonomy is off, or does not narrow To Do to todo alone when it is on",
  "The Open questions lane is composed as always present rather than as the autonomy-gated fifth lane",
  "KanbanPanel does not take projectId, so the first-mount board selection of Phase 10 has nothing to work with",
  "A lane title, an empty-state sentence or a menu row is a literal string instead of a t() key",
  "The board header invents a page-level shell instead of inheriting the workspace tab's chrome",
  "A colour literal appears in a screen file",
  "The lint gate reports GREEN because its path filter stopped covering a file this phase writes, rather than because that file lints clean",
  "npm run typecheck was narrowed, skipped or made non-gating -- the AppTab union is repo-wide, and the full typecheck is the only thing that catches a file outside this manifest that the union broke",
  "The foreign lint error was cured rather than noted: .oxlintrc.json or a file under server/modules/providers was edited, neither of which this phase may write",
]

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "ONE edit, and the only edit this plan makes to this 2078-line file: add | 'kanban' to the AppTab union at line 54. Nothing else in this file changes; the board's own types live in src/shared/kanban-types.ts."
check = "grep -c \"^export type AppTab = .*'kanban'\" src/shared/types.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/project-workspace/hooks/useProjectsState.ts"
what = "Add 'kanban' to the VALID_TABS Set at line 349 so a persisted activeTab of kanban survives a reload."
check = "grep -c \"'kanban'\" src/modules/project-workspace/hooks/useProjectsState.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/kanban/utils/lanePolicy.ts"
what = "Create the board's lane policy exactly as specified in the Interfaces panel section: the KanbanLaneSpec type and kanbanLanes(autonomy: boolean): KanbanLaneSpec[], returning the four lanes of the autonomy-off table -- To Do carrying BOTH 'todo' and 'questions' -- and the five of autonomy-on, where To Do narrows to 'todo' alone and Open questions is inserted between To Do and In Progress. Titles are t() keys, not literals. This is the ONE place these decisions are written; nothing else in the module may name a status."
check = "grep -c 'export function kanbanLanes' src/modules/kanban/utils/lanePolicy.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanPanel.tsx"
what = "Compose the tab pane. It takes one prop, projectId: string, and composes the board header, then the lane rail holding one KanbanLane per spec returned by kanbanLanes(autonomy) in that order, passing each lane its title, its onAddCard only when spec.canAdd, and its muted from spec.muted. Compose the Spinner, EmptyState and the board's single aria-live region. Every data value comes from a prop or a hook that Phase 10 writes; every handler body is the marker /* FILL(10): <what it must do> */."
check = "grep -c 'kanbanLanes' src/modules/kanban/KanbanPanel.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanBoardHeader.tsx"
what = "Compose the board header to the ruling: the Select switcher, the Autonomy label and Switch, and the ActionMenu holding New board, Rename, Archive, a divider and Import from Descent. Handlers are FILL(10) markers."
check = "grep -c 'Switch' src/modules/kanban/KanbanBoardHeader.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/index.ts"
what = "Create the barrel exporting KanbanPanel only, with a comment naming WorkspaceMain as its consumer. Nothing else in this module is exported -- not the hooks, not the drawer, not utils."
check = "grep -c 'KanbanPanel' src/modules/kanban/index.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/project-workspace/WorkspaceTabs.tsx"
what = "Add KanbanSquare to the lucide-react import and one entry for the kanban tab with labelKey tabs.kanban to BASE_TABS, directly after the git entry. Nothing else changes: an always-visible tab carries no gate."
check = "grep -c \"labelKey: 'tabs.kanban'\" src/modules/project-workspace/WorkspaceTabs.tsx"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/project-workspace/WorkspaceMain.tsx"
what = "Import KanbanPanel from '@/modules/kanban' and add the mount block after the runner block at lines 389-393, in the same shape: the active-tab test and a div wrapping <KanbanPanel projectId={selectedProject.projectId} />. selectedProject is already a prop of this component and the component early-returns at line 293 when it is null, so no guard is needed at line 389."
check = "grep -c \"activeTab === 'kanban'\" src/modules/project-workspace/WorkspaceMain.tsx"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/command-palette/CommandPalette.tsx"
what = "Add a kanban row to NAV_TABS at lines 70-78, matching the shape of the runner row."
check = "grep -c 'kanban' src/modules/command-palette/CommandPalette.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/project-workspace/ProjectCommandPalette.tsx"
what = "Add 'kanban' to the unconditional visibleTabs seed at line 52, so the palette row is not filtered out."
check = "grep -c \"'kanban'\" src/modules/project-workspace/ProjectCommandPalette.tsx"
expect = "1"

[[steps]]
kind = "run"
what = "The gate. npm run typecheck runs in FULL and gates in full: the AppTab union is repo-wide, so a tsc error in any file at all is this phase's to answer. npm run lint also runs in FULL, but the GATE reads only the seven manifest paths above, because as measured on 2026-09-15 the repo's lint exits 1 on exactly ONE error -- server/modules/providers/list/claude/session-host/readopt.ts:24, boundaries(no-unknown) on an import of @/supervised-boot.js -- left by another session that is still editing .oxlintrc.json in this same working tree. That error is not this phase's, its cure is a boundaries/elements entry in a file no phase of this plan may write, and it is NOT cured here. The gate is red when any error line names one of this phase's seven manifest paths, and red when src/modules/kanban/ produces any line at all, error or warning: the module this phase authors is held to zero, stricter than the repo around it."
cmd = "npm run typecheck && npm run lint > /tmp/kanban-p9-lint.log 2>&1; grep -E ': error ' /tmp/kanban-p9-lint.log || echo 'no lint error anywhere in the repo'"
check = '''
npm run typecheck > /tmp/kanban-p9-tc.log 2>&1 || { echo TYPECHECK-RED; tail -8 /tmp/kanban-p9-tc.log; exit 1; }
npm run lint > /tmp/kanban-p9-lint.log 2>&1
MINE='^(src/modules/kanban/|src/shared/types\.ts:|src/modules/project-workspace/WorkspaceTabs\.tsx:|src/modules/project-workspace/WorkspaceMain\.tsx:|src/modules/project-workspace/ProjectCommandPalette\.tsx:|src/modules/project-workspace/hooks/useProjectsState\.ts:|src/modules/command-palette/CommandPalette\.tsx:)'
OWN=$({ grep -E "$MINE" /tmp/kanban-p9-lint.log | grep -cE ': error ' || true; })
KB=$({ grep -cE '^src/modules/kanban/' /tmp/kanban-p9-lint.log || true; })
if [ "$OWN" = 0 ] && [ "$KB" = 0 ]; then echo GREEN; else echo "OWN-ERRORS=$OWN KANBAN-LINT-LINES=$KB"; grep -E "$MINE" /tmp/kanban-p9-lint.log | head -12; fi
'''
expect = "GREEN"
timeout_s = 900

[[verify]]  # the markers Phase 10 will fill are present
cmd = "test $(grep -rc 'FILL(10)' src/modules/kanban | awk -F: '{s+=$2} END {print s}') -ge 4 && echo MARKED"
expect = "MARKED"

[[verify]]  # lane composition lives in one file, and no other file in the module names a status
cmd = "test $(grep -rlE \"'(todo|not_ready|questions|active|done)'\" src/modules/kanban | grep -v 'utils/lanePolicy.ts' | wc -l) -eq 0 && echo ONE-POLICY"
expect = "ONE-POLICY"

[[verify]]  # no colour literal in the screens
cmd = "test $(grep -rlE '#[0-9a-fA-F]{3,8}|rgba?\\(' src/modules/kanban | wc -l) -eq 0 && echo CLEAN"
expect = "CLEAN"

[[verify]]  # the module this phase authors carries no lint line of its own, error or warning
cmd = "test $({ node_modules/.bin/oxlint src/modules/kanban 2>&1 | grep -cE ': (error|warning) ' || true; }) -eq 0 && echo MODULE-CLEAN"
expect = "MODULE-CLEAN"
timeout_s = 300
```

**What to build.** The screens, the lane policy and the tab wiring, composed. The data comes next
phase. Every file this phase names may ALREADY exist, from an earlier attempt whose work was left
in the working tree: read each one first, bring it to what its step says, and leave a step that is
already satisfied alone — never restart a file from empty because you did not write it yourself.

**Sirens.** You will want to add a `shouldShowKanbanTab` to `useWorkspaceTabGates.ts` — that file
is forbidden this phase, because the convention for an always-visible tab is the ABSENCE of a
gate, exactly as chat, files and git have none. You will want to write the fetch while you are in
`KanbanPanel.tsx` — leave the marker; the hooks are Phase 10's. You will want to compose the four
lanes inline because it is four lines of JSX — they come from `kanbanLanes(autonomy)`, because
the drawer and the drag hook need the same answer and a second copy is where the two drift. You
will want to hide a `questions` card while autonomy is off — it belongs in the To Do lane with
its chip, which is exactly what the lane policy's two-status To Do delivers, and the status is
never rewritten to make the UI simpler. You will want to add more than one line to
`src/shared/types.ts` while you are in it — that file takes exactly one edit in this entire plan
and a check counts it. This phase gates on the FULL `npm run typecheck`, and it
passes: `AppTab` and `VALID_TABS` are in this phase's manifest precisely so that the tab wiring
and the type that admits it land together. You will also see `npm run lint` exit 1 on
`server/modules/providers/list/claude/session-host/readopt.ts:24` — `boundaries(no-unknown)` on an
import of `@/supervised-boot.js`, left by another session that is still editing `.oxlintrc.json` in
this same working tree. **Do not fix it.** Do not add a `boundaries/elements` entry, do not open
`.oxlintrc.json`, do not touch anything under `server/modules/providers/` — note it in your report
and keep rowing. The gate runs that same full lint and then reads only the seven paths this phase
writes: your own files must carry no error, and `src/modules/kanban/` must produce no line at all,
not even a warning.

## Phase 10 — Board fill: the data, the card model, the live frames
Depends on: Phase 5, Phase 9

```toml
[phase]
id = "10"
kind = "fill"
scaffold_of = "9"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/modules/kanban",
  "src/modules/i18n/locales",
]
forbidden = [
  "src/shared/ui/KanbanCard.tsx",
  "src/shared/ui/KanbanLane.tsx",
  "src/shared/types.ts",
  "src/shared/kanban-types.ts",
  "src/modules/project-workspace",
  "src/modules/command-palette",
  "server/modules/kanban",
  "src/shared/api.ts",
]
athena = [
  "Opening the tab fetches card bodies or details rather than board list, lane counts and one page of summaries per lane",
  "A component builds a KanbanCardModel by hand instead of calling toCardModel, so two faces disagree about what a signal means",
  "toCardModel still passes signals when autonomy is off, so an autonomy-off face shows lease, checklist or token chips",
  "toCardModel re-derives lease staleness from buildLeaseAt instead of reading the server's leaseState",
  "A lane asks for one status instead of the status array its lane spec names, so questions cards vanish with autonomy off",
  "A lane's count is a single status total rather than the sum of the statuses its spec names",
  "The first-mount board selection fires when a board is already selected, or fires again on a project switch",
  "A lane refetches its whole page set on every websocket frame rather than applying the frame in place",
  "The websocket subscription is created per render, or its unsubscribe closure is never called on unmount",
  "A locale file was left without the tabs.kanban key, or its JSON was broken by the edit",
  "The done lane is not newest-first, or its paging repeats a card across two pages",
  "A FILL marker was deleted without its behaviour being implemented",
  "The lint gate was made to pass by editing readopt.ts or .oxlintrc.json -- curing another session's error instead of this phase's own paths",
  "A locale other than en carries the English string under a kanban key, or carries the key with an empty value",
  "The browser probe passes because the two card titles appear somewhere other than the board's lanes -- a toast, a dialog, or the board switcher",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/utils/cardModel.ts"
what = "Create toCardModel(summary: KanbanCardSummary, options: { autonomy: boolean }): KanbanCardModel exactly as specified in the Interfaces panel section -- the ONE wire-to-view conversion. It maps leaseState ('none' means no lease signal at all), formats buildTokens into the preformatted chip string the card renders, folds openQuestions, openIssues and the two checklist numbers into signals, and returns signals undefined entirely when autonomy is false. It imports its input type from '@/shared/kanban-types' and its output type from '@/shared/ui'. It never reads buildLeaseAt to decide anything. This file may ALREADY exist from the previous attempt, whose work was left in the working tree: read it first, bring it to what this step says, and leave it alone where it already says it."
check = "grep -c 'export function toCardModel' src/modules/kanban/utils/cardModel.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanBoards.ts"
what = "Build the board hook: fetch api.kanban.boards() once on mount, expose boards, currentBoardId, autonomy and the select and update calls, and re-read after a board write. It also owns the ONE first-mount convenience from Interfaces: when that first boards() call comes back with currentBoardId null, call api.kanban.boardForProject(projectId) once and, if a board comes back, select it. Guard it with a ref so it can fire at most once per mount, and never call it when a board is already selected or when projectId changes. A board write reports its outcome through useToast and nothing more: ToastRequest carries no action slot and src/shared/types.ts is forbidden here, so an archive toast states what happened and offers no undo -- reversing that default means widening a later phase's manifest to that file, never this one."
check = "grep -c 'boardForProject' src/modules/kanban/hooks/useKanbanBoards.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanLanes.ts"
what = "Build the lane state hook over the specs kanbanLanes(autonomy) returns: per-lane cards, cursor, hasMore and loadingMore, keyed by spec.id; each lane's first page and every loadMore calls api.kanban.laneCards(boardId, spec.statuses, cursor) with the spec's whole status ARRAY; each lane's count is the SUM of its spec's statuses in the laneCounts response. Cards reach the kit through toCardModel. ONE subscription through useWebSocket() filters on the kanban_event kind and the current board id, types the frame as KanbanBoardEvent from '@/shared/kanban-types', and applies the frame's card and lane counts IN PLACE -- inserting, updating or removing the one card according to which lane its status now belongs to -- rather than refetching. The subscription is created once and its returned closure is called on unmount. The subscription STAYS in this file, which is where the check reads it; when the hook would cross the 300-line ceiling, split the paging and write state into a sibling under src/modules/kanban/hooks/ (the previous attempt's useKanbanLaneFeed.ts is that split and is sanctioned) rather than growing this one."
check = "grep -c 'kanban_event' src/modules/kanban/hooks/useKanbanLanes.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanPanel.tsx"
what = "Replace every FILL(10) marker in the panel and the header with the hook calls and handlers they name, threading the projectId prop into useKanbanBoards. The panel fetches exactly two things on mount -- the board list and the lane counts -- plus the single conditional boardForProject call the board hook owns. Three shape decisions are already made and are not yours to re-argue: the folded lane is drawn panel-side, because KanbanLane has no collapsed prop and the kit is forbidden here; the rail is flex-1 with p-3 rather than the Interfaces density line's h-full and px-3 pb-3, because h-full under the 48px header overflows the tab and the 1px lane border stacks with the header rule into a doubled line (reverse it by restoring those two class strings in the rail, one line each); and the header's Import from Descent action performs the default import and toasts the counts, since Phase 11 puts its dialog in front of a verb that already works. When the panel would cross the 300-line ceiling, extract by cohesion into siblings under src/modules/kanban/ (the previous attempt's KanbanRail.tsx, KanbanLaneSpine.tsx, utils/boardMenus.ts and utils/laneData.ts are that extraction and are sanctioned)."
check = "grep -c 'useKanbanLanes' src/modules/kanban/KanbanPanel.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/common.json"
what = "Add the tabs.kanban label and the board's own strings (lane titles, header actions, empty states, the import dialog) to the en locale, then the same keys to the other ten locale files under src/modules/i18n/locales/*/common.json, each in its own language, so every locale carries the same key set. A locale that repeats the English string, or carries the key with an empty value, fails the alignment check below as surely as a missing key; plurals follow the form each file already uses for its own language."
check = "grep -l '\"kanban\"' src/modules/i18n/locales/*/common.json | wc -l"
expect = "11"

[[steps]]
kind = "run"
what = "The gate, in the shape Phase 9 shipped and this phase should have inherited. npm run typecheck runs in FULL and gates in full: a tsc error anywhere is this phase's to answer. npm run lint also runs in FULL, but the GATE READS only this phase's two manifest paths, because as measured on 2026-09-15 and again on 2026-09-16 the repo's lint exits 1 on exactly ONE error -- server/modules/providers/list/claude/session-host/readopt.ts:24, boundaries(no-unknown) on an import of @/supervised-boot.js -- left by another session that is still editing that file and .oxlintrc.json in this same working tree. That error is not this phase's, its cure is a boundaries/elements entry in a file no phase of this plan may write, and it is NOT cured here. The previous attempt built this phase's whole deliverable and was then blocked by a gate that demanded a repo-wide GREEN the deliverable never needed; this gate reads the truth instead. It is red when any lint error line names src/modules/kanban/ or src/modules/i18n/locales/, and red when src/modules/kanban/ produces any line at all, error or warning -- the module this phase authors is held to zero, stricter than the repo around it."
cmd = "npm run typecheck && npm run lint > /tmp/kanban-p10-lint.log 2>&1; grep -E ': error ' /tmp/kanban-p10-lint.log || echo 'no lint error anywhere in the repo'"
check = '''
npm run typecheck > /tmp/kanban-p10-tc.log 2>&1 || { echo TYPECHECK-RED; tail -8 /tmp/kanban-p10-tc.log; exit 1; }
npm run lint > /tmp/kanban-p10-lint.log 2>&1
MINE='^(src/modules/kanban/|src/modules/i18n/locales/)'
OWN=$({ grep -E "$MINE" /tmp/kanban-p10-lint.log | grep -cE ': error ' || true; })
KB=$({ grep -cE '^src/modules/kanban/' /tmp/kanban-p10-lint.log || true; })
if [ "$OWN" = 0 ] && [ "$KB" = 0 ]; then echo GREEN; else echo "OWN-ERRORS=$OWN KANBAN-LINT-LINES=$KB"; grep -E "$MINE" /tmp/kanban-p10-lint.log | head -12; fi
'''
expect = "GREEN"
timeout_s = 900

[[verify]]  # every marker is gone and every locale file is still valid JSON
cmd = "python3 -c \"import glob, json; [json.load(open(p)) for p in glob.glob('src/modules/i18n/locales/*/common.json')]\" && echo \"JSON-OK markers=$(grep -rc 'FILL(10)' src/modules/kanban | awk -F: '{s+=$2} END {print s}')\""
expect = "JSON-OK markers=0"

[[verify]]  # the card model is the one conversion, and the lane policy is still the one policy
cmd = "test $(grep -rl 'toCardModel' src/modules/kanban | wc -l) -ge 2 && test $(grep -rlE \"'(todo|not_ready|questions|active|done)'\" src/modules/kanban | grep -v 'utils/lanePolicy.ts' | wc -l) -eq 0 && echo ONE-MODEL-ONE-POLICY"
expect = "ONE-MODEL-ONE-POLICY"

[[verify]]  # the module this phase authors carries no lint line of its own, error or warning
cmd = "test $({ node_modules/.bin/oxlint src/modules/kanban 2>&1 | grep -cE ': (error|warning) ' || true; }) -eq 0 && echo MODULE-CLEAN"
expect = "MODULE-CLEAN"
timeout_s = 300

[[verify]]  # every locale carries every kanban key en carries, plural suffixes aside
cmd = """
python3 - <<'PY'
import glob, json, os, re
PLURAL = re.compile('_(zero|one|two|few|many|other)$')
def flat(o, p=''):
    out = set()
    for k, v in o.items():
        key = p + k
        if isinstance(v, dict):
            out |= flat(v, key + '.')
        elif isinstance(v, str) and v.strip():
            out.add(PLURAL.sub('', key))
    return out
files = sorted(glob.glob('src/modules/i18n/locales/*/common.json'))
en = flat(json.load(open('src/modules/i18n/locales/en/common.json')))
want = {k for k in en if k == 'tabs.kanban' or k.startswith('kanban.')}
if len(want) < 6:
    print('TOO-FEW-KANBAN-KEYS-IN-EN count=%d' % len(want))
else:
    gaps = []
    for path in files:
        missing = want - flat(json.load(open(path)))
        if missing:
            gaps.append('%s missing=%s' % (os.path.basename(os.path.dirname(path)), ','.join(sorted(missing))))
    print('LOCALES-ALIGNED files=%d' % len(files) if not gaps else 'GAPS ' + ' | '.join(gaps))
PY
"""
expect = "LOCALES-ALIGNED files=11"
timeout_s = 300

[[verify]]  # build the client, seed a board with two cards, and drive the real browser to the Kanban tab
cmd = """
npm run build:client > /tmp/kanban-p10-build.log 2>&1 || { tail -8 /tmp/kanban-p10-build.log; exit 1; }
kill "$(cat /tmp/kanban-server.pid 2>/dev/null)" 2>/dev/null || true
sleep 2
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p10-server.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
PREV=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7893/api/kanban/boards | python3 -c 'import sys, json; print(json.load(sys.stdin)["currentBoardId"] or "")')
BID=$(curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"name":"probe-phase10"}' http://127.0.0.1:7893/api/kanban/boards | python3 -c 'import sys, json; print(json.load(sys.stdin)["board"]["id"])')
if [ -z "$BID" ]; then echo "PROBE SETUP FAILED: the API returned no board id on port 7893"; tail -12 /tmp/kanban-p10-server.log; kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true; cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true; exit 1; fi
curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/kanban/boards/$BID/select" > /dev/null
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"probe card ten","status":"todo","priority":"high"}' "http://127.0.0.1:7893/api/kanban/boards/$BID/cards" > /dev/null
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"probe card asking","status":"questions"}' "http://127.0.0.1:7893/api/kanban/boards/$BID/cards" > /dev/null
run_probe() {
  timeout 300 node scripts/kanban-ui-probe.mjs http://127.0.0.1:7893/ "$TOKEN" claudecodeui_lyphe Kanban 'probe card ten' 'probe card asking' > "$1" 2>&1
  tail -1 "$1"
}
rm -f /tmp/kanban-p10-probe-2.log
OUT=$(run_probe /tmp/kanban-p10-probe-1.log)
if [ "$OUT" != "PROBE OK" ]; then sleep 10; OUT=$(run_probe /tmp/kanban-p10-probe-2.log); fi
if [ -n "$PREV" ]; then curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/kanban/boards/$PREV/select" > /dev/null; fi
curl -s -X PATCH -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"archived":true}' "http://127.0.0.1:7893/api/kanban/boards/$BID" > /dev/null
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
if [ "$OUT" = "PROBE OK" ]; then echo "PROBE OK"; else echo "--- probe run 1 ---"; cat /tmp/kanban-p10-probe-1.log; echo "--- probe run 2 ---"; cat /tmp/kanban-p10-probe-2.log 2>/dev/null; echo "--- server tail ---"; tail -6 /tmp/kanban-p10-server.log; fi
"""
expect = "PROBE OK"
timeout_s = 1500
```

**What to build.** The data behind Phase 9's screens, and the one conversion every face goes
through. Every file this phase names may ALREADY exist, complete, from the previous attempt whose
work was left in the working tree: read each one first, bring it to what its step says, and leave
a step that is already satisfied alone — never restart a file from empty because you did not write
it yourself. Measured 2026-09-16, against the tree as it stands: the browser probe below answers
`PROBE OK`, so the board already paints its cards; what blocked this phase was its own gate, not
its deliverable.

**Sirens.** You will want to add the label to English only — all eleven locale files get the key;
the ten that lack `memory` and `runner` today are a drift this phase does not inherit. You will
want to build a card's view model inline in the lane loop because it is six fields —
`toCardModel` is the one conversion, and the second copy is where an autonomy-off face starts
showing a lease chip. You will want to compute lease staleness in the client because you have
`buildLeaseAt` right there — the server sent `leaseState`; read it. You will want to fetch each
card's detail to fill a lane — the lane renders summaries only, and detail is the drawer's job in
Phase 12. You will want to refetch a lane when a `kanban_event` arrives — apply the frame's card
and lane counts in place; a refetch per frame is the polling this whole design removes. You will
want to pass one status to `laneCards` because the lane looks like one lane — pass
`spec.statuses`, the whole array; the second probe card is in `questions` and must appear in To
Do with autonomy off, which is exactly what this check proves. You will want to restyle a screen
whose spacing looks wrong — the composition is Phase 9's; report a divergence instead. The tab
wiring, `AppTab` and `VALID_TABS` all landed in Phase 9 and their files are forbidden here. The
probe clicks a project by its visible name; `claudecodeui_lyphe` is the name that exists on this
box and is what the check passes.

**Sirens, the gate.** You will see `npm run lint` exit 1 on
`server/modules/providers/list/claude/session-host/readopt.ts:24` — `boundaries(no-unknown)` on an
import of `@/supervised-boot.js`, left by another session that is still editing that file and
`.oxlintrc.json` in this same working tree. **Do not fix it.** Do not add a `boundaries/elements`
entry, do not open `.oxlintrc.json`, do not touch anything under `server/modules/providers/` — note
it in your report and keep rowing. That error is deliberately NOT in this phase's manifest, and the
gate above is built to read past it: full typecheck, full lint, and then only this phase's own two
paths. You will want to scope the lint command itself to `src/modules/kanban` to make the exit code
green — run it in full and let the gate do the reading, because a lint narrowed at the command is a
lint that stops seeing the next file this phase adds.

**Sirens, the probe.** The browser probe is retried once, ten seconds apart, and prints both logs
when both runs fail — a chrome that cannot spawn under load is a flake, and the previous attempt's
`tail -1` threw the reason away and left `PROBE FAILED` with nothing behind it. Read the reason the
log names. You will want to edit `scripts/kanban-ui-probe.mjs` to make it pass — that file is
outside this phase's manifest and its 120-second watchdog and 30-second waits are Phase 8's ruling;
a probe that fails twice with a named reason is a divergence to report, not a script to soften. You
will want to write `docs/kanban.md` because the constraints name it as the board's one
documentation home — it does not exist yet, it is Phase 13's to create, and this phase's doc sweep
adds no new document.

## Phase 11 — Interaction scaffold: the drawer, the import dialog, the drag affordances
Depends on: Phase 10

```toml
[phase]
id = "11"
kind = "scaffold"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/modules/kanban",
]
forbidden = [
  "src/shared/ui",
  "src/shared/types.ts",
  "src/shared/kanban-types.ts",
  "src/modules/project-workspace",
  "src/modules/command-palette",
  "src/modules/kanban/utils/lanePolicy.ts",
  "server/modules/kanban",
  "src/shared/api.ts",
]
athena = [
  "The drawer was composed as one file instead of the card-drawer/ directory, so the largest screen on the board is born over the ceiling",
  "A drawer child is imported from outside card-drawer/, or the module barrel exports anything but KanbanPanel",
  "The drawer composes fields that the autonomy switch should gate as though they were always visible",
  "The import dialog invents its own shell instead of using Dialog and Field from the kit",
  "A drawer field is a literal string instead of a t() key",
  "The drawer is composed so that it renders before the card is opened",
  "A CARD STATUS is named outside utils/lanePolicy.ts -- note that the checklist item states pending, active and done are a DIFFERENT vocabulary that legitimately appears in DrawerChecklist.tsx, and the drawer gates on autonomy, never on a card status",
  "A colour literal appears in a screen file",
  "The lint gate was made green by weakening the rules rather than by the module being clean -- an oxlint-disable or eslint-disable comment inside src/modules/kanban/, an edit to .oxlintrc.json, or a touch of the foreign readopt.ts error the gate deliberately reads past",
  "A drawer child fetches its own data or calls api.kanban directly, instead of leaving the one fetch to the shell's FILL(12) marker",
  "A FILL(12) marker names no behaviour -- a bare FILL(12) with no sentence after it is a marker Phase 12 cannot act on",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/KanbanCardDrawer.tsx"
what = "Compose the Dialog SHELL only: the dialog frame, the header with title and close, the scroll container, the autonomy-gated arrangement of its four children, and the focus-return contract. It renders DrawerBody always, and DrawerQuestions, DrawerChecklist and DrawerIssuesAndTokens only while autonomy is on. The detail fetch is the marker /* FILL(12): fetch api.kanban.card(id) when the drawer opens and not before */. No field markup lives in this file."
check = "grep -c 'DrawerBody' src/modules/kanban/card-drawer/KanbanCardDrawer.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/DrawerBody.tsx"
what = "Compose the always-visible half of the open card: title, description, the markdown body, tags and the priority control. Every handler is a /* FILL(12): <what it must do> */ marker."
check = "grep -c 'FILL(12)' src/modules/kanban/card-drawer/DrawerBody.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/DrawerQuestions.tsx"
what = "Compose the questions list and their answer controls -- the option group, the multi-select case, the other field and its toggle, and the answered state. Every handler is a FILL(12) marker."
check = "grep -c 'FILL(12)' src/modules/kanban/card-drawer/DrawerQuestions.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/DrawerChecklist.tsx"
what = "Compose the checklist: the items with their three states, their notes, the add control, and the Meter summarising done over total. Every handler is a FILL(12) marker."
check = "grep -c 'Meter' src/modules/kanban/card-drawer/DrawerChecklist.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/DrawerIssuesAndTokens.tsx"
what = "Compose the issues list with its file and resolve controls, the four-counter token breakdown, the approve control and the closing remarks field. Every handler is a FILL(12) marker."
check = "grep -c 'FILL(12)' src/modules/kanban/card-drawer/DrawerIssuesAndTokens.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanImportDialog.tsx"
what = "Compose the import dialog opened from the board header's Import from Descent row: one Field for the source path prefilled with the default descent.db path, an import Button, a Spinner while it runs, and the counts table the result will fill. Handlers are FILL(12) markers."
check = "grep -c 'Field' src/modules/kanban/KanbanImportDialog.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "run"
what = "The gate, in the shape Phase 9 shipped and Phase 10 inherited, and which this phase should have inherited too. npm run typecheck runs in FULL and gates in FULL: a tsc error anywhere is this phase's to answer, and it is green as measured on 2026-09-15 with the six screens already on disk. npm run lint also runs in FULL, but the GATE READS only this phase's ONE manifest path, src/modules/kanban/, because as measured on 2026-09-15 the repo's lint exits 1 on exactly ONE error -- server/modules/providers/list/claude/session-host/readopt.ts:24:28, boundaries(no-unknown): Dependencies to unknown elements are not allowed -- left by another session that is still editing that file and .oxlintrc.json in this same working tree. That error is not this phase's, its cure is a boundaries/elements entry in a file no phase of this plan may write, and it is NOT cured here. The previous attempt composed all six screens, measured src/modules/kanban/ at zero lint lines, and was then blocked by a gate that demanded a repo-wide LINT-OK the deliverable never needed; this gate reads the truth instead. It is red when any lint error line names src/modules/kanban/, and red when src/modules/kanban/ produces any line at all, error or warning -- the module this phase authors is held to zero, stricter than the repo around it. Never make it green by weakening the rules: no oxlint-disable or eslint-disable comment, no edit to .oxlintrc.json, no edit to readopt.ts, and no narrowing of the lint COMMAND itself -- run it in full and let the gate do the reading."
cmd = "npm run typecheck && npm run lint > /tmp/kanban-p11-lint.log 2>&1; grep -E ': error ' /tmp/kanban-p11-lint.log || echo 'no lint error anywhere in the repo'"
check = '''
npm run typecheck > /tmp/kanban-p11-tc.log 2>&1 || { echo TYPECHECK-RED; tail -8 /tmp/kanban-p11-tc.log; exit 1; }
npm run lint > /tmp/kanban-p11-lint.log 2>&1
OWN=$({ grep -E '^src/modules/kanban/' /tmp/kanban-p11-lint.log | grep -cE ': error ' || true; })
KB=$({ grep -cE '^src/modules/kanban/' /tmp/kanban-p11-lint.log || true; })
if [ "$OWN" = 0 ] && [ "$KB" = 0 ]; then echo GREEN; else echo "OWN-ERRORS=$OWN KANBAN-LINT-LINES=$KB"; grep -E '^src/modules/kanban/' /tmp/kanban-p11-lint.log | head -12; fi
'''
expect = "GREEN"
timeout_s = 900

[[verify]]  # the drawer is a directory of five files, and only its shell imports the four
cmd = "test $(ls src/modules/kanban/card-drawer/*.tsx | wc -l) -eq 5 && test $(grep -rl 'card-drawer/Drawer' src/modules/kanban | grep -v 'card-drawer/KanbanCardDrawer.tsx' | wc -l) -eq 0 && echo DRAWER-SPLIT"
expect = "DRAWER-SPLIT"

[[verify]]  # the barrel still exports only KanbanPanel
cmd = "test $(grep -cE '^export' src/modules/kanban/index.ts) -eq 1 && grep -c 'KanbanPanel' src/modules/kanban/index.ts"
expect = "1"

[[verify]]  # the markers Phase 12 will fill are present
cmd = "test $(grep -rc 'FILL(12)' src/modules/kanban | awk -F: '{s+=$2} END {print s}') -ge 4 && echo MARKED"
expect = "MARKED"

[[verify]]  # no colour literal in the screens
cmd = "test $(grep -rlE '#[0-9a-fA-F]{3,8}|rgba?\\(' src/modules/kanban | wc -l) -eq 0 && echo CLEAN"
expect = "CLEAN"

[[verify]]  # the module this phase authors carries no lint line of its own, error or warning
cmd = "test $({ node_modules/.bin/oxlint src/modules/kanban 2>&1 | grep -cE ': (error|warning) ' || true; }) -eq 0 && echo MODULE-CLEAN"
expect = "MODULE-CLEAN"
timeout_s = 300

[[verify]]  # the gate was not bought with a suppression
cmd = "test $(grep -rcE 'oxlint-disable|eslint-disable' src/modules/kanban | awk -F: '{s+=$2} END {print s+0}') -eq 0 && echo NO-SUPPRESSION"
expect = "NO-SUPPRESSION"
```

**What to build.** Six more screens, composed, with their handlers marked.

**Sirens.** You will want to write the drawer as one file because the five parts are one card —
it is the largest screen on this board and half of it is autonomy-gated; it is a directory from
the moment it is composed, not a file that gets split later under a builder who is mid-phase. You
will want a drawer child to import a sibling child directly — only the shell imports the four,
and the barrel still exports `KanbanPanel` alone. You will want to reach into `src/shared/ui` to
add a prop the drawer wants — that directory is forbidden this phase; compose with what the kit
already exports and report anything genuinely missing. You will want to fetch the card detail
here so the drawer looks alive — leave the marker; Phase 12 fetches on open and not before. You
will want to name a status to decide which fields to show — autonomy is the gate, not the status,
and `utils/lanePolicy.ts` is forbidden this phase.

**What is already on disk.** A previous attempt composed all six screens and they are in the
working tree now — `card-drawer/` holds its five files, `KanbanImportDialog.tsx` is beside the
panel, 18 `FILL(12)` markers are placed, every file is under the 300-line ceiling, typecheck is
green and `src/modules/kanban/` produces zero lint lines. That attempt was blocked by its own
gate, not by its work. So read each step's `what` against the file that already exists, close
the gap where there is one, and do not rewrite a screen that already answers its step — a
rewrite here spends the sitting and risks the zero this module is held to. Three findings that
attempt left, which are Phase 12's and not yours: every string is a `t()` key and none exist in
any locale yet (`src/modules/i18n/locales` is Phase 12's manifest, not this one, so the drawer
renders raw keys until it lands); `api.kanban` exposes no checklist-removal verb, so the
checklist composes no delete control and `src/shared/api.ts` stays forbidden to both phases; and
the import field prefills `~/.claude/descent/descent.db` for display only, because the server
expands no tilde (`kanban-import.transport.ts:31`), so the marker instructs sending
`dbPath: undefined` when the field is untouched. Report them again; do not cure them here.

**Sirens, the gate.** You will see `npm run lint` exit 1 on
`server/modules/providers/list/claude/session-host/readopt.ts:24` — `boundaries(no-unknown)` on an
import of `@/supervised-boot.js`, left by another session that is still editing that file and
`.oxlintrc.json` in this same working tree. **Do not fix it.** Do not add a `boundaries/elements`
entry, do not open `.oxlintrc.json`, do not touch anything under `server/modules/providers/` — note
it in your report and keep rowing. That error is deliberately NOT in this phase’s manifest, and the
gate above is built to read past it: full typecheck, full lint, and then only this phase’s own one
path. You will want to scope the lint command itself to `src/modules/kanban` to make the exit code
green — run it in full and let the gate do the reading, because a lint narrowed at the command is a
lint that stops seeing the next file this phase adds. You will want to silence a warning with an
`oxlint-disable` comment to hold the module at zero — a suppression is not a clean module, a check
counts them, and a warning you cannot compose away is a divergence to report, not a comment to
write.

## Phase 12 — Interaction fill: drag, keyboard moves, writes, autonomy, import
Depends on: Phase 6, Phase 11

```toml
[phase]
id = "12"
kind = "fill"
scaffold_of = "11"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/modules/kanban",
  "src/modules/i18n/locales",
]
forbidden = [
  "src/shared/ui",
  "src/modules/project-workspace",
  "src/modules/command-palette",
  "server/modules/kanban",
  "src/shared/api.ts",
]
athena = [
  "A drop computes the new position as an index and sends that index to the server, instead of the two neighbour ids the move route takes",
  "An optimistic move is not reconciled when the server answers differently, or a failed move leaves the card in the wrong lane with no toast",
  "The keyboard move path is missing, so the board is mouse-only",
  "The aria-live region is never written to, or a Toast stands in for the announcement",
  "The drawer fetches the card detail on every render rather than when the card is opened",
  "A drawer child fetches its own data instead of receiving what the shell fetched, so opening one card costs five requests",
  "The autonomy switch stops a write from being sent rather than only hiding a control",
  "A FILL marker was deleted without its behaviour being implemented",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanDrag.ts"
what = "Build the drag reducer: dragstart records the card id and its source lane, the lane's index from onDropCard is resolved to the afterId and beforeId pair the move route takes, and the same resolver serves the keyboard path so both produce identical requests. Writing the aria-live sentence is this hook's job."
check = "grep -c 'afterId' src/modules/kanban/hooks/useKanbanDrag.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanMutations.ts"
what = "Build the write hook over api.kanban: move, create, update, archive, tag, approve, answer, issue, checklist and import calls, each applying an optimistic change, reconciling from the server's returned card, and firing a useToast on failure with the server's message. A move the server refuses puts the card back where it was."
check = "grep -c 'useToast' src/modules/kanban/hooks/useKanbanMutations.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/KanbanCardDrawer.tsx"
what = "Replace the shell's FILL(12) marker: fetch api.kanban.card(id) when the drawer OPENS and not before -- keyed on the open card id, not on render -- hold the detail and its loading and error states, pass them down to the four children, and return focus to the card on close."
check = "grep -c 'api.kanban.card' src/modules/kanban/card-drawer/KanbanCardDrawer.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer"
what = "Replace every FILL(12) marker in DrawerBody.tsx, DrawerQuestions.tsx, DrawerChecklist.tsx and DrawerIssuesAndTokens.tsx by wiring each control to the matching verb on useKanbanMutations. No child fetches anything itself -- the shell fetched the detail and passed it down; a child receives data and callbacks and nothing else."
check = "grep -rc 'useKanbanMutations' src/modules/kanban/card-drawer | awk -F: '{s+=$2} END {print (s>=3)}'"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanImportDialog.tsx"
what = "Replace every FILL(12) marker: call api.kanban.importDescent with the entered path, render the returned source and imported counts, and report a failure through useToast."
check = "grep -c 'importDescent' src/modules/kanban/KanbanImportDialog.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = "npm run typecheck > /tmp/kanban-p12-gate-tc.log 2>&1 && npm run lint > /tmp/kanban-p12-gate-lint.log 2>&1 && echo GREEN || (tail -5 /tmp/kanban-p12-gate-tc.log; grep ': error ' /tmp/kanban-p12-gate-lint.log | head -5)"
expect = "GREEN"
timeout_s = 600

[[verify]]  # only the drawer shell fetches; the four children receive
cmd = "test $(grep -rlE \"api\\.kanban\\.\" src/modules/kanban/card-drawer | grep -v 'KanbanCardDrawer.tsx' | wc -l) -eq 0 && echo SHELL-FETCHES"
expect = "SHELL-FETCHES"

[[verify]]  # every marker is gone and the keyboard path exists
cmd = "test $(grep -rcE 'metaKey|ctrlKey' src/modules/kanban src/shared/ui/KanbanCard.tsx | awk -F: '{s+=$2} END {print s}') -ge 1 && test $(grep -rc 'aria-live' src/modules/kanban | awk -F: '{s+=$2} END {print s}') -ge 1 && { grep -rc 'FILL(12)' src/modules/kanban | awk -F: '{s+=$2} END {print s}' || true; }"
expect = "0"

[[verify]]  # build, open a real browser, open the card, and read the drawer
cmd = """
npm run build:client > /tmp/kanban-p12-build.log 2>&1 || (tail -8 /tmp/kanban-p12-build.log; exit 1)
cp ~/.cloudcli/local-server.json /tmp/kanban-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/kanban-p12-server.log 2>&1 &
echo $! > /tmp/kanban-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
TOKEN=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
PREV=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7893/api/kanban/boards | python3 -c 'import sys, json; print(json.load(sys.stdin)["currentBoardId"] or "")')
BID=$(curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"name":"probe-phase12"}' http://127.0.0.1:7893/api/kanban/boards | python3 -c 'import sys, json; print(json.load(sys.stdin)["board"]["id"])')
curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/kanban/boards/$BID/select" > /dev/null
curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"title":"probe card twelve","status":"todo","description":"drawer body text"}' "http://127.0.0.1:7893/api/kanban/boards/$BID/cards" > /dev/null
rm -rf /tmp/kanban-chrome-profile-9333
OUT=$(timeout 240 node scripts/kanban-ui-probe.mjs http://127.0.0.1:7893/ "$TOKEN" claudecodeui_lyphe Kanban 'probe card twelve' 2>&1 | tail -1)
if [ -n "$PREV" ]; then curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:7893/api/kanban/boards/$PREV/select" > /dev/null; fi
curl -s -X PATCH -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"archived":true}' "http://127.0.0.1:7893/api/kanban/boards/$BID" > /dev/null
kill "$(cat /tmp/kanban-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/kanban-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "$OUT"
"""
expect = "PROBE OK"
timeout_s = 900
```

**What to build.** The behaviour behind every remaining marker.

**Sirens.** You will want the drop to send an index — the route takes two neighbour ids, because
an index is stale the moment another session moves a card. You will want the autonomy switch to
skip a write while it is off — it gates the UI only; every verb stays reachable. You will want a
Toast to announce a keyboard move — the live region announces, the toast advises, and a toast
that leaves cannot be the announcement. You will want a drawer child to fetch the slice it needs
because it is right there — the shell fetched the whole detail once when the card opened and
passes it down; five children fetching is five requests per card open. You will want to adjust a component's spacing to make a
handler fit — `src/shared/ui` is forbidden this phase.

## Phase 13 — The lane's documentation, and one correction it owes
Depends on: Phase 12

```toml
[phase]
id = "13"
builder = "prometheus"
model = "sonnet"
code_change = false
doc_sweep = "foreground"
expected_s = 1500
manifest = ["docs/kanban.md", "docs/README.md", "src/shared/ui/verve/README.md"]
forbidden = [
  "server/modules/kanban",
  "src/modules/kanban",
  "src/shared/ui/KanbanCard.tsx",
  "src/shared/ui/KanbanLane.tsx",
  "src/shared/ui/index.ts",
  "src/shared/ui/verve/board.css",
  "src/shared/ui/verve/controls.css",
  "src/shared/ui/verve/feedback.css",
  "src/shared/ui/verve/tokens.css",
]
athena = [
  "The document describes routes that do not exist, or omits ones that do",
  "The autonomy switch is described as gating the service rather than the UI",
  "The importer's idempotency rule is stated without naming descent_id, or without the updated_at guard that decides what a re-import does to a locally edited card",
  "A second document about the board was created instead of docs/kanban.md being the one home",
  "The corrected stylesheet line counts were written from the plan's prose rather than measured from the files at the time of writing",
]

[[steps]]
kind = "edit"
path = "docs/kanban.md"
what = "Write the lane's document in the register of docs/plan-runner.md: what the board is; the eleven tables and what each holds; the five services and their verbs, the ONE write seam every write goes through, and the routes package that exposes them; the kanban_event frame and the fact that exactly one frame is sent per write -- including one, not 449, for an import; how the autonomy switch gates the UI and nothing else; that a lane is a SET of statuses composed in src/modules/kanban/utils/lanePolicy.ts, which is why a questions card shows in To Do with autonomy off; the lazy-loading contract; the Descent importer, its readonly transport, its descent_id idempotency rule and the WHERE excluded.updated_at >= ... guard that means a re-import never overwrites a card edited here; that boards are global and switching projects does not change the selected board; and the two probe scripts with how to run them."
check = "grep -c 'api/kanban' docs/kanban.md"
expect_re = "^([5-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "src/shared/ui/verve/README.md"
what = "Correct rule 6 at lines 112-114. It reads 'controls.css is full, 296 of its 300 lines', which has not been true for some time: MEASURE the three stylesheets yourself with wc -l at the time of writing and state the real numbers for controls.css and feedback.css. Record board.css as the THIRD paint file, imported from the barrel exactly as the other two are, holding the .vv-lane, .vv-lane__head and .vv-lane-card rules. Keep the rule's point intact -- do not win lines back by squeezing an existing file, open the next one -- and change nothing else in this document."
check = "grep -c 'board.css' src/shared/ui/verve/README.md"
expect_re = "^[1-9][0-9]*$"

[[verify]]  # the stale line count is gone and the measured one is right
cmd = "test $(grep -c '296 of its 300 lines' src/shared/ui/verve/README.md) -eq 0 && grep -c \"$(wc -l < src/shared/ui/verve/controls.css)\" src/shared/ui/verve/README.md"
expect_re = "^[1-9][0-9]*$"

[[verify]]  # the document names the importer's idempotency key and its re-import guard
cmd = "test $(grep -c 'descent_id' docs/kanban.md) -ge 1 && test $(grep -c 'updated_at' docs/kanban.md) -ge 1 && echo IMPORT-DOCUMENTED"
expect = "IMPORT-DOCUMENTED"

[[verify]]  # the document is reachable from the docs index
cmd = "grep -c 'kanban' docs/README.md"
expect_re = "^[1-9][0-9]*$"

[[verify]]  # docs/kanban.md is the ONE home: no module README was created for the board
cmd = "test $(ls server/modules/kanban/README.md src/modules/kanban/README.md 2>/dev/null | wc -l) -eq 0 && echo ONE-HOME"
expect = "ONE-HOME"
```

**What to build.** Prose, and only prose.

**Sirens.** You will want to describe what the board will do once the autonomy machinery is
switched on — describe what exists: the data and the verbs are complete, the UI gates them, and
nothing schedules or builds anything. You will want to write a migration guide away from Descent
— this document covers the importer; the sunset itself is not this plan's subject. You will want
to give `server/modules/kanban/` its own README because every other server module has one — the
board has exactly one documentation home and it is `docs/kanban.md`; a check refuses a second.
You will want to copy the stylesheet line counts out of this plan — measure them with `wc -l`
when you write the line; they were 435 and 386 on 2026-09-15 and `board.css` has since been added
beside them, so the plan's numbers are a starting point and the files are the answer.

## Goal

**Goal:** a Kanban tab exists in LypheCLI whose four lanes read and write real cards in the app's
own SQLite database, whose every write records an event and pushes a `kanban_event` frame, and
into which a real `descent.db` can be imported twice with identical row counts.

**Verify by:** Phase 10's and Phase 12's headless-browser probes returning `PROBE OK`, Phase 5's
websocket probe printing `kind=card.created`, and Phase 6's double import printing
`counts=True events=True imports=2 current=1 settings=1`.

## Waves

A wave is a set of phases that could run at the same time — nothing more. Every wave below but
the first holds exactly one phase, because every phase after the first consumes the one before it.

```
Wave  1: Phase 1, Phase 7 — independent; the schema and the kit scaffold share no file and no gate
Wave  2: Phase 2  — the write seam, the module, boards; needs the schema
Wave  3: Phase 3  — cards; needs the seam
Wave  4: Phase 4  — card details; needs cards
Wave  5: Phase 5  — the client frame mirror and the live proof; needs a card write to observe
Wave  6: Phase 6  — the importer; needs every table's verbs
Wave  7: Phase 8  — the kit's behaviour, on the scaffold it fills
Wave  8: Phase 9  — the board scaffold, the tab and the lane policy
Wave  9: Phase 10 — the board's data; needs both Phase 5's mirror and Phase 9's screens
Wave 10: Phase 11 — the interaction scaffold
Wave 11: Phase 12 — the interaction fill; needs Phase 6's importer and Phase 11's screens
Wave 12: Phase 13 — the prose
```

**Wave 1's two phases are gate-disjoint as well as file-disjoint.** Phase 1 gates on
`tsc --noEmit -p server/tsconfig.json`; Phase 7 gates on `tsc --noEmit -p tsconfig.json` plus
`npm run lint:client` (which is `oxlint src/`, already a script in `package.json:56`). Neither
runs the other's tree, so neither can fail on the other's half-written work. The runner accepts
these as written — a step's `check` is arbitrary shell it runs in `cwd` — so no serialization is
needed. Every later phase gates on the full `npm run typecheck && npm run lint`, which is correct
once both halves of the tree are being changed by the same walk.

The split mode is off: this is one plan in one file, walked in written order. Wave 1 holds two
independent phases of a sitting each; asking for the split would make them two sessions.
Every render-touching phase is a scaffold and a fill pair, as the route classifier requires.

## Decisions already made, with their reversals

| Decision | Why | Reversal |
|---|---|---|
| Tables are `kanban_`-prefixed in the existing `auth.db` | one database, one backup, one connection; the prefix keeps them clear of auth and sessions | a second database file is a migration away, and nothing outside the repositories knows the file |
| Ids are `<prefix>-<n>` minted from `kanban_id_seq` | Descent's readable ids are worth keeping, and they make the importer's mapping legible | switch `mintId` to `randomUUID()`; nothing else reads the shape |
| The board does NOT use the live-bus | `topics.ts:19-29` allows only `runner:*` and `souls:*`, and the bus exists to retain a value for components mounted elsewhere; this panel is the only consumer and unmounts with its tab | add a `kanban:*` topic to the allowlist and publish from a feed component |
| Native HTML5 drag, no new dependency | the idiom is already in this repo, and the ruled keyboard path plus the card menu's Move to rows cover touch | a dnd library can replace `useKanbanDrag.ts` without touching the route |
| `moveCard` takes two neighbour ids, not an index | an index is stale the moment another session moves a card | accept an optional index alongside and resolve it server-side |
| `useWorkspaceTabGates.ts` is not touched | the always-visible convention is the absence of a gate, as with chat, files and git | add a gate field and thread it through the three call sites |
| UI phases run against the REAL database on port 7893 | the probe recipe is proven there, and a scratch database has no project and no onboarding | pass `DATABASE_PATH` and register a probe user, as Phase 9 does |
| Exactly one Descent setting is imported | the other eighteen are daemon state, measured 2026-09-15 | add keys to the importer's allowlist |
| `medium` priority renders nothing on a card face | nearly every Descent card is `medium`; printing it flattens the ladder into wallpaper | give `medium` its own muted mark in `KanbanCard.tsx` |
| **A re-import overwrites a card only when Descent's row is newer** — the cards and boards upserts carry `WHERE excluded.updated_at >= <table>.updated_at` | the importer is idempotent BY DESIGN and meant to be re-run; without the guard, a second run silently discards every edit made on this side since the first | drop the two `WHERE` clauses for a hard re-sync that makes Descent authoritative again; it is a one-line deletion in `kanban-import.db.ts` and nothing else depends on it |
| Child tables (questions, issues, decisions, checklist, attachments, events) stay FULL upserts with no `updated_at` guard | they carry no local editing surface in this plan's UI, and a guarded child would leave one card's questions half from each side | add the same guard per child once that table gains a local editor |
| **Events are kept forever; nothing prunes `kanban_events`** | the audit log is the board's memory and an imported Descent board starts at ~12,700 rows, which SQLite reads cheaply through `ix_kanban_events_board(board_id, id)`; the route clamps `limit` to 200, so no single read is unbounded | a pruning job — delete by `board_id` and an `id` watermark, or by `ts` — is one small service and a later plan's act; the index and the clamp are what make deferring it safe |
| **A future MCP adapter must run IN-PROCESS** — a transport inside this server calling the same verbs | the `kanban_event` fan-out is per-process: `connectedClients` is this process's socket set, so a separate MCP process writing the same SQLite file would change the board and no open window would ever hear about it | `kanban_events.id` is a monotonic cursor — an out-of-process writer can be picked up by a server-side tail poller reading `id > last_seen` and broadcasting what it finds; one small service, no schema change, no verb change |
| The write seam AND its fan-out both land in Phase 2, not Phase 5 | `writeKanban` calls `broadcastKanbanEvent`, and Phase 2 gates on a green typecheck — a seam that calls a function which does not exist cannot compile, so the two cannot be split across phases | move both to a later phase and let the earlier verbs write their own transactions, which is precisely the twenty-seven-copy shape this seam exists to prevent |
| `listEvents` lives on `kanban-boards.service.ts` | it is a board-scoped read of the board's own audit log, and the alternative was a sixth service file holding one verb | move it to its own `kanban-events.service.ts` if a second events verb ever appears |

## Edge cases and their endings

- **A card sits in `questions` while autonomy is off** — it renders in the To Do lane carrying its
  questions chip, because `kanbanLanes(false)` composes To Do from `['todo', 'questions']` and the
  lane's single keyset page spans both. The status is never rewritten to make the UI simpler.
- **A re-import meets a card edited in LypheCLI since the last import** — the local row wins and
  is left exactly as it is; SQLite skips a `DO UPDATE` whose `WHERE` is false, so the import
  completes normally and reports it as an updated row that changed nothing.
- **A re-import meets a card changed in Descent since the last import** — Descent's row wins and
  the local row is refreshed, because `excluded.updated_at` is the greater.
- **A locally created card has no `descent_id`** — the column is nullable-UNIQUE and SQLite
  permits many NULLs under one UNIQUE constraint, so every locally created row coexists with every
  imported one and the importer's `ON CONFLICT(descent_id)` never sees them.
- **An import of 449 cards** — ONE `import.descent` event and ONE websocket frame, carrying
  `card: null` and the board's fresh lane counts. The seam is called once and the whole mapping
  runs inside its single `mutate` callback.
- **A lease claim is refused** — nothing was written, so nothing is recorded and no frame is
  sent; the caller gets `{ granted: false }` and a 200.
- **Autonomy is turned off while the Open questions lane holds cards** — the lane stays until it
  empties, with a `Banner` saying why. Cards are never hidden.
- **Two midpoint drops collapse the gap below 1e-6** — the lane renormalises to `(index+1)*1000`
  inside the same transaction and the midpoint is recomputed. No move is refused for arithmetic.
- **A move names a neighbour that another session already moved** — the server recomputes from the
  lane's live neighbours and returns the card it actually wrote; the client reconciles to that.
- **A claim meets a fresh foreign lease** — `{ granted: false }` and a 200, never an exception.
- **A lease is 41 seconds old** — it is stale and claimable. A corrupt or unparseable
  `build_lease_at` reads as stale too.
- **`approveCard` on a card with an unanswered question** — 409, and the card does not move.
- **A `not_ready` card that passes the gate** — promoted to `todo` AND approved in one
  transaction, never in two.
- **The importer meets an `ov_events` row naming a card that no longer exists** — the event is
  imported with a null `card_id`. The import does not abort.
- **The importer is pointed at a file that is not a Descent database** — `fileMustExist` plus the
  first missing table gives a 404 with a plain message; nothing is written.
- **A websocket send throws on one dead client** — caught per client; the fan-out continues.
- **The operator's own server is running on 3011 against the same file** — expected. A
  `SQLITE_BUSY` is retried once, then filed `[BLOCKED: sqlite busy]`.
- **A phase's probe board is left behind by a crash** — it is archived, so it is invisible to
  `GET /boards` and the next run's count check still reads 1.

## Exclusions — named, not deferred into a step

- **No MCP tool is registered.** The verbs are shaped so an adapter can call them — every write
  verb already takes the `context?: { actor }` argument such an adapter would pass. Writing that
  adapter is a separate plan, and the Decisions table records the one constraint it inherits: it
  must run IN-PROCESS, because the `kanban_event` fan-out is per-process.
- **No change to `server/modules/descent/`.** The proxy keeps memory intake and accounts; the
  board does not go through it.
- **No autonomy machinery.** Leases, approval and the questions lane are complete in data and in
  the service, and nothing schedules, spawns or builds anything.
- **No Descent skin.** No zone metaphor, no depth palette, no specimen window.
- **No test file, no test runner config, no `tests/` entry.**
- **No commit and no push.** The run ends with its work in the working tree.
- **No Descent shutdown.** Sunsetting Descent is a later act; this plan only imports from it.

## Doctrine citations

- `~/.claude/CLAUDE.md`: no branches; no unit tests ever; healed means deleted; verify before
  answering; root cause before fix; a plan never involves the operator.
- `AGENTS.md` → `.agents/skills/backend-module-standards/SKILL.md` and
  `.agents/skills/frontend-module-standards/SKILL.md`: module layout, barrels, type placement,
  `@/` imports, thin routes. Their "add unit tests" clause is overridden by the house rule above,
  and that override is stated in Project Constraints so no builder has to weigh it alone.
- `~/.claude/design/DESIGN_DOCTRINE.md` and `~/.claude/design/verve/`: the board is Verve, and
  Iris's ruling in Interfaces is the reading of that doctrine this plan is built on.
- `~/.claude/descent/README.md` and `GOTCHAS.md`: the behaviour being carried over — the five
  statuses and their zones (`README.md:138-151`), the approve gate (`README.md:428`), the build
  and plan leases (`README.md:1210-1244`), and `store_lease.py:27` for the 40-second staleness.

## Scout findings behind this plan

Every anchor in this file came from one of these; none of it was inferred.

- **backend-pattern** — module shape, the flat mount block at `server/index.ts:156-228`, the guard
  on the mount, the two coexisting response conventions, global `express.json`, and the fact that
  there is no module registry to update.
- **database** — `runMigrations` is one idempotent imperative function with no version counter
  (`migrations.ts:491-566`), `getConnection()` per query, the plain-object repository shape, the
  `projects` table's `project_id TEXT PRIMARY KEY`, and migrations running at every boot from
  `server/index.ts:384`.
- **livebus** — `connectedClients` + `WS_OPEN_STATE`, the `kind`-tagged envelope, the
  broadcast-on-write copy-pattern, the global (not per-project) socket, and the live-bus
  allowlist that keeps this board off the bus.
- **tabs** — the `AppTab` union, `BASE_TABS`, the count-gated versus always-visible conventions,
  the `&&` lazy-mount shape, and the eleven locale files.
- **frontend-panel** — `authenticatedFetch` and the `api` object, the plan-runner panel as the
  copy-pattern, `useToast`, `EmptyState`/`Spinner`/`ScrollArea` usage, and the measured absence of
  any drag-and-drop or data-fetching library in `package.json`.
- **descent-schema** — every column of Descent's card model including the ones its `_migrate`
  adds after the fact, the five statuses, the three priorities, `sort_order REAL`, and the
  settings table that holds `current_board`.
- **ui-probe** — the two routes, the state-not-URL tab, the `[role="tab"][aria-label=…]` DOM, the
  static `dist` serving with its SPA fallback, and the onboarding and project gates.
- **tabs-consumers** — the complete blast radius of a new tab: `VALID_TABS`, the two command
  palette lists, and the three gate call sites that do NOT need changing.
- **ws-frames** — `GatewayEventKind`, the mirrored-type convention, `subscribe`'s loose
  `ServerEvent`, and the absence of any per-user filtering.

Measured directly, 2026-09-15: the auth recipe (200 with a minted token, 401 without), the
second-server boot on port 7893, the headless CDP probe reaching the workspace and clicking a
tab, `chrome-headless-shell` at version 153, and Descent's live row counts.

Measured again while this plan was revised, 2026-09-15 — the facts the structural amendments
rest on, each read at its source rather than inferred:

- `frontend-module-standards/SKILL.md:88-89` sanctions `src/modules/<feature>/utils/` for a large
  module-private utility and forbids naming it `utils.ts` — which is what makes `utils/
  cardModel.ts` and `utils/lanePolicy.ts` conventional rather than exceptional; `:77-78` is the
  shared-type clause that §Module size overrides for `src/shared/kanban-types.ts`.
- `backend-module-standards/SKILL.md:48` is the thin-route clause the routes package honours;
  `:22-25` forbids module-local `types.ts` / `utils.ts` and requires cross-module imports through
  a barrel, which is why `routes/` stays internal.
- `package.json:55-57` already ships `lint:client` (`oxlint src/`) and `lint:server`
  (`oxlint server/`) beside `lint`, and `:50` shows `typecheck` is two `tsc -p` invocations —
  so Wave 1's scoped gates are existing scripts and existing flags, not new tooling.
- `src/shared/ui/verve/README.md:112` still reads "`controls.css` is full, 296 of its 300 lines";
  measured now, `controls.css` is 435 lines, `feedback.css` 386 and `tokens.css` 208. Phase 13
  corrects that sentence and records `board.css` as the third paint file.
- `WorkspaceMain.tsx:27,73` carry `selectedProject: Project | null` as a prop, `:293`
  early-returns when it is null, and `:167` already reads `selectedProject?.projectId` — so the
  mount block at `:389` can pass `projectId` with no guard and no new plumbing.
- `src/shared/` already holds ten modules beside `types.ts` (`authToken.ts`, `constants.ts`,
  `uiPreferences.ts`, `userSettings.ts`, `selectedProvider.ts` and the rest), so a
  `kanban-types.ts` sibling is this repo's existing shape.
- `charters/odysseus/PLAN_FORMAT_V2.md` §6: a step's `check` is arbitrary shell the runner runs in
  `cwd`. A scoped gate command needs no runner change, which is why Wave 1 stays parallel instead
  of being serialized.

## Open Questions

None. Every scope question this plan raised was answered from the code, the codices or the
operator's locked decisions, and each reversible default is named with its reversal in the
Decisions table above.

## Ship Logs

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · cycle 1 · spawns 4/200 · fix-passes 1 of 2 · cost $0.72 (run $0.72) · resumed 0×
- builder: hephaestus/deepseek-flash · session dabae729-2cec-4f0d-96b7-0d84378875ce · 144s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (124s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_1/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · cycle 2 · spawns 8/200 · fix-passes 1 of 2 · cost $1.99 (run $2.70) · resumed 0×
- builder: hephaestus/deepseek-flash · session bb0539b3-5cd7-4427-9c30-b2c15b0dea6f · 411s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 4 → fix-pass 1/deepseek-flash (100s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 16/16 steps OK · verify 3/3 OK
- forbidden: unchanged (7 declared, 7 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_2/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: DIVERGENCE: plan verify 2 expect "page=2 more=True rest=1 both=3 bad=400 top=True todo=2 active=1 lease=none ordered=True"; measured "page=2 more=True rest=1 both=4 bad=400 top=True todo=2 active=1 lease=none ordered=True" — the probe creates 3 todo cards plus 1 questions card and then asks status=t]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 6c64e67c18e2 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 990a1e9b-543f-4468-9320-d05bed9abd0c · 887s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_3/

### Phase 3 Ship Log — ↻ REPLANNED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · replan 1 of 3 · spec_sha 6c64e67c18e2 → 3ff375319e65 · replanner odysseus/claude-opus-5 · session 6872a9de-182a-4671-a8a2-ae755e4da3bb · 38s · cost $0.95
- cause: builder-blocked: DIVERGENCE: plan verify 2 expect "page=2 more=True rest=1 both=3 bad=400 top=True todo=2 active=1 lease=none ordered=True"; measured "page=2 more=True rest=1 both=4 bad=400 top=True todo=2 active=1 lease=none ordered=True" — the probe creates 3 todo cards plus 1 questions card and then asks status=t
- changed: I fixed Phase 3's spec so the phase can ship. The builder was right: a plan check was wrong, not the code. The check's command makes 3 `todo` cards and 1 `questions` card, then asks for `status=todo,questions`. The correct answer is 4, and the plan expected 3. The only way to get 3 is to drop a status from the list, which is the very mistake this phase warns against. I changed the expected output to `both=4` and added a `qin=True` field. It confirms the `questions` card is really in that page, using the id the check already created but never looked at. As the brief required, I added the evidence folder to the manifest. The `kanban.routes.ts` step now allows the `KanbanServices` type field th
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_3/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · cycle 4 · spawns 14/200 · fix-passes 1 of 2 · cost $0.86 (run $4.83) · resumed 0×
- builder: hephaestus/deepseek-flash · session 5f662cfa-920d-4ba2-8adf-958c34bb3700 · 97s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 3 → fix-pass 1/deepseek-flash (334s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 2/2 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: verify: grep -c 'kanban_questions\|kanban_decisions' server/modules/database/repositories/kanban-questions.db.ts → exit 0 '10' · grep -c 'kanban_checklist_items\|kanban_attachments\|kanban_issues' server/modules/database/repositories/kanban-checklist.db.ts → exit 0 '15']
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · fix-passes 2 of 2 · spec_sha 221a6cdfe71e · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 26dbb078-4958-4ae7-af38-ddef697927d0 · 448s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 → fix-pass 1/deepseek-flash (207s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 9/11 steps OK · verify 2/2 OK → fix-pass 2/deepseek-flash (38s) → 9/11 steps OK · verify 2/2 OK
- forbidden: unchanged (8 declared, 8 present)
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_4/

### Phase 4 Ship Log — ↻ REPLANNED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · replan 2 of 3 · spec_sha 221a6cdfe71e → b61615d263b9 · replanner odysseus/claude-opus-5 · session 295fe106-9600-4e8b-b5ef-ce37eb3f9e9f · 232s · cost $2.53
- cause: verify: grep -c 'kanban_questions\|kanban_decisions' server/modules/database/repositories/kanban-questions.db.ts → exit 0 '10' · grep -c 'kanban_checklist_items\|kanban_attachments\|kanban_issues' server/modules/database/repositories/kanban-checklist.db.ts → exit 0 '15'
- changed: Phase 4's two blocked checks were authoring errors in the spec, not in the world: `^[2-9]$` and `^[3-9]$` capped an occurrence count at one digit, so truthful readings of 10 and 15 read as failures. I replaced both with checks that read each table name on its own (`BOTH-TABLES`, `THREE-TABLES`) — stronger, since a count could never prove the second and third tables were present at all. I also cured the spec's real omission: it never said where the approve gate's card write lives, so the builder had to improvise `kanban-approvals.db.ts` outside the manifest. That file is now a named step with its own check, its path added to the manifest, a Sirens order against folding it back into the 299-li
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_4/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · cycle 6 · spawns 22/200 · fix-passes 0 of 2 · cost $0.97 (run $8.67) · resumed 0×
- builder: hephaestus/deepseek-flash · session 4fad85ce-78f9-4b3f-93ed-8d02860cd780 · 122s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 12/12 steps OK · verify 2/2 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 0 files
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: step 3: `npm run typecheck && npm run lint` → GREEN; probe board `probe-phase5` created and archived by the same command; VERIFY #2 printed `kind=card.created` from a live socket (`FRAME kind=card.created card=c-107 lanes=5`); VERIFY #1 blocked on the src/shared/types.ts predicate above]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 744f7867c8c3 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 1d4341e6-dfd0-41ee-a333-29482f9236a1 · 139s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_5/

### Phase 5 Ship Log — ↻ REPLANNED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · replan 3 of 3 · spec_sha 744f7867c8c3 → cb3add7e24e4 · replanner odysseus/claude-opus-5 · session cd63ba30-aa17-44cf-95e4-21914b891522 · 267s · cost $2.02
- cause: builder-blocked: step 3: `npm run typecheck && npm run lint` → GREEN; probe board `probe-phase5` created and archived by the same command; VERIFY #2 printed `kind=card.created` from a live socket (`FRAME kind=card.created card=c-107 lanes=5`); VERIFY #1 blocked on the src/shared/types.ts predicate above
- changed: Cured the spec, not the world. Phase 5's VERIFY #1 carried a predicate the deliverable can never satisfy: `grep -c 'kanban' src/shared/types.ts -eq 0`, in a file that has carried TaskMaster's `TaskBoardView = 'kanban' | 'list' | 'grid'` since long before this plan. It now reads the rule the phase actually keeps — **zero `^export type Kanban` declarations** in that file — plus four new world-reading predicates (name-set diff against the server twin excluding the two server-only shapes the step never asked for, the frame type present, no `server/` import, no non-type export), each printing its own falsifying evidence. Step 1's `what` now states the seventeen-name deliverable and why `KanbanEve
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_5/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · cycle 8 · spawns 28/200 · fix-passes 1 of 2 · cost $1.09 (run $11.83) · resumed 0×
- builder: hephaestus/deepseek-flash · session 670aecc0-27b8-42a1-80bb-d2dd4fdd0138 · 92s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (70s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: DIVERGENCE (verbatim, as the runner reported it): the `kept` verify — `python3 -c "import sqlite3; print('kept' if sqlite3.connect('/tmp/kanban-import.db').execute(\"select count(*) from kanban_cards where title='locally edited'\").fetchone()[0] == 1 else 'OVERWRITTEN')"` → `exit 2 ''` — and the cau]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · fix-passes 2 of 2 · spec_sha 8980a4a362b2 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session eb2c20b0-c363-4ad2-a9f7-3977e2937f0a · 669s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 4 → fix-pass 1/deepseek-flash (200s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 3/4 OK → fix-pass 2/deepseek-flash (202s) → 7/7 steps OK · verify 3/4 OK
- forbidden: unchanged (8 declared, 8 present)
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_6/

### Phase 7 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · cycle 10 · spawns 36/200 · fix-passes 1 of 2 · cost $18.62 (run $30.85) · resumed 0×
- builder: iris/opus · session 9d30f04e-a898-43ce-b991-44e52f12c178 · 1563s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 2 · MED 4 · LOW 11 → fix-pass 1/opus (639s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 4/4 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 2 · MED 4 · LOW 11 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_7/

### Phase 8 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · cycle 11 · spawns 40/200 · fix-passes 1 of 2 · cost $1.57 (run $32.42) · resumed 0×
- builder: hephaestus/deepseek-flash · session 831e4354-1fc5-4be0-8221-a37e8784f32f · 765s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 2 · LOW 1 → fix-pass 1/deepseek-flash (517s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 4/4 steps OK · verify 4/4 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 2 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: step 1 check "grep -c \"'kanban'\" src/shared/types.ts" expects 1 but returns 2, because src/shared/types.ts already carried `export type TaskBoardView = 'kanban' | 'list' | 'grid';` before this run (HEAD:1754, now :1757), so the one sanctioned AppTab edit makes the count 2 and the check cannot be m]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha ee91c4942d98 · retry: on-spec-change
- builder: iris/opus · session 30ba0fee-1d67-4e8c-8609-a7ea32f3447d · 995s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_9/

### Phase 10 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: depends: not SHIPPED: Phase 9]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha abd9089263b3 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_10/

### Phase 11 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: depends: not SHIPPED: Phase 10]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 3086c1b5f62f · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_11/

### Phase 12 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: depends: not SHIPPED: Phase 6, Phase 11]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 922e4544f59f · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_12/

### Phase 13 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: depends: not SHIPPED: Phase 12]
- run: lyphecli-kanban-board-plan-20260915-145714-62ef · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c13258bee15a · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/phase_13/

### Run lyphecli-kanban-board-plan-20260915-145714-62ef — COMPLETE 2026-09-15
- shipped: 1, 2, 3, 4, 5, 7, 8
- blocked: 6: builder-blocked, 9: builder-blocked, 10: depends, 11: depends, 12: depends, 13: depends, 6: skipped, spec unchanged, 9: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/lyphecli-kanban-board.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-145714-62ef/resume_brief.md

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · cycle 1 · spawns 4/200 · fix-passes 1 of 2 · cost $0.77 (run $0.77) · resumed 0×
- builder: hephaestus/deepseek-flash · session ed32ee9e-506e-4b04-b37d-a0a52088be7c · 150s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 → fix-pass 1/deepseek-flash (237s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 4/4 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_6/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: athena: fix-pass 1: server/modules/providers/list/claude/session-host/readopt.ts:24 — `error boundaries(no-unknown)` makes `npm run lint` exit 1, so this phase's own gate step cannot pass; the cause is uncommitted work outside this phase's manifest and the cure is a `boundaries/elements` entry in `.oxlintrc]
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · fix-passes 1 of 2 · spec_sha 1f609cc99dff · retry: on-spec-change
- builder: iris/opus · session 0cb113ea-505c-47a8-bbb4-a94304481397 · 688s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 1 · MED 1 · LOW 9 → fix-pass 1/opus (430s)
- forbidden: unchanged (7 declared, 7 present)
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_9/

### Phase 9 Ship Log — ↻ REPLANNED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · replan 1 of 3 · spec_sha 1f609cc99dff → c3dd2b00a6a9 · replanner odysseus/claude-opus-5 · session 949b08de-5eff-4b7d-b6ae-1d0e5c132892 · 439s · cost $2.76
- cause: athena: fix-pass 1: server/modules/providers/list/claude/session-host/readopt.ts:24 — `error boundaries(no-unknown)` makes `npm run lint` exit 1, so this phase's own gate step cannot pass; the cause is uncommitted work outside this phase's manifest and the cure is a `boundaries/elements` entry in `.oxlintrc
- changed: All four proofs pass: lint clean, `gate` prints `RUNNER`, `walk` exits 0, lock still `lock:81abf70d85`, and the diff touches only Phase 9 (prefix and suffix byte-identical). **What I changed, and why.** The ⛔ was a spec defect, not a build defect: the gate demanded the whole repo lint clean, but the repo's single error sits in `server/modules/providers/.../readopt.ts:24` — another session's in-flight work, cured only in `.oxlintrc.json`, a file no phase here may write. I measured it live: still failing, and `src/modules/kanban` emits zero lint lines. So the gate now runs the same FULL typecheck (still gating in full — `AppTab` is repo-wide) and the same FULL lint, then reads only this phase
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_9/

### Phase 9 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · cycle 3 · spawns 12/200 · fix-passes 1 of 2 · cost $11.59 (run $29.00) · resumed 0×
- builder: iris/opus · session 999aff6c-b4c2-4b66-95f1-8505c598f73a · 342s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 1 · MED 3 · LOW 5 → fix-pass 1/opus (564s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 11/11 steps OK · verify 4/4 OK
- forbidden: unchanged (7 declared, 7 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 1 · MED 3 · LOW 5 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_9/

### Phase 10 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: DIVERGENCE: step 6's check `npm run typecheck && npm run lint` expects GREEN and does not print it — typecheck is GREEN and lint exits 1 on exactly one pre-existing error outside the manifest (`server/modules/providers/list/claude/session-host/readopt.ts:24:28: error boundaries(no-unknown): Dependen]
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha e2732f12dffa · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session cc343dac-45d0-4431-af53-1a205b66381a · 1015s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_10/

### Phase 10 Ship Log — ↻ REPLANNED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · replan 2 of 3 · spec_sha e2732f12dffa → ab396f24d5a0 · replanner odysseus/claude-opus-5 · session ae822d7c-54ba-4745-a078-3e1b2bfbb14f · 778s · cost $5.67
- cause: builder-blocked: DIVERGENCE: step 6's check `npm run typecheck && npm run lint` expects GREEN and does not print it — typecheck is GREEN and lint exits 1 on exactly one pre-existing error outside the manifest (`server/modules/providers/list/claude/session-host/readopt.ts:24:28: error boundaries(no-unknown): Dependen
- changed: Measured against the tree, not asserted: I booted the real server, drove the browser probe, and ran every check. **What changed (Phase 10 only; spec_sha e2732f12dffa → ab396f24d5a0):** - **The gate.** Step 6 demanded a repo-wide lint `GREEN` the deliverable never needed. It now runs full typecheck and full lint but *reads* only `src/modules/kanban/` and `src/modules/i18n/locales/` — the shape Phase 9 shipped and this phase failed to inherit. Ran it: **GREEN**. - **The probe.** `tail -1` discarded the reason behind `PROBE FAILED`. It now logs both streams, kills a stale probe server first, retries once, and prints both logs on failure. Ran it end-to-end: **PROBE OK** in 24s. - **Two new ver
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_10/

### Phase 10 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · cycle 5 · spawns 18/200 · fix-passes 1 of 2 · cost $1.06 (run $36.11) · resumed 0×
- builder: hephaestus/deepseek-flash · session 20370cb1-e2ca-4500-b54d-ceecc3e7b840 · 506s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (1504s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 6/6 steps OK · verify 5/5 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_10/

### Phase 11 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: Phase 11 step 7's check cannot print LINT-OK: `npm run lint` exits 1 on exactly ONE pre-existing error, `server/modules/providers/list/claude/session-host/readopt.ts:24:28: error boundaries(no-unknown): Dependencies to unknown elements are not allowed` (measured now; zero lint lines name src/modules]
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 3086c1b5f62f · retry: on-spec-change
- builder: iris/opus · session f1a0fce9-4b44-4768-99bd-bc8c5e88819a · 1491s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_11/

### Phase 11 Ship Log — ↻ REPLANNED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · replan 3 of 3 · spec_sha 3086c1b5f62f → b9e4f1c05164 · replanner odysseus/claude-opus-5 · session 1716a535-39df-4ebc-8160-bc0d1a37c17e · 251s · cost $2.28
- cause: builder-blocked: Phase 11 step 7's check cannot print LINT-OK: `npm run lint` exits 1 on exactly ONE pre-existing error, `server/modules/providers/list/claude/session-host/readopt.ts:24:28: error boundaries(no-unknown): Dependencies to unknown elements are not allowed` (measured now; zero lint lines name src/modules
- changed: **What I changed.** Only Phase 11, and only its blocking gate. Step 7 demanded a repo-wide `LINT-OK` the deliverable never needed: `npm run lint` exits 1 on exactly one pre-existing error — `server/modules/providers/list/claude/session-host/readopt.ts:24:28 boundaries(no-unknown)`, another session's uncommitted work, whose cure the plan itself forbids — while `src/modules/kanban/` produces zero lint lines (measured now). I replaced it with the gate Phase 9 shipped and Phase 10 inherited: full `typecheck` gating in full (green now), full `lint` run but read only against `src/modules/kanban/`, red on any error naming it and on any line at all, error or warning. Added three `athena` items and t
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_11/

### Phase 11 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · cycle 7 · spawns 24/200 · fix-passes 1 of 2 · cost $9.73 (run $59.87) · resumed 0×
- builder: iris/opus · session fcae9f0d-943c-472b-adf7-fccf8cb62352 · 251s · RESULT: DONE
- athena: pass 1/opus BLOCKING 0 · HIGH 0 · MED 5 · LOW 8 → fix-pass 1/opus (312s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 6/6 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 5 · LOW 8 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_11/

### Phase 12 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: DIVERGENCE: step 6's check npm run typecheck > /tmp/kanban-p12-tc.log 2>&1 && npm run lint > /tmp/kanban-p12-lint.log 2>&1 && echo GREEN expects GREEN and cannot print it, because npm run lint exits 1 on exactly one error, server/modules/providers/list/claude/session-host/readopt.ts:24:28: error bou]
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 922e4544f59f · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session de432bb1-2d9c-421c-b27e-99851f900a14 · 1006s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_12/

### Phase 13 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: depends: not SHIPPED: Phase 12]
- run: lyphecli-kanban-board-plan-20260915-185844-9271 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha c13258bee15a · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/phase_13/

### Run lyphecli-kanban-board-plan-20260915-185844-9271 — COMPLETE 2026-09-15
- shipped: 6, 9, 10, 11
- blocked: 12: builder-blocked, 13: depends, 12: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/lyphecli-kanban-board.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-185844-9271/resume_brief.md

### Phase 12 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-225049-1bac · attempt 1 of 2 · cycle 1 · spawns 4/200 · fix-passes 1 of 2 · cost $0.79 (run $0.79) · resumed 0×
- builder: hephaestus/deepseek-flash · session 9d55896d-f329-4328-a2ba-ff6de7c16950 · 743s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 2 · LOW 4 → fix-pass 1/deepseek-flash (547s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 6/6 steps OK · verify 3/3 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 1 · MED 2 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-225049-1bac/phase_12/

### Phase 13 Ship Log — ✅ SHIPPED 2026-09-15
- run: lyphecli-kanban-board-plan-20260915-225049-1bac · attempt 1 of 2 · cycle 2 · spawns 5/200 · fix-passes 0 of 2 · cost $0.11 (run $0.90) · resumed 0×
- builder: prometheus/deepseek-flash · session 148c4ed6-1575-4cea-a03a-7e4438e61c21 · 231s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 2/2 steps OK · verify 4/4 OK
- forbidden: unchanged (9 declared, 9 present)
- evidence: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-225049-1bac/phase_13/

### Run lyphecli-kanban-board-plan-20260915-225049-1bac — COMPLETE 2026-09-15
- shipped: 12, 13
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/lyphecli-kanban-board-plan-20260915-225049-1bac/resume_brief.md
