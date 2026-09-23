import { getConnection } from '@/modules/database/connection.js';
import type { CronJob, CronSyncReport } from '@/shared/types.js';

/**
 * The cron registry's two tables: every tracked scheduled job, and one row per sync that read
 * the box.
 *
 * They share a repository because the sync writes both in the same act and the screen reads both
 * together — a job list with no last-sync line cannot say whether it is current.
 *
 * Consumers: the schedules module's read service (`GET /api/schedules`), its sync service
 * (`reconcile` + `runSync`), and the module's CLI door (`add` / `remove` / `list` / `sync`) —
 * reached through `@/modules/database/index.js`. Every statement runs on the shared connection
 * from `getConnection()`, taken inside each method, so the door and the server write one file.
 *
 * Nothing here enforces the two things its consumers must do first:
 *   1. Call `initializeDatabase()` at least once. `getConnection()` creates only `app_config`,
 *      so on a fresh `DATABASE_PATH` every method below throws `no such table: cron_jobs`. The
 *      server initializes at boot; the CLI door has no boot step of its own.
 *   2. A writer in another PROCESS must set `pragma busy_timeout = 5000` on its own connection
 *      and hold the door's `flock`. The connection here inherits better-sqlite3's own 5 s wait,
 *      so a same-process collision blocks rather than failing outright — measured, a second
 *      connection holding `BEGIN IMMEDIATE` makes `markMissing` throw `SQLITE_BUSY` after
 *      5008 ms — but the door is a second process, and the house rule names the pragma there.
 *
 * `tracked_at` is written once, on the first insert, and never again: the registry exists to
 * remember when a job entered it. `markMissing` marks, it never deletes — a job that vanished
 * from the box must stay on the record as missing. `removeJob` is the one delete, and only the
 * CLI door's explicit `remove` calls it.
 */

/** One `cron_jobs` row as SQLite holds it: snake_case, exactly the table's columns. */
type CronJobRow = {
  id: string;
  kind: string;
  name: string;
  purpose: string | null;
  owner: string;
  origin: string;
  expression: string;
  schedule_text: string;
  command: string;
  log_path: string | null;
  state: string;
  drift: string;
  drift_detail: string | null;
  last_run_at: string | null;
  last_result: string | null;
  next_run_at: string | null;
  note: string | null;
  source: string;
  tags: string;
  tracked_at: string;
  updated_at: string;
};

/** One `cron_sync_runs` row. `ok` arrives as SQLite's 0/1 and leaves as a boolean. */
type CronSyncRunRow = {
  ran_at: string;
  ok: number;
  error: string | null;
  seen: number;
  adopted: number;
  missing: number;
  changed: number;
  ms: number;
};

const JOB_COLUMNS =
  'id, kind, name, purpose, owner, origin, expression, schedule_text, command, log_path, ' +
  'state, drift, drift_detail, last_run_at, last_result, next_run_at, note, source, tags, ' +
  'tracked_at, updated_at';

const SYNC_COLUMNS = 'ran_at, ok, error, seen, adopted, missing, changed, ms';

/**
 * `tags` as the contract's array. The column is a JSON array of strings; anything else in it — a
 * hand edit, a half-written value — reads as no tags rather than throwing out of the whole list.
 */
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * A row as the contract declares it. The casts are the seam: the columns are TEXT holding the
 * union members, and the table's own defaults ('unknown', 'none') are members of those unions.
 */
function toJob(row: CronJobRow): CronJob {
  return {
    id: row.id,
    kind: row.kind as CronJob['kind'],
    name: row.name,
    purpose: row.purpose,
    tags: parseTags(row.tags),
    owner: row.owner,
    origin: row.origin as CronJob['origin'],
    expression: row.expression,
    scheduleText: row.schedule_text,
    command: row.command,
    logPath: row.log_path,
    state: row.state as CronJob['state'],
    drift: row.drift as CronJob['drift'],
    driftDetail: row.drift_detail,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    nextRunAt: row.next_run_at,
    note: row.note,
    source: row.source,
    trackedAt: row.tracked_at,
    updatedAt: row.updated_at,
  };
}

function toSyncReport(row: CronSyncRunRow): CronSyncReport {
  return {
    ranAt: row.ran_at,
    ok: row.ok === 1,
    error: row.error,
    seen: row.seen,
    adopted: row.adopted,
    missing: row.missing,
    changed: row.changed,
    ms: row.ms,
  };
}

