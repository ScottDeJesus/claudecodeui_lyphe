/**
 * The shapes the Descent importer writes: one input type per target table, and the card's column
 * list in one spelling.
 *
 * They live apart from the statements that use them because the two change for different reasons —
 * this file moves when a target column moves, `kanban-import.db.ts` when a statement does — and
 * because the card's type below and its column list must agree field for field; keeping both here
 * is what makes that agreement checkable in one screen rather than across two files.
 */

/** One board as the importer writes it. `projectId` and `autonomy` are absent on purpose. */
export type KanbanImportBoard = {
  id: string;
  name: string;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  descentId: string;
};

/** One card as the importer writes it — every column Descent's `ov_features` maps onto. */
export type KanbanImportCard = {
  id: string;
  boardId: string;
  title: string;
  status: string;
  priority: string;
  description: string;
  closingRemarks: string;
  plan: string | null;
  body: string;
  approved: boolean;
  approvedAt: string | null;
  archived: boolean;
  sortOrder: number;
  buildTokensIn: number;
  buildTokensOut: number;
  buildTokensCacheRead: number;
  buildTokensCacheCreate: number;
  buildLeaseAt: string | null;
  buildOwner: string | null;
  planLeaseAt: string | null;
  planOwner: string | null;
  createdAt: string;
  updatedAt: string;
  descentId: string;
};

/** One question as the importer writes it. `options` and `selected` stay JSON text. */
export type KanbanImportQuestion = {
  id: string;
  cardId: string;
  text: string;
  multi: boolean;
  options: string;
  selected: string;
  otherOn: boolean;
  other: string;
  answered: boolean;
  sortOrder: number;
  createdAt: string;
  answeredAt: string | null;
  descentId: string;
};

/** One issue as the importer writes it. */
export type KanbanImportIssue = {
  id: string;
  cardId: string;
  text: string;
  resolved: boolean;
  filedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  descentId: string;
};

/** One decision as the importer writes it. `cardId` and `questionId` may both be null. */
export type KanbanImportDecision = {
  id: string;
  cardId: string | null;
  questionId: string | null;
  question: string;
  choice: string;
  tags: string;
  createdAt: string;
  descentId: string;
};

/** One checklist item as the importer writes it. */
export type KanbanImportChecklistItem = {
  id: string;
  cardId: string;
  text: string;
  state: string;
  sortOrder: number;
  note: string;
  createdAt: string;
  doneAt: string | null;
  descentId: string;
};

/** One attachment as the importer writes it. */
export type KanbanImportAttachment = {
  id: string;
  cardId: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  descentId: string;
};

/** One imported audit row. Its `id` is the table's own counter and is never supplied. */
export type KanbanImportEvent = {
  ts: string;
  kind: string;
  boardId: string | null;
  cardId: string | null;
  actor: string;
  payload: string;
  descentId: string;
};

/**
 * The card's columns, in the order `KanbanImportCard` declares them — one spelling, so no
 * statement is the odd one out and the twenty-four placeholders below cannot drift from the list.
 */
export const CARD_COLUMNS = `id, board_id, title, status, priority, description, closing_remarks,
  plan, body, approved, approved_at, archived, sort_order, build_tokens_in, build_tokens_out,
  build_tokens_cache_read, build_tokens_cache_create, build_lease_at, build_owner, plan_lease_at,
  plan_owner, created_at, updated_at, descent_id`;

/** What a card's upsert refreshes when Descent's copy is the newer one — every mapped column. */
export const CARD_UPDATES = `
  board_id = excluded.board_id, title = excluded.title, status = excluded.status,
  priority = excluded.priority, description = excluded.description,
  closing_remarks = excluded.closing_remarks, plan = excluded.plan, body = excluded.body,
  approved = excluded.approved, approved_at = excluded.approved_at,
  archived = excluded.archived, sort_order = excluded.sort_order,
  build_tokens_in = excluded.build_tokens_in, build_tokens_out = excluded.build_tokens_out,
  build_tokens_cache_read = excluded.build_tokens_cache_read,
  build_tokens_cache_create = excluded.build_tokens_cache_create,
  build_lease_at = excluded.build_lease_at, build_owner = excluded.build_owner,
  plan_lease_at = excluded.plan_lease_at, plan_owner = excluded.plan_owner,
  created_at = excluded.created_at, updated_at = excluded.updated_at`;

/** One row per placeholder in the card insert; `descent_id` is the last of the twenty-four. */
export const CARD_PLACEHOLDERS = new Array(24).fill('?').join(', ');
