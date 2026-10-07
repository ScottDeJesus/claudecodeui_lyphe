import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';
import {
  historyConditions,
  type CerberusHistoryFilter,
} from '@/modules/database/repositories/cerberus-history-filter.js';

/**
 * `results`, as row-level statements — the append-only history of the Cerberus store.
 *
 * Only results are stored. "No result", "not enabled", "muted" and "paused" are worked out when a
 * screen reads and never written, and a row, once written, is never overwritten: `insert` is
 * `ON CONFLICT(node, check_key, at) DO NOTHING`, so a resent frame cannot change history. It is
 * `DO NOTHING` and not `INSERT OR IGNORE` on purpose: `OR IGNORE` would also swallow a malformed
 * row (a bad `kind`, a NULL key) and answer exactly as it does for a resend, so a lost row would be
 * acked as a duplicate. Here a duplicate is the ONE quiet `false`; every other refusal throws.
 * The one thing ever deleted is a `keepalive` row, by `pruneKeepalivesBefore`.
 *
 * A row is a `change` (the first sight of a check, or its status or document status moved, or a lapse
 * in reporting ended — a VALUE moving under an unchanged status is no change) or a `keepalive` (the
 * result whole, its newest value and data, written when nothing changed for five minutes). Rows
 * stored before 2026-10-07 also hold a `change` for every value move; none of them is a status move,
 * so `transitions` and `transitionsSince` skip them, while `recentChanges` (a check's detail and the
 * diagnosis prompt) still lists them until newer changes push them out. Every row carries `prev_status` — what the check last stored before it, `not_enabled`
 * for a stored NULL, NULL only for the check's first row — which is what makes `transitions` and a
 * check's `since` plain SQL rather than a replay.
 *
 * Rows are exactly as the table stores them: snake_case, times in epoch milliseconds, `data` as the
 * JSON text the caller wrote.
 *
 * Every `limit` below is clamped to a whole number of at least 0 before it reaches SQL: SQLite reads
 * `LIMIT -1` as "no limit", so an unclamped negative would dump the table. A caller owns the upper bound.
 *
 * Consumers: `server/modules/cerberus/` — ingest (`insert`, and `latestPerCheck` to seed its memory at
 * start and to re-read one node's at its hello), the read model (`rowsInWindow` for cells and
 * lookups, `recentChanges` for a check's detail, `transitions` for What happened), the diagnosis
 * agent (`recentChanges` for its prompt, `transitionsSince` for its `history_read`) and the daily
 * prune (`pruneKeepalivesBefore`). Reach it through `@/modules/database/index.js`. Every statement
 * runs on the caller's connection and opens no transaction of its own — ingest's "one transaction
 * per frame" is its own.
 *
 * Two reads are served by PARTIAL indexes (`cerberus-schema.ts`, step 4), which SQLite uses only when
 * the query carries the index's own terms: `transitions` spells `ix_results_moves`'s WHERE out and
 * `pruneKeepalivesBefore` `ix_results_keepalives`'s. Change either side and the read scans the table.
 */

/** One `results` row, exactly as the table stores it. */
export type CerberusStoredResultRow = {
  node: string;
  check_key: string;
  /** When the result was produced, on the reporter's clock. */
  at: number;
  /** The probe that produced it; for a component, the `health_doc` probe. */
  source: string | null;
  /** The warden's sequence number of the frame; NULL for center's own self-checks. */
  seq: number | null;
  fetched_at: number | null;
  /** `ok`, `warn`, `failing`, `denied`; NULL is "not enabled". */
  status: string | null;
  /** A health document's own `green`, `yellow`, `red`, `muted`; NULL for any other probe. */
  doc_status: string | null;
  value: string | null;
  /** The probe's extra payload as JSON text. */
  data: string | null;
  took_ms: number | null;
  /** The reporter's own previous `at` for this check; NULL when it has none (a lapse before this row). */
  prev_at: number | null;
  /** The status of the check's last stored row, `not_enabled` for a NULL one; NULL for the first row. */
  prev_status: string | null;
  kind: 'change' | 'keepalive';
};

/** A check's last stored row with the moment it took its current status. */
export type CerberusLatestResultRow = CerberusStoredResultRow & {
  /**
   * The `at` of the check's newest row whose `prev_status` differs from its status — or of its first
   * row, when none does. Keep-alives never move it: they repeat the status they follow.
   */
  since: number;
};

/**
 * A status change of one check: the slice of a row What happened needs. Raw columns: `prev_status`
 * spells "not enabled" as `not_enabled`, but `status` comes back as SQL NULL for it — the reader
 * must treat the two as one.
 */
export type CerberusTransitionRow = Pick<
  CerberusStoredResultRow,
  'node' | 'check_key' | 'at' | 'status' | 'prev_status' | 'value'
>;

const RESULT_COLUMN_NAMES = [
  'node',
  'check_key',
  'at',
  'source',
  'seq',
  'fetched_at',
  'status',
  'doc_status',
  'value',
  'data',
  'took_ms',
  'prev_at',
  'prev_status',
  'kind',
] as const;

