import { getConnection } from '@/modules/database/connection.js';

/**
 * `companion_actions` as row-level statements: Kaylee's record of the actions she prepared for his word, one row for
 * each. The pending action itself is held in `companion_state.pending_json` (`companion.db.ts`); this table is the
 * house's record of it, opened when the action is prepared and ended once, with how it ended.
 *
 * This file speaks in ROWS (snake_case columns, JSON columns as the text they are stored as); the companion module maps
 * them to the wire contract. Every statement names the account it acts for, so an id of another account reads as no row.
 * Clear never deletes a row here (`companion-schema.ts` says why), and `ON DELETE CASCADE` from `users` is the only
 * thing that does.
 *
 * Consumer: the spread of `companionDb` in `companion.db.ts`, which is how the companion module reaches `openAction`,
 * `endAction` and `listActions` (reach it through `@/modules/database/index.js`).
 */

/** How an action ended: `took` and `already` are the door's answers, `refused` the door's refusal, `cancelled` his withdrawal or a Clear, `replaced` a newer prepare, `expired` a lapse found by the next verb. */
export type CompanionActionOutcome = 'took' | 'already' | 'refused' | 'cancelled' | 'replaced' | 'expired';

/** One `companion_actions` row, exactly as the table stores it. `outcome` is NULL while the action still waits for his word. */
export type CompanionActionRow = {
  id: string;
  user_id: number;
  action: string;
  /** `CompanionActionTarget` as JSON text. */
  target_json: string;
  /** The server-only pin (`ask`, `chainId`, `followupId`, `open`) as JSON text. Never sent to a page. */
  pin_json: string;
  prompt: string | null;
  /** The carried groups (`CompanionPendingAction['carried']`) as JSON text. */
  carried_json: string;
  prepared_at: string;
  expires_at: string;
  /** His line that fired it, verbatim, once it was taken. */
  said: string | null;
  said_at: string | null;
  said_log_id: number | null;
  ended_at: string | null;
  outcome: CompanionActionOutcome | null;
  /**
   * The door's own sentence for how it ended. While the action still waits, the sentence of the newest refusal of a take
   * (`noteRefusal`), so the row says why his line did not fire it.
   */
  answer: string | null;
};

/** What `openAction` takes: the columns the prepare knows. The account is the call's; the rest of the row starts empty. */
export type CompanionActionOpening = Pick<
  CompanionActionRow,
  'id' | 'action' | 'target_json' | 'pin_json' | 'prompt' | 'carried_json' | 'prepared_at' | 'expires_at'
>;

/**
 * What `endAction` takes: the `outcome`, with `ended_at` defaulting to now. The line that fired the action (`said`,
 * `said_at`, `said_log_id`) and the door's sentence (`answer`) are written when given and left empty otherwise.
 */
export type CompanionActionEnd = {
  outcome: CompanionActionOutcome;
  ended_at?: string;
  said?: string | null;
  said_at?: string | null;
  said_log_id?: number | null;
  answer?: string | null;
};

/** The most rows `listActions` answers: a bound on the ask, since the table keeps every action the account ever prepared. */
const LIST_ACTIONS_MAX = 1000;

const ACTION_COLUMNS =
  'id, user_id, action, target_json, pin_json, prompt, carried_json, prepared_at, expires_at, said, said_at, said_log_id, ended_at, outcome, answer';

export const companionActionsDb = {
  /** Records a prepared action for the account, with no outcome yet, and answers the row as stored. */
  openAction(userId: number, row: CompanionActionOpening): CompanionActionRow {
    const stored = getConnection()
      .prepare(
        `INSERT INTO companion_actions (id, user_id, action, target_json, pin_json, prompt, carried_json, prepared_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${ACTION_COLUMNS}`
      )
      .get(row.id, userId, row.action, row.target_json, row.pin_json, row.prompt, row.carried_json, row.prepared_at, row.expires_at) as
      | CompanionActionRow
      | undefined;

    if (!stored) throw new Error(`Could not record companion action ${row.id} for account ${userId}.`);
    return stored;
  },

  /**
   * Takes the account's action `id` up to be carried out: writes the line that fires it (`said`, `said_at`, `said_log_id`) on
   * a row with no outcome and no firing line yet. The write is one statement, so of two takes at once (or of a take and the
   * same take after a restart) exactly one wins, and the answer says whether THIS call did. A claimed row is the take's alone to
   * end: `endAction` ends it only for a call that names the claim's `said_log_id`, so his ×, a lapse, a newer prepare and a
   * Clear all leave it for the take to finish. Consumed by the companion's `take_action`.
   */
  claimAction(userId: number, id: string, claim: { said: string; said_at: string; said_log_id: number }): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE companion_actions SET said = ?, said_at = ?, said_log_id = ?
         WHERE id = ? AND user_id = ? AND outcome IS NULL AND said_log_id IS NULL`
      )
      .run(claim.said, claim.said_at, claim.said_log_id, id, userId);

    return result.changes > 0;
  },

  /**
   * Writes the sentence that refused a take onto the account's action `id` while it still waits (no outcome, not yet claimed),
   * so the row says why his line did not fire it. The newest refusal replaces the older. Answers whether a row took it.
   */
  noteRefusal(userId: number, id: string, sentence: string): boolean {
    const result = getConnection()
      .prepare(`UPDATE companion_actions SET answer = ? WHERE id = ? AND user_id = ? AND outcome IS NULL AND said_log_id IS NULL`)
      .run(sentence, id, userId);

    return result.changes > 0;
  },

  /**
   * Ends the account's action `id` with `end`. It writes only a row with no outcome yet — an action ends once, so a
   * second end (a Clear after a take, two pages' withdrawals) changes nothing — and a CLAIMED row (`claimAction`) only for a
   * call that carries the claim's own `said_log_id`. Answers whether THIS call ended it.
   */
  endAction(userId: number, id: string, end: CompanionActionEnd): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE companion_actions
         SET ended_at = ?, outcome = ?,
             said = COALESCE(?, said), said_at = COALESCE(?, said_at), said_log_id = COALESCE(?, said_log_id), answer = COALESCE(?, answer)
         WHERE id = ? AND user_id = ? AND outcome IS NULL AND (said_log_id IS NULL OR said_log_id = ?)`
      )
      .run(
        end.ended_at ?? new Date().toISOString(),
        end.outcome,
        end.said ?? null,
        end.said_at ?? null,
        end.said_log_id ?? null,
        end.answer ?? null,
        id,
        userId,
        end.said_log_id ?? null,
      );

    return result.changes > 0;
  },

  /**
   * The account's newest `limit` actions, newest first (by when they were prepared). `limit` is held to an integer in
   * 0..`LIST_ACTIONS_MAX`, so a huge or non-finite ask reads the most the bound allows and never reaches `LIMIT ?`
   * as a double, which SQLite refuses.
   */
  listActions(userId: number, limit: number): CompanionActionRow[] {
    const bounded = Number.isFinite(limit) ? Math.min(LIST_ACTIONS_MAX, Math.max(0, Math.trunc(limit))) : LIST_ACTIONS_MAX;

    return getConnection()
      .prepare(`SELECT ${ACTION_COLUMNS} FROM companion_actions WHERE user_id = ? ORDER BY prepared_at DESC, rowid DESC LIMIT ?`)
      .all(userId, bounded) as CompanionActionRow[];
  },
};
