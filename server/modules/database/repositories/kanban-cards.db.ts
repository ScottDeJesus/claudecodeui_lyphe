import { getConnection } from '@/modules/database/connection.js';
import {
  KANBAN_LANE_LIMIT_DEFAULT,
  KANBAN_SORT_ORDER_GAP,
  type KanbanCardSummary,
  type KanbanPriority,
  type KanbanStatus,
} from '@/shared/kanban-types.js';

import { kanbanCardTagsDb } from './kanban-card-tags.db.js';
import {
  CARD_COLUMNS,
  countsForCards,
  formatLaneCursor,
  lanePlaceholders,
  orderedByUpdatedAt,
  parseLaneCursor,
  toSummary,
  type KanbanCardCounts,
  type KanbanCardRow,
} from './kanban-cards-paging.db.js';

/** The four rolled-up counts a card face reads, in one statement. */
type KanbanCardCountsRow = {
  open_questions: number;
  open_issues: number;
  checklist_done: number;
  checklist_total: number;
};

/** The counts a card with no questions, issues or checklist has. One frozen value, not four zeros. */
const NO_COUNTS: KanbanCardCounts = {
  openQuestions: 0,
  openIssues: 0,
  checklistDone: 0,
  checklistTotal: 0,
};

/** The columns a card's text patch may touch, mapped to their SQL names. */
const CARD_PATCH_COLUMNS = {
  title: 'title',
  priority: 'priority',
  description: 'description',
  body: 'body',
  plan: 'plan',
  closingRemarks: 'closing_remarks',
} as const;

/** What a card patch may change. Every field is optional; an absent one is left exactly as it was. */
export type KanbanCardUpdatePatch = {
  id: string;
  title?: string;
  priority?: KanbanPriority;
  description?: string;
  body?: string;
  plan?: string | null;
  closingRemarks?: string;
};

/**
 * Cards, their tags, their rolled-up counts, and the lane page a status set reads as.
 *
 * Consumers: `kanban-cards.service.ts` (every card verb) and `kanban-write.service.ts` (the write
 * seam reads the affected card's FRESH summary to build its frame).
 * Reach it through `@/modules/database/index.js`.
 *
 * `getConnection()` is called per query, like every repository here, so a call made while the
 * write seam's transaction is open joins that transaction rather than opening a second one.
 */
