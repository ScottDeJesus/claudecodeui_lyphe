import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `probes` and `checks`, as row-level statements — what each node is told to run and what a result
 * can be filed under, in the Cerberus store.
 *
 * Both are DEFINITIONS: rows a person (or a first-seen health document) writes, rewritten in place
 * rather than appended. A probe is what the warden schedules; a check is one reportable thing — a
 * probe's own `<service>/health`, or a component a `health_doc` probe fans out into. Nothing here
 * deletes a check: `retireCheck` stamps `retired_at`, so its results keep a home.
 *
 * `activeChecks` is the one place a check's staleness is resolved (see `STALE_AFTER_SQL`). The write
 * path (ingest's keep-alive decision) and the read model (a result's freshness) both read it from here.
 *
 * Rows are exactly as the table stores them: snake_case, `spec` as the JSON text the caller wrote —
 * parsing and camelCase are the service's.
 *
 * Consumers: `server/modules/cerberus/` — the definitions service (`PUT /definitions` replaces a
 * node's probes and checks inside its own transaction, `PUT /labels` writes labels), ingest (first
 * sight of a component, `activeChecks` for staleness), the checks-set builder (`probesOf`) and the
 * read model (`activeChecks`). Reach it through `@/modules/database/index.js`. Every statement runs
 * on the caller's connection and opens no transaction of its own.
 */

/** One `probes` row, exactly as the table stores it. */
export type CerberusProbeRow = {
  node: string;
  /** `<service>/<id>`, unique within a node. */
  key: string;
  service: string;
  /** `health_doc`, `http`, `tcp`, `exec`, `file_age`, `sql` — or `self` for center's own checks. */
  kind: string;
  /** The kind's own fields (url, host, port, cmd, path, dsn, query) as JSON text. */
  spec: string;
  /** Seconds between runs. */
  every: number;
  /** Seconds a run may take. */
  timeout: number;
  /** Seconds between a health document's own refreshes, when it names one. */
  cadence: number | null;
  /** The checks-set version this row was written at. */
  version: number;
};

/** One `checks` row, exactly as the table stores it. */
export type CerberusCheckRow = {
  node: string;
  key: string;
  service: string;
  service_label: string | null;
  /** NULL until a person writes one — the key stands in. */
  label: string | null;
  /** The `health_doc` probe a component was discovered through; NULL for a probe's own check. */
  source: string | null;
  /** The probe this check is the own check of; NULL for a component. */
  probe: string | null;
  pass: string | null;
  warn: string | null;
  /** Seconds after which a result of this check is stale; NULL defers to the probe's cadence. */
  stale_after: number | null;
  version: number;
  discovered_at: number | null;
  /** NULL while the check is active. */
  retired_at: number | null;
};

/** What `upsertCheck` writes: every column of a check but `retired_at`, which an upsert clears. */
export type CerberusCheckUpsert = Omit<CerberusCheckRow, 'retired_at'>;

/**
 * One unretired check joined to the probe that reports it. The `probe_*` columns are NULL when no
 * probe row of the node carries the key (a check whose probe was deleted before it was retired).
 */
export type CerberusActiveCheckRow = Omit<CerberusCheckRow, 'retired_at'> & {
  /** The key of the probe that reports this check: `COALESCE(checks.probe, checks.source)`. */
  reporting_probe: string | null;
  probe_kind: string | null;
  probe_every: number | null;
  probe_cadence: number | null;
  /** The check's staleness in SECONDS, resolved by `STALE_AFTER_SQL`; NULL only with no probe and no override. */
  stale_after_s: number | null;
};

// `key` and `desc` are keywords; SQLite tolerates them as column names, and quoting keeps every
// statement that names them unambiguous.
const PROBE_COLUMNS = 'node, "key", service, kind, spec, every, timeout, cadence, version';
// The columns a definition write sets; `retired_at` is the one a read adds.
const CHECK_DEFINITION_COLUMNS = `node, "key", service, service_label, label, source, probe, pass, warn,
  stale_after, version, discovered_at`;
const CHECK_COLUMNS = `${CHECK_DEFINITION_COLUMNS}, retired_at`;

/**
 * THE ONE HOME OF `staleAfter(check)`: a check's own `stale_after` override, else three times the
 * cadence of the probe that reports it (a health document's own refresh rate when it names one,
 * else the probe's `every`). Seconds. Nothing else in the codebase re-derives it.
 */
const STALE_AFTER_SQL = 'COALESCE(c.stale_after, 3 * COALESCE(p.cadence, p.every))';