/** The instant a write stamps `updated_at`, in the contract's own ISO-8601-with-offset shape. */
function nowIso(): string {
  return new Date().toISOString();
}

export const cronJobsDb = {
  /** Every tracked job — read by the schedules module's read service for `GET /api/schedules`. */
  listJobs(): CronJob[] {
    const db = getConnection();

    const rows = db
      .prepare(`SELECT ${JOB_COLUMNS} FROM cron_jobs ORDER BY tracked_at, id`)
      .all() as CronJobRow[];

    return rows.map(toJob);
  },

  /**
   * Write one row, whether it is new or already tracked — called by the sync service for every
   * adoption or change, and by the CLI door for the row it just wrote to the crontab.
   *
   * On a re-sync every field is replaced EXCEPT `tracked_at`, which keeps the instant the job
   * first entered the registry; `updated_at` is stamped now. The caller's `trackedAt` is
   * therefore honoured on the first write and ignored on every one after it.
   */
  upsertJob(job: CronJob): void {
    const db = getConnection();

    db.prepare(
      `INSERT INTO cron_jobs (${JOB_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         purpose = excluded.purpose,
         owner = excluded.owner,
         origin = excluded.origin,
         expression = excluded.expression,
         schedule_text = excluded.schedule_text,
         command = excluded.command,
         log_path = excluded.log_path,
         state = excluded.state,
         drift = excluded.drift,
         drift_detail = excluded.drift_detail,
         last_run_at = excluded.last_run_at,
         last_result = excluded.last_result,
         next_run_at = excluded.next_run_at,
         note = excluded.note,
         source = excluded.source,
         tags = excluded.tags,
         updated_at = ?`
    ).run(
      job.id,
      job.kind,
      job.name,
      job.purpose,
      job.owner,
      job.origin,
      job.expression,
      job.scheduleText,
      job.command,
      job.logPath,
      job.state,
      job.drift,
      job.driftDetail,
      job.lastRunAt,
      job.lastResult,
      job.nextRunAt,
      job.note,
      job.source,
      JSON.stringify(job.tags),
      job.trackedAt,
      job.updatedAt,
      nowIso(),
    );
  },

  /**
   * Mark the given ids missing — the sync service's answer to lines that left the box.
   *
   * This MARKS and never deletes: a job that vanished from the crontab staying on the record as
   * `missing` is the whole point of the registry. Returns how many rows the statement changed.
   */
  markMissing(ids: string[]): number {
    if (ids.length === 0) {
      return 0; // Nothing left the box this run; issuing `IN ()` would be a syntax error.
    }

    const db = getConnection();
    const placeholders = ids.map(() => '?').join(', ');

    const result = db
      .prepare(
        `UPDATE cron_jobs
         SET state = 'missing', drift = 'missing', updated_at = ?
         WHERE id IN (${placeholders})`
      )
      .run(nowIso(), ...ids);

    return result.changes;
  },

  /**
   * Drop one row for good — the CLI door's explicit `remove`, the only delete in this file.
   *
   * A job disappearing from the box is NOT this: that is `markMissing` above. This is the
   * operator saying the job is gone from the record too.
   */
  removeJob(id: string): void {
    getConnection().prepare(`DELETE FROM cron_jobs WHERE id = ?`).run(id);
  },

  /** Record one sync run — called by the sync service at the end of every read of the box. */
  recordSync(report: CronSyncReport): void {
    const db = getConnection();

    db.prepare(
      `INSERT INTO cron_sync_runs (${SYNC_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      report.ranAt,
      report.ok ? 1 : 0,
      report.error,
      report.seen,
      report.adopted,
      report.missing,
      report.changed,
      report.ms,
    );
  },

  /**
   * The newest sync run, or null when none has ever been recorded — read by the schedules
   * module's read service and by the CLI door's `list`/`sync` output, both of which must be
   * able to say "never synced" rather than guess a time.
   */
  lastSync(): CronSyncReport | null {
    const db = getConnection();

    const row = db
      .prepare(`SELECT ${SYNC_COLUMNS} FROM cron_sync_runs ORDER BY id DESC LIMIT 1`)
      .get() as CronSyncRunRow | undefined;

    return row ? toSyncReport(row) : null;
  },
};
