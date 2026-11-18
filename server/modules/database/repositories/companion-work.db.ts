import { getConnection } from '@/modules/database/connection.js';

/**
 * `companion_work` as row-level statements: one row for each call of a tool the companion made in a turn, so the log can show a
 * turn's work the way a chat shows a session's (`companion-schema.ts` says what a row keeps, and what it never does).
 *
 * This file speaks in ROWS (snake_case columns, JSON as the text it is stored as); the companion store maps them to the wire
 * contract (`CompanionWorkEntry`, `CompanionWorkBody`). Every statement names the account it acts for, so an id of another account
 * reads as no row. The table is bounded: `beginWork` keeps the newest `COMPANION_WORK_KEEP` rows per account and deletes the rest
 * in the same transaction as the insert. Clear deletes the account's rows with its log (`clearAccount` in `companion.db.ts`).
 *
 * Consumer: the spread of `companionDb` in `companion.db.ts`, which is how the companion store reaches these verbs (reach it
 * through `@/modules/database/index.js`).
 */

/** How many calls an account keeps: more than the turns its 400 log rows hold are likely to have made. */
const COMPANION_WORK_KEEP = 400;

/** A call as the log lists it: every column but what it was given and what it answered, which are read one call at a time. */
export type CompanionWorkHeadRow = {
  id: number;
  turn_id: string | null;
  after_log_id: number;
  tool: string;
  about: string | null;
  started_at: string;
  ended_at: string | null;
  failed: number;
};

/** What a call was given and what it answered, exactly as stored: both NULL while `kept` is 0, and `result` NULL until the call ends. */
export type CompanionWorkBodyRow = { kept: number; input_json: string | null; result: string | null; result_cut: number };

/** What `beginWork` takes: the call without its id, account and place. `input_json` NULL with `kept` false stores neither part, ever. */
export type CompanionWorkInput = { turn_id: string | null; tool: string; about: string | null; kept: boolean; input_json: string | null };

/** How a call ended. `result` is ignored for a row that keeps none. */
export type CompanionWorkEnd = { failed: boolean; result: string | null; result_cut: boolean };

const HEAD_COLUMNS = 'id, turn_id, after_log_id, tool, about, started_at, ended_at, failed';

export const companionWorkDb = {
  /**
   * Opens one call's row, stamped now and placed after the account's newest log line (0 with no line), and prunes the account's rows
   * beyond the newest `COMPANION_WORK_KEEP`, in one transaction. Answers the row as the log lists it.
   */
  beginWork(userId: number, input: CompanionWorkInput): CompanionWorkHeadRow {
    const db = getConnection();
    const insert = db.prepare(
      `INSERT INTO companion_work (user_id, turn_id, after_log_id, tool, about, kept, input_json, started_at)
       VALUES (?, ?, COALESCE((SELECT id FROM companion_log WHERE user_id = ? ORDER BY id DESC LIMIT 1), 0), ?, ?, ?, ?, ?)
       RETURNING ${HEAD_COLUMNS}`
    );
    const prune = db.prepare(
      `DELETE FROM companion_work
       WHERE user_id = ?
         AND id <= (SELECT id FROM companion_work WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`
    );

    return db.transaction(() => {
      const row = insert.get(
        userId,
        input.turn_id,
        userId,
        input.tool,
        input.about,
        input.kept ? 1 : 0,
        input.kept ? input.input_json : null,
        new Date().toISOString(),
      ) as CompanionWorkHeadRow | undefined;
      if (!row) throw new Error(`Could not open a companion work row for account ${userId}.`);

      prune.run(userId, userId, COMPANION_WORK_KEEP);
      return row;
    })();
  },

  /**
   * Ends one call: when, whether it failed, and what it answered (never stored for a row that keeps none). A call ends once: a row
   * already ended, pruned meanwhile or another account's answers `null` and nothing is written.
   */
  endWork(userId: number, id: number, end: CompanionWorkEnd): CompanionWorkHeadRow | null {
    const row = getConnection()
      .prepare(
        `UPDATE companion_work
         SET ended_at = ?, failed = ?, result = CASE WHEN kept = 1 THEN ? ELSE NULL END, result_cut = CASE WHEN kept = 1 THEN ? ELSE 0 END
         WHERE user_id = ? AND id = ? AND ended_at IS NULL
         RETURNING ${HEAD_COLUMNS}`
      )
      .get(new Date().toISOString(), end.failed ? 1 : 0, end.result, end.result_cut ? 1 : 0, userId, id) as CompanionWorkHeadRow | undefined;
    return row ?? null;
  },

  /** The account's calls that stand at or after the log line `fromLogId`, oldest first: the work of the lines a picture holds. */
  listWork(userId: number, fromLogId: number): CompanionWorkHeadRow[] {
    return getConnection()
      .prepare(`SELECT ${HEAD_COLUMNS} FROM companion_work WHERE user_id = ? AND after_log_id >= ? ORDER BY id`)
      .all(userId, fromLogId) as CompanionWorkHeadRow[];
  },

  /** What one call was given and what it answered, or `null` for a call the account does not hold (pruned, cleared, another account's). */
  readWorkBody(userId: number, id: number): CompanionWorkBodyRow | null {
    const row = getConnection()
      .prepare('SELECT kept, input_json, result, result_cut FROM companion_work WHERE user_id = ? AND id = ?')
      .get(userId, id) as CompanionWorkBodyRow | undefined;
    return row ?? null;
  },
};