export const cerberusDefinitionsDb = {
  /** A node's probes, grouped by service then key. */
  probesOf(node: string): CerberusProbeRow[] {
    return getCerberusConnection()
      .prepare(`SELECT ${PROBE_COLUMNS} FROM probes WHERE node = ? ORDER BY service, "key"`)
      .all(node) as CerberusProbeRow[];
  },

  /**
   * A node's checks INCLUDING retired ones, grouped by service then key — the write path needs the
   * retired rows to know what a re-added check un-retires. The screens read `activeChecks`.
   */
  checksOf(node: string): CerberusCheckRow[] {
    return getCerberusConnection()
      .prepare(`SELECT ${CHECK_COLUMNS} FROM checks WHERE node = ? ORDER BY service, "key"`)
      .all(node) as CerberusCheckRow[];
  },

  /** Inserts a probe, or replaces every column of the one already under `(node, key)`. */
  upsertProbe(probe: CerberusProbeRow): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO probes (${PROBE_COLUMNS})
         VALUES (@node, @key, @service, @kind, @spec, @every, @timeout, @cadence, @version)
         ON CONFLICT(node, "key") DO UPDATE SET
           service = excluded.service, kind = excluded.kind, spec = excluded.spec,
           every = excluded.every, timeout = excluded.timeout, cadence = excluded.cadence,
           version = excluded.version`
      )
      .run(probe);
  },

  /** Deletes a probe's row. Its checks are the caller's to retire. Answers whether a row went. */
  deleteProbe(node: string, key: string): boolean {
    const result = getCerberusConnection()
      .prepare('DELETE FROM probes WHERE node = ? AND "key" = ?')
      .run(node, key);
    return result.changes > 0;
  },

  /**
   * Writes a check's definition: inserts it, or — when `(node, key)` exists — replaces `service`,
   * `source`, `probe`, `pass`, `warn`, `stale_after` and `version`, and CLEARS `retired_at`.
   * Two columns are kept on purpose:
   *   - `label` and `service_label` are written only when a value is given. A NULL leaves the stored
   *     label alone, so a re-discovery can never wipe the words a person wrote; clearing one is
   *     `setCheckLabel` / `setServiceLabel` with `null`.
   *   - `discovered_at` keeps the first value it got.
   * A check inserted without a `service_label` takes the one its service's other checks carry, so a
   * component discovered later does not read as an unlabelled service beside its labelled siblings.
   */
  upsertCheck(check: CerberusCheckUpsert): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO checks (${CHECK_DEFINITION_COLUMNS})
         VALUES (@node, @key, @service,
                 COALESCE(@service_label, (SELECT service_label FROM checks
                                            WHERE node = @node AND service = @service
                                              AND service_label IS NOT NULL LIMIT 1)),
                 @label, @source, @probe, @pass, @warn, @stale_after, @version, @discovered_at)
         ON CONFLICT(node, "key") DO UPDATE SET
           service = excluded.service,
           service_label = COALESCE(@service_label, checks.service_label),
           label = COALESCE(@label, checks.label),
           source = excluded.source, probe = excluded.probe,
           pass = excluded.pass, warn = excluded.warn, stale_after = excluded.stale_after,
           version = excluded.version,
           discovered_at = COALESCE(checks.discovered_at, excluded.discovered_at),
           retired_at = NULL`
      )
      .run(check);
  },

  /** Retires a check at `at`, keeping its row and its results. Answers whether it was active. */
  retireCheck(node: string, key: string, at: number): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE checks SET retired_at = ? WHERE node = ? AND "key" = ? AND retired_at IS NULL')
      .run(at, node, key);
    return result.changes > 0;
  },

  /** Sets one check's label; `null` clears it, and the key stands in again. Answers whether the check exists. */
  setCheckLabel(node: string, key: string, label: string | null): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE checks SET label = ? WHERE node = ? AND "key" = ?')
      .run(label, node, key);
    return result.changes > 0;
  },

  /**
   * Sets a service's label on every check of that service on the node (the label lives on the
   * check rows, so the service's checks always agree); `null` clears it. Answers how many rows moved.
   */
  setServiceLabel(node: string, service: string, label: string | null): number {
    return getCerberusConnection()
      .prepare('UPDATE checks SET service_label = ? WHERE node = ? AND service = ?')
      .run(label, node, service).changes;
  },

  /**
   * The index of unretired checks — of one node, or of every node when `node` is omitted — each
   * joined to the probe that reports it (`COALESCE(checks.probe, checks.source)`) and carrying
   * `stale_after_s`. A LEFT JOIN, so a check whose probe row is gone still appears rather than
   * vanishing from the screen. Grouped by node, service, key.
   */
  activeChecks(node?: string): CerberusActiveCheckRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT c.node, c."key", c.service, c.service_label, c.label, c.source, c.probe, c.pass, c.warn,
                c.stale_after, c.version, c.discovered_at,
                p."key" AS reporting_probe, p.kind AS probe_kind,
                p.every AS probe_every, p.cadence AS probe_cadence,
                ${STALE_AFTER_SQL} AS stale_after_s
           FROM checks c
           LEFT JOIN probes p ON p.node = c.node AND p."key" = COALESCE(c.probe, c.source)
          WHERE c.retired_at IS NULL AND (@node IS NULL OR c.node = @node)
          ORDER BY c.node, c.service, c."key"`
      )
      .all({ node: node ?? null }) as CerberusActiveCheckRow[];
  },
};
