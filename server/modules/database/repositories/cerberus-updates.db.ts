import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `updates` and `update_steps`, as row-level statements — every attempt to move a warden to a new
 * release, and the progress it reported on the way.
 *
 * An UPDATE is one node's trip to one release. It is written queued (`insert`, `step` 'queued') when a
 * person starts a batch, moves its `step` as the warden's progress frames arrive (`setStep`), and
 * ends exactly once (`end`): `updated`, `rolled_back` or `failed`. Both movers are one `UPDATE` that
 * only fires while the update has not ended, and its `changes` is the verdict — a resent frame or a
 * late hello cannot move a finished update through them. An update is LIVE from `insert` until `end`
 * (`ended_at IS NULL`). Updates and their steps are kept forever (spec Table 4: "updates … Forever"):
 * no statement here deletes a row, and the daily prune reaches neither table. The ONE statement that
 * moves an ended update is `rolledBackAfterUpdated`: an `updated` that the launcher took back within
 * the window, heard on the old release's hello.
 *
 * STEPS are the progress frames, one row each, stamped on the center's clock. `insertStep` is
 * `ON CONFLICT DO NOTHING` — the primary key `(update_id, at, step)` is the ONLY conflict it
 * swallows, so a frame resent inside one millisecond lands once, while a malformed one (a NULL, a
 * fractional `at`) still THROWS rather than answering `false` as a resend does — the hazard
 * `cerberus-results.db.ts` documents. The update a step is filed under must exist, or it THROWS: a
 * step under no `updates` row is read by nothing. A step that arrives after the update ended is
 * REFUSED like a resend (`false`): `insertStep` never grows a finished update's history (the one
 * writer that adds a step after the end is `rolledBackAfterUpdated`, and its step is a `failed`), and a
 * `restarting` step filed after the end would give `pauseWindows` a span that ends before it begins.
 *
 * VALUES THE TYPES FORBID, which a table cannot: SQLite lets a `PRIMARY KEY` column be NULL, and a
 * `CHECK (result IN (…))` passes NULL. So `insert` THROWS on an id that is not a non-empty string
 * (a NULL-id row is live and nothing can end it, so it would block every later batch) and `end`
 * THROWS on a `result` outside the three outcomes (a NULL one ends the update with no verdict, and
 * the first end wins, so it could never be set afterwards). Tightening the table instead would be a
 * new migration step — the one that has run on the live store is never edited.
 *
 * A node's PAUSED window (spec Table 1: "paused … derived") is not stored. `pauseWindows` works it
 * out from the rows: each update's span from its `restarting` step to its end.
 *
 * Rows are exactly as the tables store them: snake_case, times in epoch milliseconds.
 *
 * The tables have no index beyond their keys: they hold one row per node per update, so a scan is a
 * few microseconds, and an index would be one more thing to keep right for no measured gain.
 *
 * Every `limit` below is clamped to a whole number between 0 and the largest safe integer before it
 * reaches SQL: SQLite reads `LIMIT -1` as "no limit", so an unclamped negative would dump the table,
 * and a `NaN` or a value past its integer range is a datatype mismatch — `NaN` becomes 0, `Infinity`
 * and anything huge the largest safe integer.
 *
 * Consumers: `server/modules/cerberus/` — the updates service (`insert` for a batch, `get`, `forBatch`
 * and `running` for its 409 and its driver, `setStep` and `insertStep` for every progress frame,
 * `end` for the verdict, `rolledBackAfterUpdated` for a rollback heard after the end), the runs
 * service, the auto-run rule and the diagnosis service (`activeNode`, the node closed to new work),
 * the read model (`running` and `forBatch` with `steps` for the views, `pauseWindows` for the paused
 * overlay, `recent` for What happened). Reach it through `@/modules/database/index.js`. Every
 * statement runs on the caller's connection and opens no transaction of its own — except
 * `rolledBackAfterUpdated`, whose two writes are one unit by construction.
 */

// The three outcomes `updates.result` allows — the table's CHECK, written out once so `end` can refuse
// the NULL the CHECK lets through.
const UPDATE_RESULTS = ['updated', 'rolled_back', 'failed'] as const;

/** How an update ended. `rolled_back` is the node coming back on its old release after a failed swap. */
export type CerberusUpdateResult = (typeof UPDATE_RESULTS)[number];

