import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';
import {
  historyConditions,
  type CerberusHistoryFilter,
} from '@/modules/database/repositories/cerberus-history-filter.js';

/**
 * `diagnoses` and `diag_steps`, as row-level statements — every read-only diagnosis Cerberus has
 * run, and the steps it took. Both tables are kept forever (spec Table 4); nothing here deletes.
 *
 * A DIAGNOSIS is written when it starts (`insert`, status `running`) and ends once (`end`): one
 * `UPDATE` that only fires while the row is still `running`, and its `changes` is the verdict, so a
 * second end — the 3-minute ceiling crossing a submission, a lost link crossing a close — leaves the
 * first outcome as it was. `done` is a conclusion (summary, evidence, a proposal or none); `failed`
 * is a reason in `error` and proposes nothing. `end` refuses, before any write, what neither the tab
 * nor a warden could use (`endFault`: no summary, evidence that is not a JSON array of strings, a
 * proposal that is not `{ name, cmd, general }` of non-empty strings, a failed end with no error or
 * with a proposal, so a failed diagnosis's command never reaches a warden as a one-off) and any
 * clock that is not whole epoch milliseconds.
 *
 * ACTIVE runs from `insert` to `end`. One check has at most one running diagnosis, held in the
 * `insert` statement itself — it writes only when none is running — so two API processes overlapping
 * at a handover cannot both start one. `running` lists the active ones: what a restart must end (its
 * loop died with the process) and what a hello's `active.diags` is held against.
 *
 * STEPS are one row per step, `(diagnosis, n)` its key, `t` the offset in seconds from the start.
 * `insertStep` is `ON CONFLICT … DO NOTHING`, not `INSERT OR IGNORE`, which would swallow a malformed
 * step as a repeat (the hazard `cerberus-results.db.ts` documents). Its quiet `false` is a repeat or
 * a diagnosis that has already ended — a step must never appear under a "Ready" pill, so the loop
 * files its last step before `end`; every other refusal, a step under an unknown diagnosis included, throws.
 *
 * Rows are exactly as the tables store them: snake_case, times in epoch milliseconds (steps' `t` in
 * seconds), `evidence` and `proposal` as JSON text. Parsing and camelCase belong to the caller. `recent`'s
 * `limit` is clamped to a whole number of at least 0: SQLite reads `LIMIT -1` as "no limit".
 *
 * Consumers: `server/modules/cerberus/` — the diagnosis service (`insert` and `runningForCheck` for its
 * 409, `get`, `end`, `insertStep`, `running` for a restart's orphans and a hello, `openOneOffs` for the
 * catalog it publishes) and the read model (`latestForCheck` for a need's diagnosis, `steps` for the
 * sheet, `recent` for What happened) and the diagnosis agent (`startedSince` for its `history_read`). Reach it through `@/modules/database/index.js`. Every statement
 * runs on the caller's connection and opens no transaction of its own.
 */

/**
 * How long a finished diagnosis's proposal stays runnable once, in ms. Consumers: the diagnosis
 * service (a one-off's `expiresAt`, the 409 on an expired run) and the read model (`oneOffExpiresAt`):
 * one number, so the warden's catalog and the tab's button never disagree about when it lapses.
 */
export const CERBERUS_ONE_OFF_TTL_MS = 3_600_000;

/** Where a diagnosis is: `running` until it ends as `done` (a conclusion) or `failed` (a reason). */
export type CerberusDiagnosisStatus = 'running' | 'done' | 'failed';

/** One `diagnoses` row, exactly as the table stores it. */
export type CerberusDiagnosisRow = {
  id: string;
  node: string;
  check_key: string;
  /** Who pressed Diagnose. */
  asked_by: string;
  /** The model that read, as asked for (`haiku`, a full model id). */
  model: string;
  /** On the center's clock. */
  started_at: number;
  /** On the center's clock; NULL while the diagnosis is running. */
  ended_at: number | null;
  status: CerberusDiagnosisStatus;
  /** The conclusion in prose; NULL until `done`. */
  summary: string | null;
  /** A JSON array of strings, only what was found; NULL until `done`. */
  evidence: string | null;
  /** JSON `{ name, cmd, general }`, or NULL when no fix was proposed (always for a failed one). */
  proposal: string | null;
  /** Why it failed; NULL unless `failed`. */
  error: string | null;
};

/** The columns `insert` writes; `end` fills the rest. */
export type CerberusDiagnosisInsert = Pick<CerberusDiagnosisRow, 'id' | 'node' | 'check_key' | 'asked_by' | 'model' | 'started_at'>;

/** What `end` records beside the status; an absent field is stored NULL, `evidence` and `proposal` as JSON text. */
export type CerberusDiagnosisEndFields = {
  endedAt: number;
  summary?: string | null;
  evidence?: string | null;
  proposal?: string | null;
  error?: string | null;
};

/** One `diag_steps` row: the step's number in the diagnosis, its offset in seconds, and what it did. */
export type CerberusDiagnosisStepRow = {
  n: number;
  t: number;
  text: string;
};