/** Every column of a result, optionally qualified by a table alias — one spelling for every read. */
function resultColumns(alias?: string): string {
  return RESULT_COLUMN_NAMES.map((column) => (alias ? `${alias}.${column}` : column)).join(', ');
}

/**
 * The condition "this row's status differs from the status stored before it", optionally
 * qualified by a table alias. A stored NULL status reads as `not_enabled`, the spelling
 * `prev_status` uses, so a check that stays "not enabled" is not a change. Evaluates to NULL
 * (not true) for a first row, whose `prev_status` is NULL — callers say what they want of that.
 */
function statusDiffers(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}prev_status <> COALESCE(${prefix}status, 'not_enabled')`;
}

export const cerberusResultsDb = {
  /**
   * Appends a result. Answers `true` when this call wrote the row and `false` in exactly one case: a
   * row already sat under `(node, check_key, at)`, and it stays as it was. Anything else — a NULL
   * key, a `kind` outside `change`/`keepalive`, an `at` that is not a whole number — THROWS, so the
   * caller never acks a frame whose row was lost.
   */
  insert(row: CerberusStoredResultRow): boolean {
    // SQLite keeps whatever type it is handed in an INTEGER column, and TEXT sorts above every
    // number: one row with a string or fractional `at` would be the check's "latest" for ever, in a
    // table that is never rewritten. The column's own affinity cannot refuse it, so this does.
    if (!Number.isSafeInteger(row.at)) {
      throw new RangeError(
        `Result of ${row.node}/${row.check_key} needs an integer \`at\` in epoch ms, got ${String(row.at)}.`
      );
    }

    const result = getCerberusConnection()
      .prepare(
        `INSERT INTO results (${resultColumns()})
         VALUES (@node, @check_key, @at, @source, @seq, @fetched_at, @status, @doc_status,
                 @value, @data, @took_ms, @prev_at, @prev_status, @kind)
         ON CONFLICT(node, check_key, at) DO NOTHING`
      )
      .run(row);
    return result.changes > 0;
  },

  /**
   * Each check's last stored row, with its `since`, for every `(node, check_key)` that has any row —
   * or, with `node`, for that node's checks alone (the same statement, its `k` limited to the node).
   * Read once at start to seed ingest's memory, and again for one node at each of its hellos to
   * re-read it (`ingest.reseedNode`). `since` walks the check's rows backwards from the newest and
   * stops at the first status change, so it reads only the keep-alives since then.
   */
  latestPerCheck(node?: string): CerberusLatestResultRow[] {
    // Without a node the statement has no `@node` at all, so each spelling is run with what it names.
    const checksOfScope = node === undefined ? 'results' : 'results WHERE node = @node';
    const statement = getCerberusConnection().prepare(
      `SELECT ${resultColumns('r')},
              COALESCE(
                (SELECT s.at FROM results s
                  WHERE s.node = r.node AND s.check_key = r.check_key
                    AND (s.prev_status IS NULL OR ${statusDiffers('s')})
                  ORDER BY s.at DESC LIMIT 1),
                (SELECT MIN(f.at) FROM results f WHERE f.node = r.node AND f.check_key = r.check_key)
              ) AS since
         FROM (SELECT DISTINCT node, check_key FROM ${checksOfScope}) k
         JOIN results r ON r.node = k.node AND r.check_key = k.check_key
          AND r.at = (SELECT MAX(m.at) FROM results m WHERE m.node = k.node AND m.check_key = k.check_key)
        ORDER BY r.node, r.check_key`
    );
    return (node === undefined ? statement.all() : statement.all({ node })) as CerberusLatestResultRow[];
  },

  /**
   * The rows a window of one node's checks is drawn from: for each of `keys`, every row with
   * `from <= at <= to`, PLUS the last row before `from` (what the check was saying as the window
   * opened) and the first row after `to` (whose `prev_at` shows whether reporting lapsed
   * before it). Grouped by key, oldest first; the caller tells the three apart by `at`.
   * `keys` travel as one JSON array parameter, so any number of them is one statement; a key named
   * twice is read once. An inverted window (`from > to`) is empty and answers `[]`.
   *
   * The two `CROSS JOIN`s are load-bearing: SQLite never reorders a CROSS JOIN, so `wanted` stays the
   * outer loop and `results` is entered through the primary key at `(node, check_key, at)`. Left a
   * plain JOIN, a store that has never been `ANALYZE`d (this one never is) lets the planner drive
   * from `results` on `node` alone and walk every row of the node — measured 200 ms a part on 466k
   * rows against 0.1 ms pinned.
   */
  rowsInWindow(node: string, keys: string[], from: number, to: number): CerberusStoredResultRow[] {
    if (keys.length === 0 || from > to) return [];
    return getCerberusConnection()
      .prepare(
        // DISTINCT: the two neighbour branches join `wanted`, so a repeated key would repeat its
        // neighbour rows once per repeat.
        `WITH wanted(wanted_key) AS (SELECT DISTINCT value FROM json_each(@keys))
         SELECT ${resultColumns()} FROM results
          WHERE node = @node AND check_key IN (SELECT wanted_key FROM wanted)
            AND at >= @from AND at <= @to
         UNION ALL
         SELECT ${resultColumns('r')} FROM wanted w
           CROSS JOIN results r ON r.node = @node AND r.check_key = w.wanted_key
            AND r.at = (SELECT MAX(b.at) FROM results b
                         WHERE b.node = @node AND b.check_key = w.wanted_key AND b.at < @from)
         UNION ALL
         SELECT ${resultColumns('r')} FROM wanted w
           CROSS JOIN results r ON r.node = @node AND r.check_key = w.wanted_key
            AND r.at = (SELECT MIN(a.at) FROM results a
                         WHERE a.node = @node AND a.check_key = w.wanted_key AND a.at > @to)
         ORDER BY check_key, at`
      )
      .all({ node, keys: JSON.stringify(keys), from, to }) as CerberusStoredResultRow[];
  },

  /**
   * A check's `change` rows with `since <= at <= until`, newest first, at most `limit`. `until`
   * defaults to no upper bound — what a read ending now means; a read ending at an earlier moment
   * (the sheet's `end`) passes it so the list stops where the strip does.
   */
  recentChanges(
    node: string,
    key: string,
    since: number,
    limit: number,
    until: number = Number.MAX_SAFE_INTEGER
  ): CerberusStoredResultRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${resultColumns()} FROM results
          WHERE node = ? AND check_key = ? AND kind = 'change' AND at >= ? AND at <= ?
          ORDER BY at DESC LIMIT ?`
      )
      .all(node, key, since, until, Math.max(0, Math.trunc(limit))) as CerberusStoredResultRow[];
  },

  /**
   * Status moves with `at >= since`, newest first, at most `limit` — across every node, or one node's
   * (`node`), or one check key's (`check`, on any node unless `node` narrows it). A move is a `change`
   * row whose status differs from the one stored before it, or a check's first row. A change of the
   * VALUE alone is not one: a check that says "last sweep failed 17.6h ago" moved its value every
   * half-minute, the rows stored before 2026-10-07 hold one each, and a window of those would never
   * reach the moment the check went red. A diagnosis's `history_read` is the one caller. The WHERE is
   * assembled from fixed fragments with every value bound, and a given `node` keeps the primary key's
   * leading column in play.
   */
  transitionsSince(filter: CerberusHistoryFilter, limit: number): CerberusStoredResultRow[] {
    const { conditions, params } = historyConditions(filter, 'at', limit);
    return getCerberusConnection()
      .prepare(
        `SELECT ${resultColumns()} FROM results
          WHERE kind = 'change' AND (prev_status IS NULL OR ${statusDiffers()}) AND ${conditions.join(' AND ')}
          ORDER BY at DESC, node, check_key LIMIT @limit`
      )
      .all(params) as CerberusStoredResultRow[];
  },

  /**
   * Status changes across every check with `at < before`, newest first: `change` rows that have a
   * `prev_status` and whose status differs from it. A check's first row is not a transition —
   * nothing preceded it.
   *
   * The answer is at least `limit` rows when that many exist, and MORE when `limit` cuts inside a
   * group of rows sharing one `at`: the whole group comes back. A health document stamps every
   * component with the same `at`, so a mass flip is exactly such a group, and the caller's cursor is
   * `before = <last row's at>` with a strict `<` — a row left behind at that `at` would be skipped
   * for ever. A page is therefore always a whole number of instants, and the next page starts clean.
   *
   * The CTE's first three terms are `ix_results_moves`'s own, word for word (`statusDiffers()` spells
   * the third): the index holds only status moves, so both reads of the CTE walk it by `at` instead of
   * scanning every row of `results`.
   */
  transitions(before: number, limit: number): CerberusTransitionRow[] {
    return getCerberusConnection()
      .prepare(
        `WITH status_changes AS (
           SELECT node, check_key, at, status, prev_status, value FROM results
            WHERE kind = 'change' AND prev_status IS NOT NULL AND ${statusDiffers()} AND at < @before
         )
         SELECT node, check_key, at, status, prev_status, value FROM status_changes
          WHERE at >= (SELECT MIN(at) FROM (SELECT at FROM status_changes ORDER BY at DESC LIMIT @limit))
          ORDER BY at DESC, node, check_key`
      )
      .all({ before, limit: Math.max(0, Math.trunc(limit)) }) as CerberusTransitionRow[];
  },

  /**
   * Deletes `keepalive` rows older than `at` — the only rows ever deleted. Answers how many went.
   * `kind = 'keepalive'` is `ix_results_keepalives`'s own term, so the delete walks that index.
   */
  pruneKeepalivesBefore(at: number): number {
    return getCerberusConnection()
      .prepare("DELETE FROM results WHERE kind = 'keepalive' AND at < @at")
      .run({ at }).changes;
  },
};
