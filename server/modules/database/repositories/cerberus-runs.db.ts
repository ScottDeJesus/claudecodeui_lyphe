import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';
import {
  historyConditions,
  type CerberusHistoryFilter,
} from '@/modules/database/repositories/cerberus-history-filter.js';

/**
 * `runs` and `run_output`, as row-level statements — every attempt to run a fix, and the lines it
 * printed.
 *
 * A RUN is written when Cerberus asks the warden (`insert`, `requested_at`) and moves forward at
 * most twice: the warden's `run.accepted` (`markStarted`) and its end (`markEnded`). Each of those
 * is one `UPDATE` that only fires while the run has not already ended, and its `changes` is the
 * verdict — a resent frame cannot move a finished run. A run is ACTIVE from `insert` until
 * `markEnded`; a refusal is an end like any other (`result = 'refused'`, the reason in `note`, no
 * `started_at`). Runs are kept forever.
 *
 * OUTPUT is one row per line, `(run, n)` its key, `t` the line's offset in seconds from the run's
 * start. `insertOutput` is `INSERT OR IGNORE`, so a batch the warden resends lands once. That same
 * `OR IGNORE` would also swallow a malformed line (a NULL column, a bad `stream`) and answer
 * exactly as it does for a resend — the hazard `cerberus-results.db.ts` documents — so a line is
 * checked here first and a bad one THROWS. So is the run the lines are filed under: output dated by
 * no `runs` row is reachable by no prune and would be kept for ever, so an id that is not a string,
 * or that `runs` does not hold, THROWS too (the runs service checks the run belongs to the link's
 * node before it gets here — a statement-only repository cannot). Output is kept 90 days
 * (`pruneOutputBefore`).
 *
 * Rows are exactly as the tables store them: snake_case, times in epoch milliseconds.
 *
 * Every `limit` below is clamped to a whole number of at least 0 before it reaches SQL: SQLite reads
 * `LIMIT -1` as "no limit", so an unclamped negative would dump the table. A caller owns the upper bound.
 *
 * Consumers: `server/modules/cerberus/` — the runs service (`insert`, `get`, the two marks, the
 * output statements, `activeForCheck` for its 409, `activeForNode` to reconcile a hello), the
 * auto-run rule (`autoRunsSince`, `activeForCheck`), the read model (`activeForNode`,
 * `activeForCheck` for a need's going run, `latestForCheck`, `recent` for What happened, `output` for a run's lines, `lastLines` for the line a
 * strip quotes, `statsFor` for an entry's counts, `latestForDiagnoses` for the run of a diagnosis's
 * one-off), the diagnosis agent (`requestedSince` for its `history_read`) and the daily prune
 * (`pruneOutputBefore`). Reach it through `@/modules/database/index.js`. Every statement runs on
 * the caller's connection and opens no transaction of its own.
 */

/** How a run ended. `refused` is the warden declining the command; the other three are the child's end. */
export type CerberusRunResult = 'ok' | 'failed' | 'refused' | 'timed_out';

/** One `runs` row, exactly as the table stores it. */
export type CerberusRunRow = {
  id: string;
  /** The catalog entry it ran; NULL for a one-off lifted from a diagnosis. */
  entry: string | null;
  /** The diagnosis a one-off came from; NULL for a catalog entry. */
  diagnosis: string | null;
  node: string;
  check_key: string;
  /** `auto` when Cerberus started it by its own rule, `you` when a person pressed it. */
  by: 'auto' | 'you';
  /** The exact command sent — what the warden compared against its acked catalog. */
  cmd: string;
  /** The catalog version `run.start` carried. */
  catalog_version: number;
  /** When Cerberus asked, on the center's clock. */
  requested_at: number;
  /** When the warden accepted, on center's clock; NULL until it did, and for ever after a refusal. */
  started_at: number | null;
  /** On center's clock; NULL while the run is active. */
  ended_at: number | null;
  /** NULL while the run is active. */
  result: CerberusRunResult | null;
  /** The child's exit code; NULL when it did not exit with one (timed out, refused). */
  exit: number | null;
  /** The reason, for a refusal; NULL otherwise. */
  note: string | null;
};

