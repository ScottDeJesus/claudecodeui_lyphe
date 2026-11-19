// ---------------------------
//----------------- KANBAN BOARD CONTRACTS ------------
// One home for every shape the Kanban board puts on a wire or crosses between two layers:
// repository row mappers, service verbs, route bodies and the websocket frame.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, because that file
// is 1672 lines and the house ceiling for a module is 300 — the same reason `src/shared/` already
// carries `authToken.ts`, `constants.ts` and eight more beside `types.ts`. Exactly one board type
// stays in `types.ts`: `KanbanBoardEvent`, which the plan places beside its websocket siblings.
//
// The client mirror is `src/shared/kanban-types.ts`, field for field. A change here without the
// same change there is a frame the panel cannot read, so the two are edited together, always.

/**
 * The five states a card can be in, exactly as the `kanban_cards.status` CHECK constrains them.
 *
 * A LANE IS A SET OF THESE, never a single one: with autonomy off the panel's To Do lane shows
 * `todo` and `questions` cards together. Which statuses compose which lane is PANEL policy, held
 * in one place (`src/modules/kanban/utils/lanePolicy.ts`); the server takes whatever set it is
 * handed — a one-element array is the ordinary case, not a special one.
 *
 * Consumers: every Kanban module file (`server/modules/kanban/`), the card and board repositories,
 * and the mirror in `src/shared/kanban-types.ts`.
 */
export type KanbanStatus = 'not_ready' | 'todo' | 'questions' | 'active' | 'done';

/**
 * A card's priority, exactly as the `kanban_cards.priority` CHECK constrains it.
 *
 * Consumers: `kanban-boards.service.ts`'s card input, `kanban-cards.db.ts`'s summary mapper,
 * and the mirror in `src/shared/kanban-types.ts`.
 */
export type KanbanPriority = 'low' | 'medium' | 'high';

/** The five statuses at RUNTIME, in the schema's own order — the type above is erased by the time a
 *  request arrives, and a route that has to refuse `status=todo,nonsense` needs the list itself.
 *  The ONE runtime home for the vocabulary. Consumers: `routes/card.routes.ts` (it refuses a status
 *  the column's CHECK would otherwise reject as a 500). */
export const KANBAN_STATUSES: readonly KanbanStatus[] = ['not_ready', 'todo', 'questions', 'active', 'done'];

/** The three priorities at RUNTIME, for the same reason and with the same consumer. */
export const KANBAN_PRIORITIES: readonly KanbanPriority[] = ['low', 'medium', 'high'];

/**
 * One board row, with the booleans SQLite stores as 0 or 1 already converted.
 *
 * The conversion is the repository's job and nobody else's: `autonomy` and `archived` are booleans
 * on this side of the wire, which is what the panel's autonomy switch reads and what makes
 * `GET /api/kanban/boards` render `false` rather than `0`.
 *
 * Consumers: `kanban-boards.db.ts` (the mapper), `kanban-boards.service.ts` (every board verb),
 * and `src/shared/kanban-types.ts`.
 */
