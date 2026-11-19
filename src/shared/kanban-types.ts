// ---------------------------
//----------------- KANBAN BOARD CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the Kanban board: every shape the panel reads off a wire or hands to the
// grid and the drawer. Its twin is `server/shared/kanban-types.ts`, and the websocket frame
// `KanbanBoardEvent` is mirrored from its declaration in `server/shared/types.ts`.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and a
// `import type` across that boundary is a bundle that cannot build. It is a standalone mirror, so
// it edits in the SAME commit as its twin — a field renamed on one side and not the other is a
// frame the panel quietly stops reading, which is why Phase 5's check diffs the two name lists.
//
// A SIBLING of `src/shared/types.ts` rather than an addition to it, for the reason the server file
// is a sibling of `server/shared/types.ts`: that file is 2078 lines and the house ceiling for a
// module is 300. `src/shared/` already carries `authToken.ts`, `constants.ts`, `uiPreferences.ts`
// and ten more beside `types.ts`, so this is the existing convention.

/**
 * The five states a card can be in, exactly as the `kanban_cards.status` CHECK constrains them.
 *
 * A LANE IS A SET OF THESE, never a single one: with autonomy off the panel's To Do lane shows
 * `todo` and `questions` cards together. Which statuses compose which lane is the panel's own
 * policy (`src/modules/kanban/utils/lanePolicy.ts`); it is never derived from a lane's title, and
 * the kit components never see this type at all.
 */
export type KanbanStatus = 'not_ready' | 'todo' | 'questions' | 'active' | 'done';

/**
 * A card's priority, exactly as the `kanban_cards.priority` CHECK constrains them.
 *
 * `medium` is the default nearly every card carries, so the card face renders nothing for it —
 * see the panel's ink-ladder rule before printing this word on a card.
 */
export type KanbanPriority = 'low' | 'medium' | 'high';

/**
 * One board row, with the booleans SQLite stores as 0 or 1 already converted.
 *
 * `autonomy` is what the board header's switch reads: OFF hides the questions lane, every card
 * signal, the checklist, the token chips and the issues — it
 * hides nothing on the server and skips no write.
 */
export type KanbanBoard = {
  id: string;
  name: string;
  projectId: string | null;
  autonomy: boolean;
  /** The absolute paths of the git repositories the board's cards are built in. The server checks
   *  each is a directory inside a git work tree, and refuses autonomy on for a board that names
   *  none (409 `KANBAN_BOARD_NEEDS_REPOS`). */
  repos: string[];
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * One lane's server-side total, PER STATUS — five rows for a board, never one per lane.
 *
 * The panel sums the rows its lane policy composes and the server never learns the lanes; that is
 * what lets To Do read `todo + questions` without the API knowing a To Do lane exists.
 */
export type KanbanLaneCount = { status: KanbanStatus; total: number };

/**
 * One card as a lane renders it: the row, its tags and its four rolled-up counts.
 *
 * `buildTokens` is every token the build moved (input, output and both cache counters summed), so
 * the panel formats one number rather than four and the card never does token math.
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
 * One issue filed against a card. Only unresolved issues reach a card's face, and only their count
 * does — the open drawer lists the rows themselves.
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

/** One answered question's outcome, kept beside the card rather than on it. */
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
 * One checklist item. `state` is the three-word vocabulary the CHECK constrains, and `done` is the
 * only one the summary counts — which is why the drawer's Meter and the card's badge agree.
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
 * One attachment's metadata. The bytes never leave the card's own `attachments/` root: this row is
 * what the drawer lists, not what it downloads.
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
 * It is fetched once when the card is opened and never cached between opens, so the drawer cannot
 * render a checklist row that disagrees with the count on its face.
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

/** One audit-log row, with `payload` parsed back into an object. */
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
 * Every event kind the seam may record, mirrored from `server/shared/kanban-types.ts` where it is
 * declared beside the frame's own shapes.
 *
 * The panel reads it when it filters what arrived: `KanbanBoardEvent.event.kind` is the same
 * vocabulary one layer in. A kind the panel does not recognise is a frame it ignores rather than
 * crashes on, so this union widens with the server's and never narrows its checks.
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
 * One lesson: what a build learned, staged for a person's review before any later session reads it
 * back.
 *
 * The lifecycle is one-way and its two ends have OPPOSITE actors: the /learn sweep stages, a
 * person reviews, and only an approved lesson reaches a session again. `status` is carried as a
 * plain string and not a union — today `staged`, `approved` or `rejected` — because that vocabulary
 * grew a value twice.
 * `draftPath` is set ONLY for a `kind='skill_draft'` lesson, whose body also landed as a `SKILL.md`
 * file to promote, and `cardId` is nullable because a lesson outlives the card it was learned on.
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
 * One lesson as the index read returns it: enough to decide whether it is relevant — name,
 * one-line summary, trigger, tags, status — and never the body. `body` and `draftPath` arrive from
 * the by-id read for the one lesson the operator opens.
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
 * The board header's five counts, fetched in one request.
 *
 * THREE are scoped to the board in the URL: `building`, `awaitingAnswer` and `queued` (cards in To
 * Do waiting for the dispatcher). TWO are estate-wide and carry the word in their own names —
 * `lessonsPendingEstate`, `memoryPendingEstate` — because the rows behind them belong to no board
 * at all. The suffix is the contract: it is what stops a reader mistaking one for a board's number.
 * Zero is a count; an unknown reading is not — the strip draws it as an em-dash, never as 0.
 */
export type KanbanVitals = {
  building: number;
  awaitingAnswer: number;
  queued: number;
  lessonsPendingEstate: number;
  memoryPendingEstate: number;
};

/**
 * The websocket frame one board write produces, mirrored field-for-field from
 * `server/shared/types.ts` where it is declared beside its websocket siblings.
 *
 * `writeKanban` on the server is the ONLY producer: no verb, route or repository builds one. The
 * panel subscribes with `useWebSocket()` and filters on `kind === 'kanban_event'` AND on
 * `boardId` matching the open board — the server does no per-user or per-project filtering, so a
 * frame for another board arrives here too. `card` is the affected card FRESH after the write, or
 * null for a board-level write; `lanes` is the board's per-status totals after the write.
 *
 * `boardId` is null for a write made against the ESTATE rather than a board — a lesson staged with
 * no card behind it — and `lanes` is `[]` there. The subscription's own `typeof frame.boardId !==
 * 'string'` test drops such a frame, which is the truth: it is about no board this panel has open.
 */
export type KanbanBoardEvent = {
  kind: 'kanban_event';
  boardId: string | null;
  event: { id: number; ts: string; kind: string; cardId: string | null; actor: string };
  card: KanbanCardSummary | null;
  lanes: KanbanLaneCount[];
  at: number;
};