export const kanbanCardsDb = {
  /**
   * One card as a lane shows it, or null when no such card exists.
   *
   * `getSummary` is called by the write seam AFTER a commit, which is why it takes no transaction
   * of its own: it must read what landed, not what it was asked to write.
   */
  getSummary(cardId: string): KanbanCardSummary | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${CARD_COLUMNS} FROM kanban_cards WHERE id = ?`)
      .get(cardId) as KanbanCardRow | undefined;

    if (!row) return null;

    const tags = db
      .prepare('SELECT tag FROM kanban_card_tags WHERE card_id = ? ORDER BY tag ASC')
      .all(cardId) as { tag: string }[];

    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM kanban_questions WHERE card_id = ? AND answered = 0) AS open_questions,
           (SELECT COUNT(*) FROM kanban_issues WHERE card_id = ? AND resolved = 0) AS open_issues,
           (SELECT COUNT(*) FROM kanban_checklist_items WHERE card_id = ? AND state = 'done') AS checklist_done,
           (SELECT COUNT(*) FROM kanban_checklist_items WHERE card_id = ?) AS checklist_total`
      )
      .get(cardId, cardId, cardId, cardId) as KanbanCardCountsRow;

    return toSummary(row, tags.map((tagRow) => tagRow.tag), {
      openQuestions: counts.open_questions,
      openIssues: counts.open_issues,
      checklistDone: counts.checklist_done,
      checklistTotal: counts.checklist_total,
    });
  },

  /**
   * One card's whole row, archived or not, or null when no such card exists.
   *
   * The drawer reads the long fields from here and the move verb reads the status it is leaving
   * from here; both want the row as stored rather than the summary's narrower view.
   */
  getCardRow(cardId: string): KanbanCardRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${CARD_COLUMNS} FROM kanban_cards WHERE id = ?`)
      .get(cardId) as KanbanCardRow | undefined;

    return row ?? null;
  },

  /**
   * Inserts one card at the bottom of its BOARD's ladder and returns nothing.
   *
   * The id is the caller's, already minted, and `sort_order` is assigned HERE in one statement:
   * the insert and its placement are decided together inside the caller's transaction.
   *
   * The ladder is the board's, not the card's own status's. A lane is a SET of statuses, and which
   * statuses compose one is panel policy this server never learns — so binding the card's own
   * status would drop a fresh To Do card into the middle of a lane that also shows `questions`.
   * One gap past the board's highest `sort_order` is below every card on the board, and so the
   * bottom of every lane that could hold it. The provenance column stays unset: this card was
   * created here and has no imported ancestor, and that column is nullable-UNIQUE exactly so many
   * rows may say so at once.
   */
  insertCard(input: {
    id: string;
    boardId: string;
    title: string;
    status: KanbanStatus;
    priority: KanbanPriority;
    description: string;
  }): void {
    const now = new Date().toISOString();
    getConnection()
      .prepare(
        `INSERT INTO kanban_cards (id, board_id, title, status, priority, description, sort_order, created_at, updated_at)
         VALUES (
           ?, ?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(sort_order), 0) + ${KANBAN_SORT_ORDER_GAP} FROM kanban_cards
            WHERE board_id = ? AND archived = 0),
           ?, ?
         )`
      )
      .run(
        input.id,
        input.boardId,
        input.title,
        input.status,
        input.priority,
        input.description,
        input.boardId,
        now,
        now
      );
  },

  /**
   * ONE ordered page across a whole status set, and the cursor that resumes after it.
   *
   * The `status IN (…)` list is built from the array's LENGTH and bound, never interpolated: a
   * status set is caller input, and a string-built clause is an injection with a lane's name on it.
   * A one-element set is the ordinary case, not a special one — the same statement serves To Do
   * and a lane that is two statuses at once.
   *
   * The keyset, not an OFFSET: `OFFSET 50` re-reads and discards fifty rows, and worse, it answers
   * a different question after a write — a card inserted above the window shifts everything down
   * and the next page repeats a card the last page already showed. The cursor names the row the
   * page stopped on, so the next page starts after THAT ROW'S value, whatever has moved since.
   *
   * Archived cards are excluded, so a lane page and the header count agree about what is in a lane.
   */
  listLane(
    boardId: string,
    statuses: KanbanStatus[],
    limit: number = KANBAN_LANE_LIMIT_DEFAULT,
    cursor?: string | null
  ): { cards: KanbanCardSummary[]; nextCursor: string | null } {
    const db = getConnection();
    const byUpdatedAt = orderedByUpdatedAt(statuses);
    const keyset = parseLaneCursor(cursor, byUpdatedAt);

    // Done reads newest-first off `updated_at`; every other lane reads `sort_order` ascending.
    const orderColumn = byUpdatedAt ? 'updated_at' : 'sort_order';
    const comparison = byUpdatedAt ? '<' : '>';
    const direction = byUpdatedAt ? 'DESC' : 'ASC';

    const values: (string | number)[] = [boardId, ...statuses];
    let keysetClause = '';
    if (keyset) {
      keysetClause = ` AND (${orderColumn} ${comparison} ? OR (${orderColumn} = ? AND id ${comparison} ?))`;
      values.push(keyset.key, keyset.key, keyset.id);
    }

    const rows = db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM kanban_cards
         WHERE board_id = ? AND archived = 0 AND status IN (${lanePlaceholders(statuses)})${keysetClause}
         ORDER BY ${orderColumn} ${direction}, id ${direction}
         LIMIT ?`
      )
      .all(...values, limit) as KanbanCardRow[];

    if (rows.length === 0) return { cards: [], nextCursor: null };

    // Two batch reads for the whole page, never one per card: fifty cards must not cost a hundred
    // round trips to draw a tag line and four counts.
    const cardIds = rows.map((row) => row.id);
    const tagsByCard = kanbanCardTagsDb.listTagsForCards(cardIds);
    const countsByCard = countsForCards(cardIds);

    const cards = rows.map((row) =>
      toSummary(row, tagsByCard.get(row.id) ?? [], countsByCard.get(row.id) ?? NO_COUNTS)
    );

    // A page shorter than the limit means the lane ran out, so there is nothing to resume from.
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length < limit || !last
        ? null
        : formatLaneCursor(byUpdatedAt ? last.updated_at : last.sort_order, last.id);

    return { cards, nextCursor };
  },

  /**
   * Applies a text patch and reports whether a card was there to change.
   *
   * `updated_at` is stamped here rather than by the caller, so no verb can forget it. The boolean
   * is what lets a verb turn "no such card" into a 404 INSIDE the write's transaction, rather than
   * reading first and hoping nothing moved in between.
   */
  updateCard(patch: KanbanCardUpdatePatch): boolean {
    const db = getConnection();
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];

    for (const [field, column] of Object.entries(CARD_PATCH_COLUMNS)) {
      const value = patch[field as keyof typeof CARD_PATCH_COLUMNS];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    assignments.push('updated_at = ?');
    values.push(new Date().toISOString(), patch.id);

    const result = db
      .prepare(`UPDATE kanban_cards SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);

    return result.changes > 0;
  },

  /**
   * Moves one card to a status at a given sort_order, clearing its build lease when asked.
   *
   * The lease clearing is part of the SAME statement as the move, not a second write after it: a
   * move that landed and a lease that failed to clear would leave an `active` lease on a card that
   * is no longer being built, and nothing would ever come back to release it.
   */
  setStatusAndOrder(input: {
    id: string;
    status: KanbanStatus;
    sortOrder: number;
    clearBuildLease: boolean;
  }): void {
    const assignments = ['status = ?', 'sort_order = ?', 'updated_at = ?'];
    const values: (string | number | null)[] = [
      input.status,
      input.sortOrder,
      new Date().toISOString(),
    ];
    if (input.clearBuildLease) assignments.push('build_lease_at = NULL', 'build_owner = NULL');
    values.push(input.id);

    getConnection()
      .prepare(`UPDATE kanban_cards SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  /** Archives or restores one card, reporting whether a card was there to change. */
  setArchived(cardId: string, archived: boolean): boolean {
    const result = getConnection()
      .prepare('UPDATE kanban_cards SET archived = ?, updated_at = ? WHERE id = ?')
      .run(archived ? 1 : 0, new Date().toISOString(), cardId);

    return result.changes > 0;
  },
};