/** The columns `insert` writes. The rest are the warden's to fill, through the two marks. */
export type CerberusRunInsert = Omit<CerberusRunRow, 'started_at' | 'ended_at' | 'result' | 'exit' | 'note'>;

/** One entry's ended runs, counted: how many ended, how many of those ended `ok`, and when the newest ended. */
export type CerberusRunStatsRow = {
  entry: string;
  runs: number;
  ok: number;
  last_run_at: number;
};

/** One line of a run's output: its number in the run, its offset in seconds, the stream, the text. */
export type CerberusRunLineRow = {
  n: number;
  t: number;
  stream: 'out' | 'err';
  line: string;
};

// `by` is a keyword; SQLite tolerates it as a column name, and quoting keeps every statement that
// names it unambiguous.
const RUN_COLUMNS =
  'id, entry, diagnosis, node, check_key, "by", cmd, catalog_version, requested_at, started_at, ended_at, result, exit, note';

/** Refuses a line the table would drop under `OR IGNORE` — see the file header. */
function assertWritableLine(run: string, line: CerberusRunLineRow): void {
  const wellFormed =
    Number.isSafeInteger(line.n) &&
    line.n >= 0 &&
    Number.isFinite(line.t) &&
    (line.stream === 'out' || line.stream === 'err') &&
    typeof line.line === 'string';
  if (!wellFormed) {
    throw new RangeError(`Output line ${String(line.n)} of run ${run} is malformed: ${JSON.stringify(line)}.`);
  }
}