/** One `updates` row, exactly as the table stores it. */
export type CerberusUpdateRow = {
  id: string;
  /** The batch a person started; its updates run one at a time. */
  batch: string;
  node: string;
  /** What the node ran when the row was written; NULL when it had never said. */
  from_version: string | null;
  /** The release offered. */
  to_version: string;
  /** When the row was written, on the center's clock — the batch's start; a queued update has one. */
  started_at: number;
  /** 'queued' until the node's turn, then the warden's latest reported step. */
  step: string | null;
  /** On the center's clock; NULL while the update is live. */
  ended_at: number | null;
  /** NULL while the update is live. */
  result: CerberusUpdateResult | null;
  /** The reason, for a failure or a rollback; NULL otherwise. */
  note: string | null;
};

/** The columns `insert` writes. The rest are the end's to fill. */
export type CerberusUpdateInsert = Omit<CerberusUpdateRow, 'ended_at' | 'result' | 'note'>;

/** One `update_steps` row of a known update: when it arrived, which step, and the line the dialog shows. */
export type CerberusUpdateStepRow = {
  at: number;
  step: string;
  text: string;
};

/**
 * One restart span: from the update's first `restarting` step to its end. `to_at` is NULL while the
 * update is still live — the warden is restarting right now; a reader takes that as "until now".
 */
export type CerberusPauseWindowRow = {
  update_id: string;
  from_at: number;
  to_at: number | null;
};

const UPDATE_COLUMNS = 'id, batch, node, from_version, to_version, started_at, step, ended_at, result, note';

