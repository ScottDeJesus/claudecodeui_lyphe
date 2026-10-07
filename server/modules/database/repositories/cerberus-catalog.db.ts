import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `catalog`, `catalog_sets` and `catalog_changes`, as row-level statements — the fixes Cerberus may
 * offer or run, the versions of them each node was told, and the record of every edit.
 *
 * An ENTRY pairs one check with one fix (`cmd`, run byte for byte). It is written once and never
 * deleted: `retire` stamps `retired_at`, which hides it from every list below while `get` still
 * finds it, so a run's history keeps its name. `auto` is the only column a person flips after the
 * write, and `setAuto` refuses to switch a CAPPED entry on — a capped fix may never run on its own.
 *
 * A SET is the catalog as one node was handed it: one row per `(node, version)`, versions counting
 * up from 1 per node. `sent_at` is when the signed set last went down the link, `acked_at` when the
 * warden last answered `catalog.ack` for that version — the pair a node's "every set acked" is read
 * from. A set is never rewritten except for those two stamps.
 *
 * A CHANGE is one field of one entry moving (`added`, `auto`, …): append-only, one row per field.
 *
 * Rows are exactly as the tables store them: snake_case, times in epoch milliseconds, flags as 0/1,
 * a set's lists as the JSON text the caller wrote.
 *
 * Every `limit` below is clamped to a whole number of at least 0 before it reaches SQL: SQLite reads
 * `LIMIT -1` as "no limit", so an unclamped negative would dump the table. A caller owns the upper bound.
 *
 * Consumers: `server/modules/cerberus/` — the catalog service (`insert`, `get`, `setAuto`, `retire`,
 * the change and set statements), the auto-run rule (`forCheck`), the read model (`list`, `forCheck`,
 * `changes` for What happened). Reach it through `@/modules/database/index.js`. Every statement runs
 * on the caller's connection and opens no transaction of its own — the catalog service's "a toggle
 * and its change row land together" is its own.
 */

/** One `catalog` row, exactly as the table stores it. */
export type CerberusCatalogRow = {
  /** The name's slug, with `-2`, `-3` when taken. */
  id: string;
  node: string;
  check_key: string;
  name: string;
  /** The status that makes the check need this fix. */
  run_when: 'failing' | 'warn';
  /** The command, run byte for byte; the warden refuses any other. */
  cmd: string;
  /** Seconds the run may last. */
  timeout: number;
  /** 1 while the entry runs on its own, 0 while a person presses it. */
  auto: number;
  /** At most this many auto-runs in `limit_per` seconds. */
  limit_runs: number;
  limit_per: number;
  /** The reason this fix may never run on its own; NULL when it may. */
  capped: string | null;
  /** 1 when the check's probe runs again once the fix ends. */
  recheck: number;
  /** How the entry came to be, as JSON: written by a person, or lifted from a diagnosis. */
  origin: string;
  created_at: number;
  /** NULL while the entry is live; the moment it was retired. */
  retired_at: number | null;
};

/** One `catalog_sets` row: the catalog as `node` was told it at `version`. */
export type CerberusCatalogSetRow = {
  node: string;
  version: number;
  /** The wire's `entries` list as JSON text. */
  entries: string;
  /** The wire's `oneOffs` list as JSON text. */
  one_offs: string;
  /** When the signed set last went down the link; NULL until it has. */
  sent_at: number | null;
  /** When the warden last acked this version; NULL until it has. */
  acked_at: number | null;
};

/** One `catalog_changes` row: one field of one entry moving. */
export type CerberusCatalogChangeRow = {
  entry: string;
  at: number;
  /** The field that moved: `added`, `auto`, … */
  field: string;
  /** The field's text before; NULL for none (an entry's `added` row has no before). */
  from_value: string | null;
  to_value: string | null;
  /** Who did it: `you`, or the name of whatever else acts. */
  by: string;
};

// `by` is a keyword; SQLite tolerates it as a column name, and quoting keeps every statement that
// names it unambiguous.
const ENTRY_COLUMNS =
  'id, node, check_key, name, run_when, cmd, timeout, auto, limit_runs, limit_per, capped, recheck, origin, created_at, retired_at';
const SET_COLUMNS = 'node, version, entries, one_offs, sent_at, acked_at';
const CHANGE_COLUMNS = 'entry, at, field, from_value, to_value, "by"';

