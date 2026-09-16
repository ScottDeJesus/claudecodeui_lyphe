import { getConnection } from '@/modules/database/connection.js';
import {
  KANBAN_LEASE_STALE_SECONDS,
  KANBAN_SORT_ORDER_GAP,
  type KanbanCardSummary,
  type KanbanLeaseState,
  type KanbanPriority,
  type KanbanStatus,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

/**
 * What a card IS, and how a lane of them is ordered — the two things `kanban-cards.db.ts` reads
 * from but does not own.
 *
 * The split is by cohesion, not by line count: everything here is shared by "one card" and "a page
 * of cards" — the row shape, the single mapper from a row to the summary every reader of a face
 * sees, and the lane algebra (cursor, direction, bounds, the resequencing that rescues a closed
 * gap, and the one grouped query a page's counts come from). `kanban-cards.db.ts` owns the
 * statements that touch those rows; it imports from here, and this file never imports from it.
 *
 * There is exactly ONE row-to-summary mapper in the module. A second one for the page would be a
 * lane whose cards disagree with the drawer opened from one of them — the counts would drift, the
 * lease would be spelled twice, and the bug would only show on the pages that mapper's author
 * happened not to test.
 */

/** One `kanban_cards` row, every column a summary or a detail read needs. */
export type KanbanCardRow = {
  id: string;
  board_id: string;
  title: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  description: string;
  body: string;
  plan: string | null;
  closing_remarks: string;
  approved: number;
  approved_at: string | null;
  archived: number;
  sort_order: number;
  build_tokens_in: number;
  build_tokens_out: number;
  build_tokens_cache_read: number;
  build_tokens_cache_create: number;
  build_lease_at: string | null;
  build_owner: string | null;
  plan_lease_at: string | null;
  plan_owner: string | null;
  created_at: string;
  updated_at: string;
};

/** Every column of a card, in one spelling, so no query is the odd one out. */
export const CARD_COLUMNS = `id, board_id, title, status, priority, description, body, plan, closing_remarks,
  approved, approved_at, archived, sort_order,
  build_tokens_in, build_tokens_out, build_tokens_cache_read, build_tokens_cache_create,
  build_lease_at, build_owner, plan_lease_at, plan_owner, created_at, updated_at`;

/**
 * Where a lane page resumes: the sort key of the last card the previous page showed, and that
 * card's id. The id is the tiebreak, not decoration — two cards one midpoint apart can land on the
 * same REAL, and a cursor carrying only the key would skip or repeat the second of them.
 */
export type KanbanLaneCursor = { key: number | string; id: string };

/** A lane's sort_order boundaries — nulls when the status set holds no live card. */
export type KanbanLaneBounds = { min: number | null; max: number | null };

/** The four rolled-up counts a card face reads, keyed by the card it belongs to. */
export type KanbanCardCounts = {
  openQuestions: number;
  openIssues: number;
  checklistDone: number;
  checklistTotal: number;
};

/** One row of the counts join, as SQLite aliases it. Snake case, like every row type here. */
type KanbanCountsRow = {
  card_id: string;
  open_questions: number;
  open_issues: number;
  checklist_done: number;
  checklist_total: number;
};

/**
 * How a lease reads right now, from the stamp alone.
 *
 * A missing stamp is `'none'`: nothing was ever claimed, which is a different answer from a claim
 * that has gone quiet. A stamp that will not parse is `'stale'`, deliberately — the caller who
 * wrote it is gone either way, and treating an unreadable one as live would hold a card forever.
 * The threshold is the shared constant, never a literal here: two spellings of 40 in one server
 * is a badge and a claim disagreeing.
 */
export function readLeaseState(buildLeaseAt: string | null): KanbanLeaseState {
  if (buildLeaseAt === null) return 'none';

  const claimedAtMs = Date.parse(buildLeaseAt);
  if (Number.isNaN(claimedAtMs)) return 'stale';

  return Date.now() - claimedAtMs > KANBAN_LEASE_STALE_SECONDS * 1000 ? 'stale' : 'held';
}

/** One row plus its tags and counts, as every reader of a card face sees it. */
export function toSummary(row: KanbanCardRow, tags: string[], counts: KanbanCardCounts): KanbanCardSummary {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    sortOrder: row.sort_order,
    tags,
    openQuestions: counts.openQuestions,
    openIssues: counts.openIssues,
    checklistDone: counts.checklistDone,
    checklistTotal: counts.checklistTotal,
    // Every token the build moved, summed: the face shows one spend number and must not have to
    // know how it was assembled. The breakdown the drawer shows comes from the detail read.
    buildTokens:
      row.build_tokens_in +
      row.build_tokens_out +
      row.build_tokens_cache_read +
      row.build_tokens_cache_create,
    approved: row.approved === 1,
    archived: row.archived === 1,
    buildLeaseAt: row.build_lease_at,
    buildOwner: row.build_owner,
    planLeaseAt: row.plan_lease_at,
    planOwner: row.plan_owner,
    leaseState: readLeaseState(row.build_lease_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The literal a cursor is written with: `<key>|<id>`.
 *
 * A pipe, because neither half can contain one — a sort key is a number or an ISO timestamp and an
 * id is `<prefix>-<n>`. The id is split off from the LAST pipe, so the format survives a key that
 * somehow grows one.
 */
const CURSOR_SEPARATOR = '|';

/** The placeholder list for `status IN (...)`, built from the array's LENGTH, never interpolated. */
export function lanePlaceholders(statuses: readonly KanbanStatus[]): string {
  return statuses.map(() => '?').join(', ');
}

/**
 * Whether a status set is the Done lane — the one lane ordered by when a card was last touched
 * rather than where it sits, newest first, because that is what a Done lane is for.
 *
 * The test is EXACT: a set mixing `done` with anything else is not the Done lane, and ordering
 * such a set by `updated_at` would strand its `todo` members out of position.
 */
export function orderedByUpdatedAt(statuses: KanbanStatus[]): boolean {
  return statuses.length === 1 && statuses[0] === 'done';
}

/** Writes the cursor a page hands back for the card it stopped on. */
export function formatLaneCursor(key: number | string, id: string): string {
  return `${key}${CURSOR_SEPARATOR}${id}`;
}

/**
 * Reads the cursor a caller handed back, or null when there was none.
 *
 * A malformed cursor is a 400 rather than a silent first page: a client that wrote one is asking
 * for a page it will not get, and returning the top of the lane instead would have it render a
 * card it already showed with no way to tell that is what happened.
 *
 * The key is re-typed for the ordering it belongs to: a `sort_order` keyset compares as a number,
 * an `updated_at` keyset as text. Reading a numeric key back as text would compare it against a
 * REAL column through SQLite's affinity rules and sort `"999"` above `"1000"`.
 */
export function parseLaneCursor(
  cursor: string | null | undefined,
  byUpdatedAt: boolean
): KanbanLaneCursor | null {
  if (cursor === null || cursor === undefined || cursor === '') return null;

  const separator = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (separator <= 0 || separator === cursor.length - 1) throw invalidCursor(cursor);

  const rawKey = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (byUpdatedAt) return { key: rawKey, id };

  const key = Number(rawKey);
  if (!Number.isFinite(key)) throw invalidCursor(cursor);

  return { key, id };
}

function invalidCursor(cursor: string): AppError {
  return new AppError(`"${cursor}" is not a kanban lane cursor.`, {
    code: 'KANBAN_CURSOR_INVALID',
    statusCode: 400,
  });
}

/**
 * The lowest and highest `sort_order` in a status set, ignoring archived cards.
 *
 * Both nulls means the set is empty, and that is a fact the caller needs to distinguish: `null` is
 * "no card here", not "a card at zero". The pair places a card moved to the top or the bottom of a
 * lane without ever reading the whole lane.
 */
export function laneBounds(boardId: string, statuses: readonly KanbanStatus[]): KanbanLaneBounds {
  const db = getConnection();
  const row = db
    .prepare(
      `SELECT MIN(sort_order) AS min_order, MAX(sort_order) AS max_order FROM kanban_cards
       WHERE board_id = ? AND archived = 0 AND status IN (${lanePlaceholders(statuses)})`
    )
    .get(boardId, ...statuses) as { min_order: number | null; max_order: number | null } | undefined;

  return { min: row?.min_order ?? null, max: row?.max_order ?? null };
}

/**
 * Rewrites every live card of a status set to a fresh ladder of `(index + 1) * KANBAN_SORT_ORDER_GAP`,
 * in its CURRENT order.
 *
 * Taken only when a midpoint has run out of room — two neighbours closer than `1e-6`, which a REAL
 * can represent but a page cannot order. It is a repair, never the ordinary path: renumbering a
 * lane on every move would rewrite fifty rows to place one card.
 *
 * `updated_at` is deliberately untouched — the rewrite changes where cards sit, not when they were
 * last written, and stamping them here would scramble the Done lane's newest-first order. Runs
 * inside the caller's transaction: a lane renumbered around a move that then failed would be a
 * renumbering nobody could explain.
 */
export function renormaliseLane(boardId: string, statuses: readonly KanbanStatus[]): void {
  const db = getConnection();
  const rows = db
    .prepare(
      `SELECT id FROM kanban_cards
       WHERE board_id = ? AND archived = 0 AND status IN (${lanePlaceholders(statuses)})
       ORDER BY sort_order ASC, id ASC`
    )
    .all(boardId, ...statuses) as { id: string }[];

  const update = db.prepare('UPDATE kanban_cards SET sort_order = ? WHERE id = ?');
  rows.forEach((row, index) => update.run((index + 1) * KANBAN_SORT_ORDER_GAP, row.id));
}

/**
 * The four rolled-up counts for a whole page of cards, in ONE statement.
 *
 * A query per card is the obvious shape and the wrong one: a fifty-card page would cost two
 * hundred round trips to draw four small numbers. Each child table is grouped ONCE and joined to
 * the page, so the cost is four passes no matter how many cards come back. A card with no
 * questions has no group to join, which is what the `COALESCE` reads as zero.
 */
export function countsForCards(cardIds: string[]): Map<string, KanbanCardCounts> {
  const countsByCard = new Map<string, KanbanCardCounts>();
  if (cardIds.length === 0) return countsByCard;

  const db = getConnection();
  const placeholders = cardIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT cards.id AS card_id,
              COALESCE(questions.open_questions, 0) AS open_questions,
              COALESCE(issues.open_issues, 0) AS open_issues,
              COALESCE(checklist.done_items, 0) AS checklist_done,
              COALESCE(checklist.total_items, 0) AS checklist_total
       FROM kanban_cards AS cards
       LEFT JOIN (
         SELECT card_id, COUNT(*) AS open_questions FROM kanban_questions WHERE answered = 0 GROUP BY card_id
       ) AS questions ON questions.card_id = cards.id
       LEFT JOIN (
         SELECT card_id, COUNT(*) AS open_issues FROM kanban_issues WHERE resolved = 0 GROUP BY card_id
       ) AS issues ON issues.card_id = cards.id
       LEFT JOIN (
         SELECT card_id,
                SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done_items,
                COUNT(*) AS total_items
         FROM kanban_checklist_items GROUP BY card_id
       ) AS checklist ON checklist.card_id = cards.id
       WHERE cards.id IN (${placeholders})`
    )
    .all(...cardIds) as KanbanCountsRow[];

  for (const row of rows) {
    countsByCard.set(row.card_id, {
      openQuestions: row.open_questions,
      openIssues: row.open_issues,
      checklistDone: row.checklist_done,
      checklistTotal: row.checklist_total,
    });
  }

  return countsByCard;
}