export const cerberusRunsDb = {
  /** Appends a run that has been asked for and not yet answered. Throws on a duplicate id. */
  insert(run: CerberusRunInsert): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO runs (id, entry, diagnosis, node, check_key, "by", cmd, catalog_version, requested_at)
         VALUES (@id, @entry, @diagnosis, @node, @check_key, @by, @cmd, @catalog_version, @requested_at)`
      )
      .run(run);
  },

  /** One run, or `null` when none carries the id. */
  get(id: string): CerberusRunRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`)
      .get(id) as CerberusRunRow | undefined;
    return row ?? null;
  },

  /**
   * Records the warden's `run.accepted` at `at`. Answers whether this call did: a run that already
   * started or already ended is left as it was.
   */
  markStarted(id: string, at: number): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE runs SET started_at = ? WHERE id = ? AND started_at IS NULL AND ended_at IS NULL')
      .run(at, id);
    return result.changes > 0;
  },

  /**
   * Ends a run at `endedAt` with its outcome. Answers whether this call ended it: the first end
   * wins, and a run already ended — a resent `run.end`, a refusal that crossed an end — is left as
   * it was. `exit` and `note` are NULL when there is none.
   */
  markEnded(id: string, result: CerberusRunResult, exit: number | null, endedAt: number, note: string | null): boolean {
    const outcome = getCerberusConnection()
      .prepare(
        `UPDATE runs SET result = @result, exit = @exit, ended_at = @endedAt, note = @note
          WHERE id = @id AND ended_at IS NULL`
      )
      .run({ id, result, exit, endedAt, note });
    return outcome.changes > 0;
  },

  /**
   * Appends a batch of a run's lines in ONE statement, so a batch lands whole or not at all.
   * Answers how many lines this call wrote — fewer than `lines.length` when some were a resend.
   * A malformed line, a `run` that is not a string, and a `run` that `runs` does not hold all throw
   * before anything is written.
   */
  insertOutput(run: string, lines: CerberusRunLineRow[]): number {
    if (typeof run !== 'string' || run === '') {
      throw new TypeError(`Run output needs a run id string, got ${JSON.stringify(run)}.`);
    }
    if (lines.length === 0) return 0;
    for (const line of lines) assertWritableLine(run, line);

    const connection = getCerberusConnection();
    // Runs are never deleted, so this read cannot go stale before the insert below.
    if (!connection.prepare('SELECT 1 FROM runs WHERE id = ?').get(run)) {
      throw new RangeError(`Run ${run} is not in runs: output filed under it could never be pruned.`);
    }

    return connection
      .prepare(
        `INSERT OR IGNORE INTO run_output (run, n, t, stream, line)
         SELECT @run, json_extract(value, '$.n'), json_extract(value, '$.t'),
                json_extract(value, '$.stream'), json_extract(value, '$.line')
           FROM json_each(@lines)`
      )
      .run({ run, lines: JSON.stringify(lines) }).changes;
  },

  /** Every line of a run, in order. */
  output(run: string): CerberusRunLineRow[] {
    return getCerberusConnection()
      .prepare('SELECT n, t, stream, line FROM run_output WHERE run = ? ORDER BY n')
      .all(run) as CerberusRunLineRow[];
  },

  /**
   * The newest line of each of `runs` that has any — its number and its text — keyed by run id. A run
   * with no output has no entry. One statement however many runs are asked for.
   */
  lastLines(runs: string[]): Map<string, { n: number; line: string }> {
    if (runs.length === 0) return new Map();
    const rows = getCerberusConnection()
      .prepare(
        `SELECT o.run AS run, o.n AS n, o.line AS line
           FROM run_output o
           JOIN (SELECT run, MAX(n) AS n FROM run_output
                  WHERE run IN (SELECT value FROM json_each(@runs)) GROUP BY run) newest
             ON newest.run = o.run AND newest.n = o.n`
      )
      .all({ runs: JSON.stringify(runs) }) as { run: string; n: number; line: string }[];
    return new Map(rows.map((row) => [row.run, { n: row.n, line: row.line }]));
  },

  /**
   * How many times Cerberus has run an entry on its own since `since` (epoch ms, `requested_at >= since`) —
   * the number an entry's limit is judged against. Every run asked for counts, whatever came of it:
   * a refused or failed run used up its slot, so a fix that keeps failing cannot loop.
   */
  autoRunsSince(entry: string, since: number): number {
    const row = getCerberusConnection()
      .prepare(`SELECT COUNT(*) AS runs FROM runs WHERE entry = ? AND "by" = 'auto' AND requested_at >= ?`)
      .get(entry, since) as { runs: number };
    return row.runs;
  },

  /**
   * The ended runs of each of `entries`, counted — a refusal is an end and counts as a run that did
   * not succeed. An entry with no ended run has no row. One statement however many entries are asked
   * for; the ids travel as one JSON text so the statement never grows with them.
   */
  statsFor(entries: string[]): CerberusRunStatsRow[] {
    if (entries.length === 0) return [];
    return getCerberusConnection()
      .prepare(
        `SELECT entry, COUNT(*) AS runs, SUM(result = 'ok') AS ok, MAX(ended_at) AS last_run_at
           FROM runs
          WHERE ended_at IS NOT NULL AND entry IN (SELECT value FROM json_each(@entries))
          GROUP BY entry`
      )
      .all({ entries: JSON.stringify(entries) }) as CerberusRunStatsRow[];
  },

  /** The run of a check that has not ended — at most one is ever asked for — or `null`. */
  activeForCheck(node: string, key: string): CerberusRunRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM runs
          WHERE node = ? AND check_key = ? AND ended_at IS NULL
          ORDER BY requested_at DESC, id LIMIT 1`
      )
      .get(node, key) as CerberusRunRow | undefined;
    return row ?? null;
  },

  /** Every run of a node that has not ended, oldest first — what a hello's `active.runs` is held against. */
  activeForNode(node: string): CerberusRunRow[] {
    return getCerberusConnection()
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE node = ? AND ended_at IS NULL ORDER BY requested_at, id`)
      .all(node) as CerberusRunRow[];
  },

  /** A check's newest run asked for at or after `since`, ended or not, or `null`. */
  latestForCheck(node: string, key: string, since: number): CerberusRunRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM runs
          WHERE node = ? AND check_key = ? AND requested_at >= ?
          ORDER BY requested_at DESC, id LIMIT 1`
      )
      .get(node, key, since) as CerberusRunRow | undefined;
    return row ?? null;
  },

  /**
   * The newest run of each of `diagnoses` — the run of its one-off — keyed by diagnosis id; a
   * diagnosis nobody has run has no entry. One statement however many are asked for.
   */
  latestForDiagnoses(diagnoses: string[]): Map<string, CerberusRunRow> {
    if (diagnoses.length === 0) return new Map();
    const rows = getCerberusConnection()
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM runs r
          WHERE r.diagnosis IN (SELECT value FROM json_each(@diagnoses))
            AND r.id = (SELECT id FROM runs WHERE diagnosis = r.diagnosis ORDER BY requested_at DESC, id LIMIT 1)`
      )
      .all({ diagnoses: JSON.stringify(diagnoses) }) as CerberusRunRow[];
    return new Map(rows.flatMap((row) => (row.diagnosis === null ? [] : [[row.diagnosis, row] as const])));
  },

  /**
   * Runs asked for at or after `since`, newest first, at most `limit` — across every node, or one
   * node's (`node`), or one check key's (`check`). A diagnosis's `history_read` is the caller. The
   * WHERE is assembled from fixed fragments with every value bound.
   */
  requestedSince(filter: CerberusHistoryFilter, limit: number): CerberusRunRow[] {
    const { conditions, params } = historyConditions(filter, 'requested_at', limit);
    return getCerberusConnection()
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM runs
          WHERE ${conditions.join(' AND ')}
          ORDER BY requested_at DESC, id LIMIT @limit`
      )
      .all(params) as CerberusRunRow[];
  },

  /**
   * The runs asked for before `before`, newest activity first — what the activity feed turns into
   * "started" and "ended" events. A run is ranked by the newest of its own moments that falls
   * before `before`: its end when that is already behind `before`, else its request. The service
   * keeps the events that have actually happened.
   *
   * The answer is at least `limit` rows when that many exist, and MORE when `limit` cuts inside a
   * group ranked at one instant — a health document that flips many checks at once starts a run for
   * each in one millisecond. The whole group comes back, so a caller's cursor of
   * `before = <last row's moment>` never skips a row left behind at that instant. A row does not
   * carry its moment: the caller works it out as `ended_at` when that is below `before`, else
   * `requested_at` (a cursor of `requested_at` alone would lose end events). `ended_at` is read as
   * not earlier than `requested_at` — stamp it on the center's clock, since a warden clock behind
   * the center's by more than the run lasted would drop the run out of the window.
   */
  recent(before: number, limit: number): CerberusRunRow[] {
    return getCerberusConnection()
      .prepare(
        `WITH ranked AS (
           SELECT ${RUN_COLUMNS},
                  CASE WHEN COALESCE(ended_at, requested_at) < @before
                       THEN COALESCE(ended_at, requested_at) ELSE requested_at END AS moment
             FROM runs WHERE requested_at < @before
         )
         SELECT ${RUN_COLUMNS} FROM ranked
          WHERE moment >= (SELECT MIN(moment) FROM (SELECT moment FROM ranked ORDER BY moment DESC LIMIT @limit))
          ORDER BY moment DESC, id`
      )
      .all({ before, limit: Math.max(0, Math.trunc(limit)) }) as CerberusRunRow[];
  },

  /**
   * Deletes the output of every run asked for before `at` — the run rows stay, for ever; only their
   * lines are forgotten. Answers how many lines went. One statement, so the write lock is held for a
   * `DELETE`, not for a sweep.
   */
  pruneOutputBefore(at: number): number {
    return getCerberusConnection()
      .prepare('DELETE FROM run_output WHERE run IN (SELECT id FROM runs WHERE requested_at < ?)')
      .run(at).changes;
  },
};