export type KanbanBoard = {
  id: string;
  name: string;
  projectId: string | null;
  autonomy: boolean;
  /** The absolute paths of the git repositories this board's cards are built in, each a directory
   *  inside a git work tree (checked at the PATCH, `kanban-board-repos.ts`). The dispatcher walks a
   *  card in them, the first being where the walk runs. A board whose autonomy is on names at least
   *  one: turning autonomy on with none is a 409 `KANBAN_BOARD_NEEDS_REPOS`. Stored as JSON text in
   *  `kanban_boards.repos`. */
  repos: string[];
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * One lane's server-side total, PER STATUS — five rows for a board, never one per lane.
 *
 * The panel sums the rows its lane policy composes; the server never learns the lanes. That is
 * what lets To Do read `todo + questions` without the API knowing a To Do lane exists.
 *
 * Consumers: `kanban-boards.db.ts`'s `laneCounts`, `kanban-boards.service.ts`, the write seam's
 * frame builder, and `src/shared/kanban-types.ts`.
 */
export type KanbanLaneCount = { status: KanbanStatus; total: number };

/** How many cards a lane page holds when the caller names no limit. The ONE home for the number.
 *  Consumers: `routes/card.routes.ts` (it clamps), `kanban-cards.service.ts` (the default), and
 *  the lane read in `kanban-cards.db.ts` (its last-line fallback). A page size spelled in three
 *  places is a lane whose header and body disagree about how much of it is loaded. */
export const KANBAN_LANE_LIMIT_DEFAULT = 50;

/** The hard ceiling on a lane page. Without it one request can ask for a whole board's lane in one
 *  page, which is a lot of card rows for a header strip to have asked for. Consumers: the same
 *  three as the default. */
export const KANBAN_LANE_LIMIT_MAX = 200;

/** The rung a lane's order climbs by. A new card sits one rung past the last, a move to the top
 *  sits one rung before the first, and a card spliced between two neighbours takes their midpoint
 *  — so the ladder is what makes room for the midpoint without touching another row. The ONE home
 *  for the number. Consumers: `insertCard`, `renormaliseLane` and `moveCard`'s top-and-bottom
 *  placement. A gap spelled differently in two of those is a lane that orders one way and
 *  renumbers another. */
export const KANBAN_SORT_ORDER_GAP = 1000;

/** How close two neighbours may get before a midpoint stops being representable — a REAL runs out
 *  of precision long before it runs out of range, and two cards on the same value are a lane whose
 *  order is decided by id rather than by drag. Below this, the lane is renumbered first. The ONE
 *  home for the number. Consumers: `moveCard` (it decides) and the doctrine it follows. */
export const KANBAN_SORT_ORDER_MIN_GAP = 1e-6;

/**
 * The optional trailing argument every WRITE verb takes. An absent actor means `'operator'`.
 *
 * No route stamps an actor: a route's write is the operator's and passes no context. The intake
 * door (`kanban-intake`) and the board-dispatch module (`kanban-dispatch`, actor `dispatcher`) pass
 * their own.
 *
 * Consumers: every write verb in `server/modules/kanban/`, the write seam's `actor` field, the
 * intake door and the board-dispatch module.
 */
export type KanbanWriteContext = { actor?: string };

/**
 * Every event kind the seam may record — the `kanban_events.kind` vocabulary, and with it the
 * frame kinds a panel can subscribe to.
 *
 * Consumers: `kanban-write.service.ts` (the seam's `spec.kind`), `kanban-events.db.ts` (the row's
 * `kind`), and `src/shared/kanban-types.ts`.
 *
 * The row's own `kind` is read back as a plain `string` (`KanbanEventRow`), never narrowed to this
 * union on the way out: rows written under a kind this union has since dropped still read.
 */
export type KanbanEventKind =
  | 'board.created'
  | 'board.updated'
  | 'board.selected'
  | 'board.archived'
  | 'card.created'
  | 'card.updated'
  | 'card.moved'
  | 'card.archived'
  | 'card.restored'
  | 'tag.added'
  | 'tag.removed'
  | 'question.added'
  | 'question.answered'
  | 'decision.noted'
  | 'issue.filed'
  | 'issue.resolved'
  | 'checklist.added'
  | 'checklist.updated'
  | 'checklist.removed'
  | 'attachment.added'
  | 'attachment.removed'
  | 'lesson.staged'
  | 'lesson.reviewed';

/**
 * One card as a lane renders it: the row, its tags, and its four rolled-up counts.
 *
 * `buildTokens` is every token the build moved — input, output and both cache counters summed,
 * so the panel formats one number rather than four and the card never does token math.
 *
 * Consumers: `kanban-cards.db.ts` (`getSummary`), `kanban-boards.service.ts` and the write seam
 * (the frame's `card`), and `src/shared/kanban-types.ts`.
 */
export type KanbanCardSummary = {
  id: string;
  boardId: string;
  title: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  sortOrder: number;
  tags: string[];
  openQuestions: number;
  openIssues: number;
  checklistDone: number;
  checklistTotal: number;
  buildTokens: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * One question on a card, with its options and answer as parsed arrays rather than the JSON text
 * SQLite holds.
 *
 * Consumers: `kanban-questions.db.ts`, `kanban-questions.service.ts` (the verbs that add and
 * answer one, and write the decision the answer becomes), and `src/shared/kanban-types.ts`.
 */
export type KanbanQuestion = {
  id: string;
  cardId: string;
  text: string;
  multi: boolean;
  options: string[];
  selected: string[];
  otherOn: boolean;
  other: string;
  answered: boolean;
  sortOrder: number;
  createdAt: string;
  answeredAt: string | null;
};

/**
 * One issue filed against a card. Only unresolved issues reach a card's face, and only the count
 * of them does — the route that lists them serves the drawer.
 *
 * Consumers: `kanban-checklist.db.ts`, `kanban-checklist.service.ts` (the file and resolve verbs),
 * `kanban-cards.db.ts` (the summary's `openIssues`), and `src/shared/kanban-types.ts`.
 */
export type KanbanIssue = {
  id: string;
  cardId: string;
  text: string;
  resolved: boolean;
  filedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

/**
 * One answered question's outcome, kept beside the card rather than on it.
 *
 * Consumers: `kanban-questions.service.ts` (`answerQuestion` writes one), the card-detail mapper,
 * and `src/shared/kanban-types.ts`.
 */
export type KanbanDecision = {
  id: string;
  cardId: string | null;
  questionId: string | null;
  question: string;
  choice: string[];
  tags: string[];
  createdAt: string;
};

/**
 * One checklist item. `state` is the three-word vocabulary the CHECK constrains, and `done` is
 * the only one the summary counts.
 *
 * Consumers: `kanban-checklist.db.ts`, `kanban-checklist.service.ts`, the card-detail mapper,
 * and `src/shared/kanban-types.ts`.
 */
export type KanbanChecklistItem = {
  id: string;
  cardId: string;
  text: string;
  state: 'pending' | 'active' | 'done';
  sortOrder: number;
  note: string;
  createdAt: string;
  doneAt: string | null;
};

/**
 * One attachment's metadata. The bytes never leave the card's own `attachments/` root: this row
 * is what the drawer lists, not what it downloads.
 *
 * Consumers: `kanban-checklist.db.ts`, `kanban-checklist.service.ts`, the card-detail mapper,
 * and `src/shared/kanban-types.ts`.
 */
export type KanbanAttachment = {
  id: string;
  cardId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
};

/**
 * A summary plus everything only the open drawer shows: the long text fields, the four token
 * counters broken out, and the five child collections.
 *
 * It is built once per card open, from one transaction's worth of reads, so a card cannot render
 * a checklist row that disagrees with the count on its face.
 *
 * Consumers: `kanban-cards.service.ts`'s `getCard`, the card-detail route, and
 * `src/shared/kanban-types.ts`.
 */
export type KanbanCardDetail = KanbanCardSummary & {
  description: string;
  body: string;
  plan: string | null;
  closingRemarks: string;
  buildTokensIn: number;
  buildTokensOut: number;
  buildTokensCacheRead: number;
  buildTokensCacheCreate: number;
  questions: KanbanQuestion[];
  issues: KanbanIssue[];
  decisions: KanbanDecision[];
  checklist: KanbanChecklistItem[];
  attachments: KanbanAttachment[];
};

/**
 * One audit-log row, with `payload` parsed back into an object.
 *
 * Consumers: `kanban-events.db.ts` (both writers and the reader), the write seam (the frame's
 * `event`), `kanban-boards.service.ts`'s `listEvents`, and `src/shared/kanban-types.ts`.
 */
export type KanbanEventRow = {
  id: number;
  ts: string;
  kind: string;
  boardId: string | null;
  cardId: string | null;
  actor: string;
  payload: Record<string, unknown>;
};

/**
 * One lesson: what a build learned, staged for a person's review before any later session reads it
 * back.
 *
 * The lifecycle is one-way and its two ends have OPPOSITE actors: the `/learn` spill sweep
 * stages, a person reviews, and only an approved lesson reaches a session again. `status` is
 * carried as a plain string and not a union — today `staged`, `approved` or `rejected` — because
 * that vocabulary grew a value twice. `draftPath` is set ONLY for a
 * `kind='skill_draft'` lesson, whose body also landed as a `SKILL.md` file to promote. `cardId` is
 * provenance and nullable on purpose: a lesson OUTLIVES the card it was learned on.
 *
 * Consumers: `kanban-learning.db.ts` (the row mapper), `kanban-lessons.service.ts` (stage, get and
 * review), the lesson routes, and `src/shared/kanban-types.ts`.
 */
export type KanbanLesson = {
  id: string;
  cardId: string | null;
  name: string;
  summary: string;
  body: string;
  trigger: string;
  kind: 'note' | 'skill_draft';
  tags: string[];
  status: string;
  source: string;
  draftPath: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

/**
 * One lesson as the index read returns it: enough to decide whether the lesson is relevant — name,
 * one-line summary, trigger, tags, status — and never the body.
 *
 * The exclusion is the point: an index of fifty lessons carrying fifty bodies would ship the whole
 * corpus so the panel could draw fifty titles. `body` and `draftPath` arrive from the by-id read for
 * the one lesson the operator opens.
 *
 * Consumers: `kanban-learning.db.ts` (the lean projection), `kanban-lessons.service.ts`
 * (`listLessons`), the lesson list route, and `src/shared/kanban-types.ts`.
 */
export type KanbanLessonLean = {
  id: string;
  cardId: string | null;
  name: string;
  summary: string;
  trigger: string;
  kind: 'note' | 'skill_draft';
  tags: string[];
  status: string;
  source: string;
  createdAt: string;
  reviewedAt: string | null;
};

/**
 * Five counts the board header shows as a strip of registers, read in one request rather than
 * derived by the panel from five lists it would otherwise have to fetch whole.
 *
 * THREE of them are BOARD-scoped, because they are counts of THIS board's cards: `building` (cards in
 * the Building lane — `status = 'active'` — where a card stays while its walk is out), `awaitingAnswer`
 * (cards with a question still unanswered) and `queued` (cards in To Do — `status = 'todo'` — waiting
 * for the dispatcher to take them up). TWO are ESTATE-wide, because the rows behind them belong to no
 * board at all:
 * `lessonsPendingEstate` counts staged lessons and `memoryPendingEstate` counts pending memory
 * candidates across the whole install.
 *
 * THE SUFFIX IS THE CONTRACT, not decoration: a count not scoped to the board in the URL carries
 * the word `Estate` in its own name, so no caller can read one as a board-scoped number. Every value
 * is a COUNT, never a list — the panel draws a badge, and the list is one click away.
 *
 * Consumers: `kanban-vitals.service.ts` (`vitalsCounts`), the vitals route's `{ vitals }` body, the
 * panel's counts strip, and `src/shared/kanban-types.ts`.
 */
export type KanbanVitals = {
  building: number;
  awaitingAnswer: number;
  queued: number;
  lessonsPendingEstate: number;
  memoryPendingEstate: number;
};
