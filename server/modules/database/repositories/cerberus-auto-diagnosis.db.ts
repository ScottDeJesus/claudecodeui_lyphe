import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `auto_diagnosis`, as row-level statements — the per-check switch "Diagnose on its own" in the Cerberus
 * store: whether Cerberus reads a check by itself once it has stayed red.
 *
 * A row is a check that was EVER switched; a check with no row is off, so nothing is written for a check
 * nobody touched. `enabled` is 1 or 0 and `set_at` / `set_by` say when it was last written and by whom
 * (`seed` for the rows the store's step 7 wrote for the eleven pollers, else a person's username). The
 * row is keyed on `(node, check_key)`, where `check_key` is the check's `<service>/<check>` as `checks`
 * holds it, and `set` is an upsert on that key: switching a check again rewrites its one row.
 *
 * Rows are exactly as the table stores them: snake_case, `set_at` in epoch milliseconds on center's
 * clock. A `set_at` that is not whole epoch milliseconds is refused with a RangeError before any write:
 * SQLite's INTEGER affinity would keep text as text.
 *
 * Consumers: `server/modules/cerberus/` — the auto-diagnosis trigger (`enabledSlots` for its plan, `set`
 * behind the switch's `PUT`) and the read model's check detail (`get` for the sheet's switch). Reach it
 * through `@/modules/database/index.js`. Every statement runs on the caller's connection and opens no
 * transaction of its own.
 */

/** One `auto_diagnosis` row, exactly as the table stores it. */
export type CerberusAutoDiagnosisRow = {
  node: string;
  /** The check's `<service>/<check>` key. */
  check_key: string;
  /** 1 when Cerberus diagnoses the check on its own, 0 when it was switched off. */
  enabled: 0 | 1;
  /** When the switch was last written, on center's clock. */
  set_at: number;
  /** Who wrote it: a person's username, or `seed` for a row the store's step 7 wrote. */
  set_by: string;
};

/** A time column takes epoch milliseconds only: SQLite's INTEGER affinity would keep text as text, which sorts above every number. */
function assertEpochMs(what: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a whole number of epoch milliseconds, got ${JSON.stringify(value)}.`);
  }
}

export const cerberusAutoDiagnosisDb = {
  /** The `<node>/<check_key>` of every check whose switch is on. */
  enabledSlots(): Set<string> {
    const rows = getCerberusConnection()
      .prepare('SELECT node, check_key FROM auto_diagnosis WHERE enabled = 1')
      .all() as Pick<CerberusAutoDiagnosisRow, 'node' | 'check_key'>[];
    return new Set(rows.map((row) => `${row.node}/${row.check_key}`));
  },

  /** One check's switch, or `null` when it was never switched (which reads as off). */
  get(node: string, key: string): CerberusAutoDiagnosisRow | null {
    const row = getCerberusConnection()
      .prepare('SELECT node, check_key, enabled, set_at, set_by FROM auto_diagnosis WHERE node = ? AND check_key = ?')
      .get(node, key) as CerberusAutoDiagnosisRow | undefined;
    return row ?? null;
  },

  /**
   * Switches a check on or off at `at` (epoch ms, center's clock), by `by`: writes the check's one row,
   * or rewrites it. Throws a RangeError on an `at` that is not whole epoch milliseconds.
   */
  set(node: string, key: string, enabled: boolean, at: number, by: string): void {
    assertEpochMs(`The auto-diagnosis switch of ${node}/${key}'s set_at`, at);
    getCerberusConnection()
      .prepare(
        `INSERT INTO auto_diagnosis (node, check_key, enabled, set_at, set_by)
         VALUES (@node, @key, @enabled, @at, @by)
         ON CONFLICT(node, check_key) DO UPDATE
           SET enabled = excluded.enabled, set_at = excluded.set_at, set_by = excluded.set_by`
      )
      .run({ node, key, enabled: enabled ? 1 : 0, at, by });
  },
};
