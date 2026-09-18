import { getConnection } from '@/modules/database/connection.js';
import { kanbanImportChildrenDb } from '@/modules/database/repositories/kanban-import-children.db.js';
import {
  CARD_COLUMNS,
  CARD_PLACEHOLDERS,
  CARD_UPDATES,
  type KanbanImportBoard,
  type KanbanImportCard,
} from '@/modules/database/repositories/kanban-import-rows.db.js';

/**
 * The Descent importer's writes: the lookup that decides insert-or-refresh, the board and the
 * card, the card/tag join, and — spread in from `kanban-import-children.db.ts` — the six tables
 * that hang off a card together with the lessons that hang off nothing. It is ONE object on
 * purpose: the importer holds one handle on one rule.
 *
 * Every statement keys on `descent_id`, which is what makes a second run an UPDATE rather than a
 * second copy: the row already standing for a Descent row keeps the Athena id it was minted, so
 * every link that pointed at it still does. A row with no `descent_id` — every card created here —
 * is untouched by all of this: SQLite lets many NULLs stand under one UNIQUE constraint, and a
 * conflict on that column only ever fires for the rows that carry one.
 *
 * THE TWO GUARDED STATEMENTS ARE THE TWO IN THIS FILE, and that is the cohesion of the split:
 * `kanban_boards` and `kanban_cards` each trail an `excluded.updated_at` guard comparing the
 * incoming timestamp against the table's own, so a row edited here after Descent last touched it
 * survives a re-import untouched. Descent therefore wins only when it is newer. A conflict whose
 * guard is false is not an error: SQLite skips the row, `changes` comes back zero, and the import
 * completes. The sibling's six are unguarded and total, deliberately — they have no local editing
 * surface, and guarding a card's questions but not its issues would leave one card half from each
 * side, which is worse than either rule applied whole.
 *
 * Consumers: `kanban-import.service.ts`, which calls these from INSIDE the write seam's
 * transaction — a half-imported board must not be able to survive, and every statement here joins
 * the connection `getConnection()` already has open. Reach this through
 * `@/modules/database/index.js`.
 */

/** The target tables that carry a `descent_id`, and so the only ones a lookup may name. */
export type KanbanImportTable =
  | 'kanban_boards'
  | 'kanban_cards'
  | 'kanban_questions'
  | 'kanban_issues'
  | 'kanban_decisions'
  | 'kanban_checklist_items'
  | 'kanban_attachments'
  | 'kanban_events'
  | 'kanban_lessons';

export const kanbanImportDb = {
  /**
   * The Athena id already standing for a Descent row, or null when the row is new here.
   *
   * This is the answer that keeps a re-import from re-minting: the caller reuses the id it finds,
   * so a card's questions, tags and events keep pointing at the card they were imported beside.
   * Its second job is the counts — a row found here is one refreshed, a row not found is one
   * inserted.
   *
   * `kanban_events` is in the union although its primary key is the table's own counter: the
   * caller never writes that id, but it does want to know whether a source event is already here.
   */
  findIdByDescentId(table: KanbanImportTable, descentId: string): string | null {
    const db = getConnection();
    // The table name is interpolated from the allowlist above, never from a request; the id
    // travels as a bound parameter like every other value in this file.
    const row = db.prepare(`SELECT id FROM ${table} WHERE descent_id = ?`).get(descentId) as
      | { id: string }
      | undefined;

    return row?.id ?? null;
  },

  /**
   * Inserts or refreshes one board, unless the copy here was edited more recently.
   *
   * `project_id` and `autonomy` are absent from both halves of the statement: Descent's board has
   * neither — the board there is the whole install's — so they stay at this table's defaults on
   * insert and are left exactly as the operator set them on every re-import.
   */
  upsertBoard(board: KanbanImportBoard): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_boards (id, name, sort_order, archived, created_at, updated_at, descent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(descent_id) DO UPDATE SET
           name = excluded.name,
           sort_order = excluded.sort_order,
           archived = excluded.archived,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= kanban_boards.updated_at`
      )
      .run(
        board.id,
        board.name,
        board.sortOrder,
        board.archived ? 1 : 0,
        board.createdAt,
        board.updatedAt,
        board.descentId
      ).changes;
  },

  /** Inserts or refreshes one card — every column, guarded so a local edit outranks Descent. */
  upsertCard(card: KanbanImportCard): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_cards (${CARD_COLUMNS})
         VALUES (${CARD_PLACEHOLDERS})
         ON CONFLICT(descent_id) DO UPDATE SET ${CARD_UPDATES}
         WHERE excluded.updated_at >= kanban_cards.updated_at`
      )
      .run(
        card.id,
        card.boardId,
        card.title,
        card.status,
        card.priority,
        card.description,
        card.closingRemarks,
        card.plan,
        card.body,
        card.approved ? 1 : 0,
        card.approvedAt,
        card.archived ? 1 : 0,
        card.sortOrder,
        card.buildTokensIn,
        card.buildTokensOut,
        card.buildTokensCacheRead,
        card.buildTokensCacheCreate,
        card.buildLeaseAt,
        card.buildOwner,
        card.planLeaseAt,
        card.planOwner,
        card.createdAt,
        card.updatedAt,
        card.descentId
      ).changes;
  },

  /**
   * Adds one card/tag pair, or nothing when the pair is already there.
   *
   * An ignore rather than an upsert, because `ov_tags` IS Descent's join table: the pair is the
   * key and there is no third column to refresh, so a second run has nothing to update.
   */
  insertCardTag(cardId: string, tag: string): number {
    const db = getConnection();
    return db
      .prepare('INSERT OR IGNORE INTO kanban_card_tags (card_id, tag) VALUES (?, ?)')
      .run(cardId, tag).changes;
  },

  // The card's satellites — questions, issues, decisions, checklist items, attachments and the
  // imported audit rows — and the estate's own lessons are the sibling's, so this file stays the
  // board and its cards.
  ...kanbanImportChildrenDb,
};
