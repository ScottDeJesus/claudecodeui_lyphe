import { getConnection } from '@/modules/database/connection.js';
import { companionActionsDb } from '@/modules/database/repositories/companion-actions.db.js';
import { isStoreStamp } from '@/shared/utils.js';

/**
 * `companion_state`, `companion_log` and `companion_notes`, as row-level statements — the three
 * tables of Kaylee's per-account side — and, through the spread at the end of `companionDb`, the
 * verbs of her record of actions (`companion_actions`, written in `companion-actions.db.ts`). The
 * fifth table of her schema, `relayed_sends`, hangs on a chat rather than an account and has its
 * own repository (`relayed-sends.db.ts`).
 *
 * This file speaks in ROWS: snake_case columns, JSON columns as the text they are stored as.
 * Mapping a row to the wire contract (`server/shared/companion-types.ts`) — parsing the JSON,
 * camelCasing, shaping a frame — is the companion store's job (`companion-store.ts`), not this
 * file's. Every statement names the account it acts for in its `WHERE` clause (or its `VALUES`),
 * so an id that belongs to another account reads as no row.
 *
 * The stamps are ISO-8601 UTC with milliseconds, written in JS. The log is bounded: `appendLog`
 * keeps the newest `COMPANION_LOG_KEEP` rows per account and deletes the rest in the same
 * transaction as the insert, so the table never holds more than that for one account.
 *
 * Consumers: `server/modules/companion/companion-store.ts` — the lane's reader and writer, `readSentence` included —
 * `companion.service.ts`, which asks `userIdsFocusedOn` which accounts a finished run is news to, and
 * `server/modules/companion/memory/memory-verbs.ts`, which reads and writes `memory_forget_line` through `readState` and `writeState`.
 * Reach it through `@/modules/database/index.js`. Every statement runs on the caller's
 * connection; only `appendLog` and `clearAccount` open a transaction of their own, so each lands
 * whole or not at all.
 */

/** How many log rows an account keeps; `appendLog` prunes everything older than the newest this many. */
const COMPANION_LOG_KEEP = 400;

/** One `companion_state` row, exactly as the table stores it — the JSON columns still text. */
export type CompanionStateRow = {
  user_id: number;
  /** Her CLI conversation; NULL until her first init and after Clear. */
  provider_session_id: string | null;
  /** `CompanionSessionRef` as JSON text, or NULL. */
  focus_json: string | null;
  /** `CompanionDraft` as JSON text, or NULL. */
  draft_json: string | null;
  /** `CompanionWalk` as JSON text, or NULL. */
  walk_json: string | null;
  /** The pending action with its server-only pin as JSON text, or NULL. */
  pending_json: string | null;
  /** His messages no turn of hers has answered yet (`UnansweredMessage[]`) as JSON text, or NULL for none. */
  unanswered_json: string | null;
  /** The client id holding the floor. Survives Clear. */
  floor: string | null;
  /**
   * The id of the `companion_log` line of his that the last forget of her memory used, or NULL before any. A forget needs a line with a
   * greater id, so one word of his forgets at most five memories. Survives Clear: log ids are never reused, so an old value stays a true
   * lower bound. A log id, never a memory: CloudCLI keeps none. Read and written only by `memory-verbs.ts`.
   */
  memory_forget_line: number | null;
  updated_at: string;
};

/**
 * The columns `writeState` may set. A key left out (or `undefined`) is not touched; `null` sets the
 * column to NULL.
 */
export type CompanionStatePatch = Partial<Omit<CompanionStateRow, 'user_id' | 'updated_at'>>;

/** One `companion_log` row, exactly as the table stores it. */
export type CompanionLogRow = {
  id: number;
  user_id: number;
  at: string;
  role: 'operator' | 'kaylee' | 'alert' | 'system';
  via: 'typed' | 'spoken' | null;
  turn_id: string | null;
  turn_index: number | null;
  text: string;
  mood: string | null;
  /** `CompanionSound[]` as JSON text, or NULL. */
  sounds_json: string | null;
};

/** What `appendLog` takes: a row without its id and account. `at` defaults to now; the optional columns to NULL. */
export type CompanionLogInput = {
  role: CompanionLogRow['role'];
  text: string;
  at?: string;
  via?: CompanionLogRow['via'];
  turn_id?: string | null;
  turn_index?: number | null;
  mood?: string | null;
  sounds_json?: string | null;
};