const DIAGNOSIS_COLUMNS =
  'id, node, check_key, asked_by, model, started_at, ended_at, status, summary, evidence, proposal, error';

/** A time column takes epoch milliseconds only: SQLite's INTEGER affinity would keep text as text, which sorts above every number. */
function assertEpochMs(what: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a whole number of epoch milliseconds, got ${JSON.stringify(value)}.`);
  }
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** `undefined` for text that is not JSON — the refusal that follows names the field, so the parse error adds nothing. */
function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Why `end` would refuse a conclusion, or `null` when it is one the tab and a warden can use. */
function endFault(status: 'done' | 'failed', fields: CerberusDiagnosisEndFields): string | null {
  if (status === 'failed') {
    if (!isNonEmptyString(fields.error)) return 'a failed end needs an error';
    return fields.proposal == null ? null : 'a failed end cannot carry a proposal';
  }
  if (!isNonEmptyString(fields.summary)) return 'a done end needs a summary';
  const evidence = fields.evidence == null ? undefined : parseJsonOrUndefined(fields.evidence);
  if (!Array.isArray(evidence) || !evidence.every((item) => typeof item === 'string')) {
    return 'a done end needs evidence as a JSON array of strings (an empty array when nothing was found)';
  }
  if (fields.proposal == null) return null;
  const proposal = parseJsonOrUndefined(fields.proposal) as Record<string, unknown> | null | undefined;
  const isObject = typeof proposal === 'object' && proposal !== null && !Array.isArray(proposal);
  const wellFormed = isObject && ['name', 'cmd', 'general'].every((key) => isNonEmptyString(proposal[key]));
  return wellFormed ? null : 'a proposal must be a JSON object { name, cmd, general } of non-empty strings';
}

export const cerberusDiagnosesDb = {
  /**
   * Appends a diagnosis that has started, as `running`. Answers whether it wrote: `false` only when the
   * check already has one running (the caller's 409). Throws on a duplicate id or a bad `started_at`.
   */
  insert(diagnosis: CerberusDiagnosisInsert): boolean {
    assertEpochMs(`Diagnosis ${diagnosis.id}'s started_at`, diagnosis.started_at);
    return (
      getCerberusConnection()
        .prepare(
          `INSERT INTO diagnoses (id, node, check_key, asked_by, model, started_at, status)
           SELECT @id, @node, @check_key, @asked_by, @model, @started_at, 'running'
            WHERE NOT EXISTS (SELECT 1 FROM diagnoses
                               WHERE node = @node AND check_key = @check_key AND status = 'running')`
        )
        .run(diagnosis).changes > 0
    );
  },

  /** One diagnosis, or `null` when none carries the id. */
  get(id: string): CerberusDiagnosisRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses WHERE id = ?`)
      .get(id) as CerberusDiagnosisRow | undefined;
    return row ?? null;
  },

  /** The diagnosis of a check that has not ended — at most one is ever started — or `null`. */
  runningForCheck(node: string, key: string): CerberusDiagnosisRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses
          WHERE node = ? AND check_key = ? AND status = 'running'
          ORDER BY started_at DESC, id LIMIT 1`
      )
      .get(node, key) as CerberusDiagnosisRow | undefined;
    return row ?? null;
  },

  /** Every diagnosis that has not ended — a node's when `node` is given — oldest first. */
  running(node?: string): CerberusDiagnosisRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses
          WHERE status = 'running' AND (@node IS NULL OR node = @node)
          ORDER BY started_at, id`
      )
      .all({ node: node ?? null }) as CerberusDiagnosisRow[];
  },

  /** A check's newest diagnosis started at or after `since`, running or ended, or `null`. */
  latestForCheck(node: string, key: string, since: number): CerberusDiagnosisRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses
          WHERE node = ? AND check_key = ? AND started_at >= ?
          ORDER BY started_at DESC, id LIMIT 1`
      )
      .get(node, key, since) as CerberusDiagnosisRow | undefined;
    return row ?? null;
  },

  /**
   * Ends a running diagnosis as `done` or `failed`. Answers whether this call ended it: the first end
   * wins. Throws, before any write, on a status that is not an end and on what `endFault` names.
   */
  end(id: string, status: Exclude<CerberusDiagnosisStatus, 'running'>, fields: CerberusDiagnosisEndFields): boolean {
    if (status !== 'done' && status !== 'failed') {
      throw new TypeError(`A diagnosis ends as 'done' or 'failed', not ${JSON.stringify(status)}.`);
    }
    assertEpochMs(`Diagnosis ${id}'s endedAt`, fields.endedAt);
    const fault = endFault(status, fields);
    if (fault) throw new RangeError(`Diagnosis ${id} cannot end as ${status}: ${fault}.`);
    const outcome = getCerberusConnection()
      .prepare(
        `UPDATE diagnoses
            SET status = @status, ended_at = @endedAt, summary = @summary,
                evidence = @evidence, proposal = @proposal, error = @error
          WHERE id = @id AND status = 'running'`
      )
      .run({
        id,
        status,
        endedAt: fields.endedAt,
        summary: fields.summary ?? null,
        evidence: fields.evidence ?? null,
        proposal: fields.proposal ?? null,
        error: fields.error ?? null,
      });
    return outcome.changes > 0;
  },

  /**
   * Appends step `n` of a diagnosis at offset `t` seconds. Answers whether this call wrote it: `false`
   * for a repeat of `(diagnosis, n)` and for a diagnosis that has ended. A malformed step and an
   * unknown `diagnosis` throw.
   */
  insertStep(diagnosis: string, n: number, t: number, text: string): boolean {
    const wellFormed = Number.isSafeInteger(n) && n >= 0 && Number.isFinite(t) && typeof text === 'string';
    if (!wellFormed) {
      throw new RangeError(`Step ${String(n)} of diagnosis ${diagnosis} is malformed: ${JSON.stringify({ n, t, text })}.`);
    }

    const connection = getCerberusConnection();
    // Diagnoses are never deleted, so "unknown" cannot go stale between this read and the insert.
    const parent = connection.prepare('SELECT status FROM diagnoses WHERE id = ?').get(diagnosis) as
      | { status: CerberusDiagnosisStatus }
      | undefined;
    if (!parent) {
      throw new RangeError(`Diagnosis ${diagnosis} is not in diagnoses: a step filed under it would belong to nothing.`);
    }
    if (parent.status !== 'running') return false;

    return (
      connection
        .prepare(
          `INSERT INTO diag_steps (diagnosis, n, t, text) VALUES (?, ?, ?, ?)
           ON CONFLICT(diagnosis, n) DO NOTHING`
        )
        .run(diagnosis, n, t, text).changes > 0
    );
  },

  /** Every step of a diagnosis, in order. */
  steps(id: string): CerberusDiagnosisStepRow[] {
    return getCerberusConnection()
      .prepare('SELECT n, t, text FROM diag_steps WHERE diagnosis = ? ORDER BY n')
      .all(id) as CerberusDiagnosisStepRow[];
  },

  /**
   * The node's diagnoses with a proposal whose `ended_at + CERBERUS_ONE_OFF_TTL_MS` lies after `now`
   * (epoch ms) — runnable once. Oldest end first, so a warden's catalog lists them in a stable order.
   */
  openOneOffs(node: string, now: number): CerberusDiagnosisRow[] {
    return getCerberusConnection()
      .prepare(
        `SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses
          WHERE node = @node AND proposal IS NOT NULL AND ended_at + @ttl > @now
          ORDER BY ended_at, id`
      )
      .all({ node, now, ttl: CERBERUS_ONE_OFF_TTL_MS }) as CerberusDiagnosisRow[];
  },

  /**
   * Diagnoses started at or after `since`, newest first, at most `limit` — across every node, or one
   * node's (`node`), or one check key's (`check`). A diagnosis's `history_read` is the caller (a
   * diagnosis may read what earlier ones concluded). The WHERE is assembled from fixed fragments with
   * every value bound.
   */
  startedSince(filter: CerberusHistoryFilter, limit: number): CerberusDiagnosisRow[] {
    const { conditions, params } = historyConditions(filter, 'started_at', limit);
    return getCerberusConnection()
      .prepare(
        `SELECT ${DIAGNOSIS_COLUMNS} FROM diagnoses
          WHERE ${conditions.join(' AND ')}
          ORDER BY started_at DESC, id LIMIT @limit`
      )
      .all(params) as CerberusDiagnosisRow[];
  },

  /**
   * The diagnoses started before `before`, newest activity first — the feed's "asked" and
   * "ready"/"failed" events. A diagnosis is ranked by the newest of its own moments before `before`
   * (its end when behind `before`, else its start), and the caller derives that moment the same way.
   * At least `limit` rows when that many exist, and MORE when `limit` cuts inside a group ranked at one
   * instant, so a cursor of `before = <last row's moment>` never skips a row left at that instant.
   */
  recent(before: number, limit: number): CerberusDiagnosisRow[] {
    return getCerberusConnection()
      .prepare(
        `WITH ranked AS (
           SELECT ${DIAGNOSIS_COLUMNS},
                  CASE WHEN COALESCE(ended_at, started_at) < @before
                       THEN COALESCE(ended_at, started_at) ELSE started_at END AS moment
             FROM diagnoses WHERE started_at < @before
         )
         SELECT ${DIAGNOSIS_COLUMNS} FROM ranked
          WHERE moment >= (SELECT MIN(moment) FROM (SELECT moment FROM ranked ORDER BY moment DESC LIMIT @limit))
          ORDER BY moment DESC, id`
      )
      .all({ before, limit: Math.max(0, Math.trunc(limit)) }) as CerberusDiagnosisRow[];
  },
};
