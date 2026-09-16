import { getConnection } from '@/modules/database/connection.js';
import { AppError } from '@/shared/utils.js';

/**
 * The board's id mint, in one statement.
 *
 * The counter lives in `kanban_id_seq`, one row per prefix, and the bump is an UPSERT rather than
 * a read-then-write: two creates racing on the same prefix would otherwise both read the same
 * `next` and mint the same id. Inside a caller's transaction the upsert is serialized with the
 * insert that uses its answer, which is what makes the mint-and-insert pair atomic.
 *
 * Called with the transaction OPEN — `writeKanban` runs every mutating callback inside one — so a
 * rolled-back create leaves the counter where it was rather than burning an id.
 */
export const kanbanIdsDb = {
  /**
   * Mints `<prefix>-<n>` and returns it.
   *
   * Prefixes are one letter and are the id's only semantic: `b` boards, `c` cards, `q` questions,
   * `i` issues, `d` decisions, `k` checklist items, `a` attachments. A Descent row's own id is
   * never reused as a primary key — it is kept in `descent_id`.
   */
  mintId(prefix: string): string {
    const db = getConnection();
    const row = db
      .prepare(
        `INSERT INTO kanban_id_seq (prefix, next) VALUES (?, 1)
         ON CONFLICT(prefix) DO UPDATE SET next = next + 1
         RETURNING next`
      )
      .get(prefix) as { next: number } | undefined;

    if (!row) {
      // Unreachable with SQLite's `RETURNING`, but the alternative to this guard is returning the
      // string `"b-undefined"` as a primary key, which fails much later and much less clearly.
      throw new AppError(`Could not mint a kanban id for prefix "${prefix}".`, {
        code: 'KANBAN_ID_MINT_FAILED',
        statusCode: 500,
      });
    }

    return `${prefix}-${row.next}`;
  },
};