/** One `companion_notes` row, exactly as the table stores it. */
export type CompanionNoteRow = {
  id: number;
  user_id: number;
  at: string;
  title: string;
  text: string;
};

/** One log line as the check of his word reads it: who said it, how and when, with its words. Only his lines (`operator`) and hers (`kaylee`) are ever read this way. */
export type CompanionHeardRow = {
  id: number;
  at: string;
  role: 'operator' | 'kaylee';
  via: 'typed' | 'spoken' | null;
  text: string;
};

/** What `clearAccount` removed and whether a state row was there to reset. */
export type CompanionClearResult = {
  logRemoved: number;
  notesRemoved: number;
  stateReset: boolean;
};

/** Every state column the table holds besides the key: what a read returns and `writeState` may name. */
const STATE_PATCH_COLUMNS = ['provider_session_id', 'focus_json', 'draft_json', 'walk_json', 'pending_json', 'unanswered_json', 'floor', 'memory_forget_line'] as const;

const STATE_COLUMNS = `user_id, ${STATE_PATCH_COLUMNS.join(', ')}, updated_at`;
const LOG_COLUMNS = 'id, user_id, at, role, via, turn_id, turn_index, text, mood, sounds_json';
const NOTE_COLUMNS = 'id, user_id, at, title, text';