/** A time column takes epoch milliseconds only: SQLite's INTEGER affinity would keep text as text, which sorts above every number. */
function assertEpochMs(what: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a whole number of epoch milliseconds, got ${JSON.stringify(value)}.`);
  }
}

/** A `limit` SQLite will take: whole, at least 0, inside its integer range. `NaN` is 0. */
function clampLimit(limit: number): number {
  if (Number.isNaN(limit)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(limit)));
}

export const cerberusUpdatesDb = {
  /**
   * Appends an update that has been queued and not yet offered. Throws on a duplicate id, an id that
   * is not a non-empty string, and a `started_at` that is not whole milliseconds.
   */
  insert(update: CerberusUpdateInsert): void {
    if (typeof update.id !== 'string' || update.id === '') {
      throw new TypeError(`An update needs an id string, got ${JSON.stringify(update.id)}.`);
    }
    assertEpochMs(`Update ${update.id}'s started_at`, update.started_at);
    getCerberusConnection()
      .prepare(
        `INSERT INTO updates (id, batch, node, from_version, to_version, started_at, step)
         VALUES (@id, @batch, @node, @from_version, @to_version, @started_at, @step)`
      )
      .run({
        id: update.id,
        batch: update.batch,
        node: update.node,
        from_version: update.from_version,
        to_version: update.to_version,
        started_at: update.started_at,
        step: update.step,
      });
  },

  /** One update, or `null` when none carries the id. */
  get(id: string): CerberusUpdateRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${UPDATE_COLUMNS} FROM updates WHERE id = ?`)
      .get(id) as CerberusUpdateRow | undefined;
    return row ?? null;
  },

  /** The updates of a batch in the order they were inserted — the order their nodes were picked, which is the order they run. */
  forBatch(batch: string): CerberusUpdateRow[] {
    return getCerberusConnection()
      .prepare(`SELECT ${UPDATE_COLUMNS} FROM updates WHERE batch = ? ORDER BY started_at, rowid`)
      .all(batch) as CerberusUpdateRow[];
  },

  /** Every update that has not ended, oldest first — a batch is running while this is not empty. */
  running(): CerberusUpdateRow[] {
    return getCerberusConnection()
      .prepare(`SELECT ${UPDATE_COLUMNS} FROM updates WHERE ended_at IS NULL ORDER BY started_at, rowid`)
      .all() as CerberusUpdateRow[];
  },

  /**
   * The node of `running()[0]` — the update the driver treats as the batch's ACTIVE one (the one whose
   * offer is out) — or `null` when no update is live. The same order as `running`, one row read. A node
   * is "updating" from the moment its update is the active one until it ends; the update behind it in
   * its batch is not, until its turn. Read from the store, never from the driver's memory, so the two
   * processes of a handover agree on which node is closed to new work.
   */
  activeNode(): string | null {
    const row = getCerberusConnection()
      .prepare('SELECT node FROM updates WHERE ended_at IS NULL ORDER BY started_at, rowid LIMIT 1')
      .get() as { node: string } | undefined;
    return row?.node ?? null;
  },

  /**
   * Records the update's latest step. Answers whether this call did: an update that already ended is
   * left as it was, so a progress frame that crossed the end moves nothing.
   */
  setStep(id: string, step: string): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE updates SET step = ? WHERE id = ? AND ended_at IS NULL')
      .run(step, id);
    return result.changes > 0;
  },

  /**
   * Ends an update at `endedAt` with its outcome. Answers whether this call ended it: the first end
   * wins, and an update already ended — a hello that crossed the silence timeout — is left as it
   * was. `note` is NULL when there is none. A `result` outside the three outcomes (NULL included)
   * throws.
   *
   * An `endedAt` earlier than the update's start or than its newest step (a clock stepped back) is
   * stored as that later moment, so no span ends before it begins. It is clamped, not refused: a
   * throw would leave the update live, and a live update blocks every later batch.
   */
  end(id: string, result: CerberusUpdateResult, endedAt: number, note: string | null): boolean {
    if (!UPDATE_RESULTS.includes(result)) {
      throw new RangeError(`Update ${id} cannot end as ${JSON.stringify(result)}; it is one of ${UPDATE_RESULTS.join(', ')}.`);
    }
    assertEpochMs(`Update ${id}'s ended_at`, endedAt);
    const outcome = getCerberusConnection()
      .prepare(
        `UPDATE updates
            SET result = @result, note = @note,
                ended_at = MAX(@endedAt, started_at,
                               COALESCE((SELECT MAX(at) FROM update_steps WHERE update_id = @id), started_at))
          WHERE id = @id AND ended_at IS NULL`
      )
      .run({ id, result, endedAt, note });
    return outcome.changes > 0;
  },

  /**
   * THE ONE AMENDMENT of an ended update: an update that ended `updated` at `since` or later turns
   * `rolled_back`, with `note` (the reason a live rollback files too), its `step` word `failed` (what a
   * live rollback leaves) and a closing `failed` step `text` stamped `at`. It answers whether this call did it. Center ends an update `updated` on the
   * hello that names the new release, while the launcher's probation runs on until the release has
   * answered its welcome; a release that dies in between is taken back, and the old release's hello
   * says so to an update that is already over.
   *
   * Both writes are ONE transaction (nested into the caller's, when there is one): the `result`
   * statement is guarded `result = 'updated' AND ended_at >= @since` — an update that was never
   * `updated`, one `updated` longer ago, one already `rolled_back` (a resent hello) or a failure is
   * left as it was — and the step is written only when that statement changed the row. The step is
   * inserted here, not through `insertStep`, because that one keeps its `ended_at IS NULL` guard and
   * would refuse it: no other path writes a step under an ended update, and no other path reopens one.
   * `ended_at` stays what it was, so the activity feed and the pause window keep the moment center
   * heard the new release; the step carries the later moment the rollback was heard.
   */
  rolledBackAfterUpdated(id: string, at: number, text: string, since: number, note: string): boolean {
    assertEpochMs(`Update ${id}'s rollback time`, at);
    assertEpochMs(`Update ${id}'s rollback window start`, since);
    const connection = getCerberusConnection();
    return connection.transaction(() => {
      const amended = connection
        .prepare(`UPDATE updates SET result = 'rolled_back', step = 'failed', note = @note WHERE id = @id AND result = 'updated' AND ended_at >= @since`)
        .run({ id, note, since });
      if (amended.changes === 0) return false;
      // DO NOTHING on the key (`update_id, at, step`): a step of this very millisecond is already there,
      // and the verdict above must not be undone for a line that says it twice.
      connection
        .prepare(`INSERT INTO update_steps (update_id, at, step, text) VALUES (@id, @at, 'failed', @text) ON CONFLICT (update_id, at, step) DO NOTHING`)
        .run({ id, at, text });
      return true;
    })();
  },

  /**
   * Appends one progress step of a live update. Answers `true` when this call wrote it and `false`
   * ONLY when nothing was written for a reason that is no fault: `(update_id, at, step)` already
   * holds a row (left as it was), or the update has already ended (a frame that crossed the end). A
   * malformed row — `at` not a whole number, a NULL `step` or `text` — and an `updateId` that
   * `updates` does not hold THROW.
   */
  insertStep(updateId: string, at: number, step: string, text: string): boolean {
    assertEpochMs(`Update ${updateId}'s step '${step}' time`, at);
    const connection = getCerberusConnection();
    // Updates are never deleted, so this read cannot go stale before the insert below.
    if (!connection.prepare('SELECT 1 FROM updates WHERE id = ?').get(updateId)) {
      throw new RangeError(`Update ${updateId} is not in updates: a step filed under it would be read by nothing.`);
    }
    // The SELECT carries the live-update guard inside the one statement, so an end cannot slip between
    // a check and the write. Its WHERE also keeps SQLite from reading `ON CONFLICT` as a join's `ON`.
    return (
      connection
        .prepare(
          `INSERT INTO update_steps (update_id, at, step, text)
           SELECT @updateId, @at, @step, @text FROM updates WHERE id = @updateId AND ended_at IS NULL
           ON CONFLICT (update_id, at, step) DO NOTHING`
        )
        .run({ updateId, at, step, text }).changes > 0
    );
  },

  /** Every step of an update, oldest first; steps stamped in one millisecond keep the order they arrived. */
  steps(updateId: string): CerberusUpdateStepRow[] {
    return getCerberusConnection()
      .prepare('SELECT at, step, text FROM update_steps WHERE update_id = ? ORDER BY at, rowid')
      .all(updateId) as CerberusUpdateStepRow[];
  },

  /**
   * The restart spans of a node that touch `[from, to)`, oldest first: each update's span runs from
   * its first `restarting` step to its end, and `to_at` is NULL while the update is live. An update
   * that never reached `restarting` has no span. A span counts when it begins before `to` and ends
   * after `from` (a live one never ends); it is reported whole, not cut to the window.
   */
  pauseWindows(node: string, from: number, to: number): CerberusPauseWindowRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT u.id AS update_id, MIN(s.at) AS from_at, u.ended_at AS to_at
           FROM updates u
           JOIN update_steps s ON s.update_id = u.id AND s.step = 'restarting'
          WHERE u.node = @node
          GROUP BY u.id
         HAVING from_at < @windowTo AND (to_at IS NULL OR to_at > @windowFrom)
          ORDER BY from_at, u.id`
      )
      .all({ node, windowFrom: from, windowTo: to }) as CerberusPauseWindowRow[];
  },

  /**
   * The updates written before `before`, newest activity first — what the activity feed turns into
   * "update started", "updated", "rolled back" and "update failed" events. An update is ranked by the
   * newest of its own moments that falls before `before`: its end when that is already behind
   * `before`, else its start. The service keeps the events that have actually happened.
   *
   * The answer is at least `limit` rows when that many exist, and MORE when `limit` cuts inside a
   * group ranked at one instant — a batch writes every node's row in one millisecond. The whole group
   * comes back, so a caller's cursor of `before = <last row's moment>` never skips a row left behind
   * at that instant. A row does not carry its moment: the caller works it out as `ended_at` when that
   * is below `before`, else `started_at`. `end` never stores an `ended_at` earlier than `started_at`,
   * so a row's moment is never before its start.
   */
  recent(before: number, limit: number): CerberusUpdateRow[] {
    return getCerberusConnection()
      .prepare(
        `WITH ranked AS (
           SELECT ${UPDATE_COLUMNS},
                  CASE WHEN COALESCE(ended_at, started_at) < @before
                       THEN COALESCE(ended_at, started_at) ELSE started_at END AS moment
             FROM updates WHERE started_at < @before
         )
         SELECT ${UPDATE_COLUMNS} FROM ranked
          WHERE moment >= (SELECT MIN(moment) FROM (SELECT moment FROM ranked ORDER BY moment DESC LIMIT @limit))
          ORDER BY moment DESC, id`
      )
      .all({ before, limit: clampLimit(limit) }) as CerberusUpdateRow[];
  },
};