export const cerberusCatalogDb = {
  /**
   * Appends a live entry. Throws on a duplicate id — the caller picks a free one with `get`. A capped
   * entry is stored with `auto` 0 whatever `auto` says: the rule `setAuto` keeps, so no caller can
   * create a capped fix that runs on its own.
   */
  insert(entry: Omit<CerberusCatalogRow, 'retired_at'>): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO catalog (id, node, check_key, name, run_when, cmd, timeout, auto, limit_runs,
                              limit_per, capped, recheck, origin, created_at)
         VALUES (@id, @node, @check_key, @name, @run_when, @cmd, @timeout,
                 CASE WHEN @capped IS NULL THEN @auto ELSE 0 END, @limit_runs,
                 @limit_per, @capped, @recheck, @origin, @created_at)`
      )
      .run(entry);
  },

  /** One entry, retired or not, or `null` when none carries the id. */
  get(id: string): CerberusCatalogRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${ENTRY_COLUMNS} FROM catalog WHERE id = ?`)
      .get(id) as CerberusCatalogRow | undefined;
    return row ?? null;
  },

  /** Every live entry, oldest first — one node's, or every node's when `node` is left out. */
  list(node?: string): CerberusCatalogRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM catalog
          WHERE retired_at IS NULL AND (@node IS NULL OR node = @node)
          ORDER BY created_at, id`
      )
      .all({ node: node ?? null }) as CerberusCatalogRow[];
  },

  /** The live entries written for one check, oldest first. */
  forCheck(node: string, key: string): CerberusCatalogRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM catalog
          WHERE node = ? AND check_key = ? AND retired_at IS NULL
          ORDER BY created_at, id`
      )
      .all(node, key) as CerberusCatalogRow[];
  },

  /**
   * Switches a live entry's auto-run on or off. Answers whether THIS call moved it: `false` when the
   * entry is unknown, retired, already in that state, or — for `on` — capped. One statement carrying
   * every condition, so a toggle cannot slip past a cap between a read and a write; the caller reads
   * the entry first to tell those refusals apart, and writes a change row only on `true`.
   */
  setAuto(id: string, on: boolean): boolean {
    const result = getCerberusConnection()
      .prepare(
        `UPDATE catalog SET auto = @on
          WHERE id = @id AND retired_at IS NULL AND auto <> @on AND (@on = 0 OR capped IS NULL)`
      )
      .run({ id, on: on ? 1 : 0 });
    return result.changes > 0;
  },

  /** Retires a live entry at `at`. Answers whether this call did: an unknown or retired one is left as it was. */
  retire(id: string, at: number): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE catalog SET retired_at = ? WHERE id = ? AND retired_at IS NULL')
      .run(at, id);
    return result.changes > 0;
  },

  /** Appends one field's change. Throws on a repeat of `(entry, at, field)`. */
  insertChange(change: CerberusCatalogChangeRow): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO catalog_changes (${CHANGE_COLUMNS})
         VALUES (@entry, @at, @field, @from_value, @to_value, @by)`
      )
      .run(change);
  },

  /**
   * Changes with `at < before`, newest first — what the activity feed turns into "Added" and
   * "Auto-run on/off". The answer is at least `limit` rows when that many exist, and MORE when
   * `limit` cuts inside a group sharing one `at` (one edit writes a row per field at one instant):
   * the whole group comes back, so a caller's cursor of `before = <last row's at>` never skips a
   * row left behind at that instant.
   */
  changes(before: number, limit: number): CerberusCatalogChangeRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${CHANGE_COLUMNS} FROM catalog_changes
          WHERE at < @before
            AND at >= (SELECT MIN(at) FROM (SELECT at FROM catalog_changes
                                             WHERE at < @before ORDER BY at DESC LIMIT @limit))
          ORDER BY at DESC, entry, field`
      )
      .all({ before, limit: Math.max(0, Math.trunc(limit)) }) as CerberusCatalogChangeRow[];
  },

  /** The node's newest set, whether or not it was sent or acked, or `null` when it has none. */
  latestSet(node: string): CerberusCatalogSetRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${SET_COLUMNS} FROM catalog_sets WHERE node = ? ORDER BY version DESC LIMIT 1`)
      .get(node) as CerberusCatalogSetRow | undefined;
    return row ?? null;
  },

  /**
   * The node's newest set its warden has acked, or `null` — the version a `run.start` is verified
   * against, which trails `latestSet` while a freshly published set is still in flight.
   */
  ackedSet(node: string): CerberusCatalogSetRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${SET_COLUMNS} FROM catalog_sets
          WHERE node = ? AND acked_at IS NOT NULL ORDER BY version DESC LIMIT 1`
      )
      .get(node) as CerberusCatalogSetRow | undefined;
    return row ?? null;
  },

  /**
   * Appends a node's next set, unsent and unacked, and answers the version it took: the node's
   * highest plus one, or 1 for a node with none. The number is chosen inside the one `INSERT`, so
   * two writers never take the same version; the loser of a race would still fail on the primary key
   * rather than overwrite. `entries` and `oneOffs` are the wire's two lists as JSON text.
   */
  insertSet(node: string, entries: string, oneOffs: string): number {
    const row = getCerberusConnection()
      .prepare(
        `INSERT INTO catalog_sets (node, version, entries, one_offs)
         SELECT @node, COALESCE(MAX(version), 0) + 1, @entries, @oneOffs
           FROM catalog_sets WHERE node = @node
         RETURNING version`
      )
      .get({ node, entries, oneOffs }) as { version: number };
    return row.version;
  },

  /** Stamps the moment a set went down the link — again on every resend. Answers whether the set exists. */
  markSetSent(node: string, version: number, at: number): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE catalog_sets SET sent_at = ? WHERE node = ? AND version = ?')
      .run(at, node, version);
    return result.changes > 0;
  },

  /** Stamps the moment the warden acked a version — the latest ack wins. Answers whether the set exists. */
  markSetAcked(node: string, version: number, at: number): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE catalog_sets SET acked_at = ? WHERE node = ? AND version = ?')
      .run(at, node, version);
    return result.changes > 0;
  },
};