export const companionDb = {
  /** The account's state row, or `null` before anything of hers has been stored. */
  readState(userId: number): CompanionStateRow | null {
    const row = getConnection()
      .prepare(`SELECT ${STATE_COLUMNS} FROM companion_state WHERE user_id = ?`)
      .get(userId) as CompanionStateRow | undefined;

    return row ?? null;
  },

  /**
   * The accounts whose focus is the chat `sessionId` (an app session id), ascending. Read straight from the rows,
   * so an account whose Kaylee has not been touched since the server booted is found too. A `focus_json` that is
   * not JSON (a hand edit) names no one rather than failing the read for every account: `json_extract` would
   * throw on it, and SQLite does not promise to evaluate `json_valid` first inside an `AND`, so the guard is a `CASE`.
   */
  userIdsFocusedOn(sessionId: string): number[] {
    const rows = getConnection()
      .prepare(
        `SELECT user_id FROM companion_state
         WHERE CASE WHEN json_valid(focus_json) THEN json_extract(focus_json, '$.sessionId') END = ?
         ORDER BY user_id`
      )
      .all(sessionId) as Array<{ user_id: number }>;

    return rows.map((row) => row.user_id);
  },

  /**
   * The accounts whose last process left a message of his unanswered, ascending: what the server finds at boot to know
   * whose Kaylee must be made now, so she says those messages to her again without a page asking for her. A column that
   * holds an empty list names no one.
   */
  userIdsWithUnanswered(): number[] {
    const rows = getConnection()
      .prepare(`SELECT user_id FROM companion_state WHERE unanswered_json IS NOT NULL AND unanswered_json <> '[]' ORDER BY user_id`)
      .all() as Array<{ user_id: number }>;

    return rows.map((row) => row.user_id);
  },

  /**
   * Upserts the columns the patch names — creating the row when the account has none — stamps
   * `updated_at`, and answers the row as stored. The column list is built only from
   * `STATE_PATCH_COLUMNS`, so a key outside it is ignored rather than ever reaching the SQL text.
   */
  writeState(userId: number, patch: CompanionStatePatch): CompanionStateRow {
    const named = STATE_PATCH_COLUMNS.filter((column) => patch[column] !== undefined);
    const columns = [...named, 'updated_at'];
    const values = [...named.map((column) => patch[column] ?? null), new Date().toISOString()];

    const row = getConnection()
      .prepare(
        `INSERT INTO companion_state (user_id, ${columns.join(', ')})
         VALUES (?, ${columns.map(() => '?').join(', ')})
         ON CONFLICT(user_id) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}
         RETURNING ${STATE_COLUMNS}`
      )
      .get(userId, ...values) as CompanionStateRow | undefined;

    if (!row) throw new Error(`Could not write the companion state of account ${userId}.`);
    return row;
  },

  /**
   * Inserts one log row and deletes the account's rows beyond the newest `COMPANION_LOG_KEEP`, in
   * one transaction, answering the inserted row with its id. The prune finds the cutoff id by
   * walking the `(user_id, id)` index to the row just past the keep window; with fewer rows than
   * that the subselect is NULL and nothing matches.
   */
  appendLog(userId: number, entry: CompanionLogInput): CompanionLogRow {
    const db = getConnection();
    const insert = db.prepare(
      `INSERT INTO companion_log (user_id, at, role, via, turn_id, turn_index, text, mood, sounds_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${LOG_COLUMNS}`
    );
    const prune = db.prepare(
      `DELETE FROM companion_log
       WHERE user_id = ?
         AND id <= (SELECT id FROM companion_log WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`
    );

    return db.transaction(() => {
      const row = insert.get(
        userId,
        entry.at ?? new Date().toISOString(),
        entry.role,
        entry.via ?? null,
        entry.turn_id ?? null,
        entry.turn_index ?? null,
        entry.text,
        entry.mood ?? null,
        entry.sounds_json ?? null,
      ) as CompanionLogRow | undefined;
      if (!row) throw new Error(`Could not append a companion log row for account ${userId}.`);

      prune.run(userId, userId, COMPANION_LOG_KEEP);
      return row;
    })();
  },

  /**
   * The newest `limit` log rows of the account, oldest first — the order the panel draws them.
   * `limit` is held to 0..`COMPANION_LOG_KEEP`: the table never holds more than that for one
   * account, so a larger (or non-finite) ask reads the whole log, and a huge double never reaches
   * `LIMIT ?`, which SQLite refuses unless it is an integer.
   */
  readLog(userId: number, limit: number): CompanionLogRow[] {
    const bounded = Number.isFinite(limit)
      ? Math.min(COMPANION_LOG_KEEP, Math.max(0, Math.trunc(limit)))
      : COMPANION_LOG_KEEP;

    return getConnection()
      .prepare(
        `SELECT ${LOG_COLUMNS} FROM (
           SELECT ${LOG_COLUMNS} FROM companion_log WHERE user_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id`
      )
      .all(userId, bounded) as CompanionLogRow[];
  },

  /**
   * Her sentence `turnIndex` of the turn `turnId`, or `null` when the account has no such sentence (an unknown turn or index,
   * a log row pruned past the keep window, or a log that Clear emptied). Only `kaylee` rows carry a turn and an index, so the
   * role is part of the match; the newest row wins should a turn ever hold two of one index. The speech door reads it to
   * rebuild the text a voice is asked to say.
   */
  readSentence(userId: number, turnId: string, turnIndex: number): CompanionLogRow | null {
    const row = getConnection()
      .prepare(
        `SELECT ${LOG_COLUMNS} FROM companion_log
         WHERE user_id = ? AND role = 'kaylee' AND turn_id = ? AND turn_index = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(userId, turnId, turnIndex) as CompanionLogRow | undefined;

    return row ?? null;
  },

  /**
   * His lines and hers (`operator` and `kaylee` rows) logged after `since`, oldest first, at most `COMPANION_LOG_KEEP` —
   * the whole of what the log keeps for the account, which is the most a check of his word can need. `since` is an
   * ISO-8601 stamp; the stamps are fixed-width UTC, so the comparison is a text comparison and a line logged in the very
   * millisecond of `since` is not after it. A `since` that is not such a stamp (`''` would be "before every line") throws:
   * a check that reads "after the card went up" must not fail open. The panel's own lines (`alert`, `system`) are not his
   * words and are never read.
   */
  heardSince(userId: number, since: string): CompanionHeardRow[] {
    if (!isStoreStamp(since)) throw new Error(`heardSince needs a stored stamp (ISO-8601 UTC with milliseconds), not ${JSON.stringify(since)}.`);
    return getConnection()
      .prepare(
        `SELECT id, at, role, via, text FROM companion_log
         WHERE user_id = ? AND role IN ('operator', 'kaylee') AND at > ?
         ORDER BY id LIMIT ?`
      )
      .all(userId, since, COMPANION_LOG_KEEP) as CompanionHeardRow[];
  },

  /**
   * His last line before `before`, of any kind (`operator` rows, spoken or typed): the request that led to a prepare. `null` when he has
   * said nothing, and `null` when an action already fired on that very line (`companion_actions.said_log_id`): a word is never fired
   * twice, and the next line back is no stand-in for it. How far back the line may be is the check of his word's to judge
   * (`checkHisWord`). A line logged in the very millisecond of `before` is before it, as `heardSince` counts it. `before` must be a stored
   * stamp, for the reason `heardSince` gives. Consumed by `hands-tools.ts` (`take_action`, for a LIGHT action).
   */
  heardBefore(userId: number, before: string): CompanionHeardRow | null {
    if (!isStoreStamp(before)) throw new Error(`heardBefore needs a stored stamp (ISO-8601 UTC with milliseconds), not ${JSON.stringify(before)}.`);
    const db = getConnection();
    const row = db
      .prepare(`SELECT id, at, role, via, text FROM companion_log WHERE user_id = ? AND role = 'operator' AND at <= ? ORDER BY id DESC LIMIT 1`)
      .get(userId, before) as CompanionHeardRow | undefined;
    if (!row) return null;
    const spent = db.prepare('SELECT 1 FROM companion_actions WHERE user_id = ? AND said_log_id = ? LIMIT 1').get(userId, row.id);
    return spent ? null : row;
  },

  /** Inserts one card for the account, stamped now, and answers the row as stored. */
  addNote(userId: number, note: { title: string; text: string }): CompanionNoteRow {
    const row = getConnection()
      .prepare(
        `INSERT INTO companion_notes (user_id, at, title, text)
         VALUES (?, ?, ?, ?)
         RETURNING ${NOTE_COLUMNS}`
      )
      .get(userId, new Date().toISOString(), note.title, note.text) as CompanionNoteRow | undefined;

    if (!row) throw new Error(`Could not insert companion note "${note.title}".`);
    return row;
  },

  /** The account's cards, oldest first (`id` is the order they were shown in). */
  listNotes(userId: number): CompanionNoteRow[] {
    return getConnection()
      .prepare(`SELECT ${NOTE_COLUMNS} FROM companion_notes WHERE user_id = ? ORDER BY id`)
      .all(userId) as CompanionNoteRow[];
  },

  /** Deletes one of the account's cards, reporting whether a row of that account was there. `false` for an id of another account. */
  removeNote(userId: number, id: number): boolean {
    const result = getConnection()
      .prepare('DELETE FROM companion_notes WHERE id = ? AND user_id = ?')
      .run(id, userId);

    return result.changes > 0;
  },

  /**
   * Clear: deletes the account's log and cards and empties its state's conversation, focus, draft,
   * pending action, unanswered messages and walkthrough — in one transaction. `floor` stays (which client holds the floor
   * is no part of her conversation), and so does `memory_forget_line`: log ids are AUTOINCREMENT and never reused, so the id of the line
   * the last forget of her memory used stays a true lower bound after the log it named is gone, and a line he says next always has a
   * greater id. `relayed_sends` and `companion_actions` are never deleted from:
   * those rows are facts about chats and about the house. The one write Clear makes to
   * `companion_actions` is to END any row with no outcome yet as `cancelled`, in the same
   * transaction and before the state loses its `pending_json` — found by the row's own empty outcome rather than through
   * the column about to be emptied, so a `pending_json` that no longer parses cannot strand its row. A row a take has claimed
   * (`claimAction`: its firing line is written) is spared: its door is out, and the take ends it with the door's own outcome.
   * No state row is created when the account has none.
   */
  clearAccount(userId: number): CompanionClearResult {
    const db = getConnection();

    return db.transaction(() => {
      const clearedAt = new Date().toISOString();
      db.prepare(`UPDATE companion_actions SET ended_at = ?, outcome = 'cancelled' WHERE user_id = ? AND outcome IS NULL AND said_log_id IS NULL`).run(clearedAt, userId);
      const logRemoved = db.prepare('DELETE FROM companion_log WHERE user_id = ?').run(userId).changes;
      const notesRemoved = db.prepare('DELETE FROM companion_notes WHERE user_id = ?').run(userId).changes;
      const stateReset =
        db
          .prepare(
            `UPDATE companion_state
             SET provider_session_id = NULL, focus_json = NULL, draft_json = NULL, walk_json = NULL, pending_json = NULL, unanswered_json = NULL, updated_at = ?
             WHERE user_id = ?`
          )
          .run(clearedAt, userId).changes > 0;

      return { logRemoved, notesRemoved, stateReset };
    })();
  },

  // Her record of actions (`openAction`, `endAction`, `listActions`): the same object, so the companion reads one repository.
  ...companionActionsDb,
};
