import fs from 'node:fs';
import path from 'node:path';

import { watchSpool } from '@/shared/spool-watch.service.js';
import type { SpoolWatch } from '@/shared/spool-watch.service.js';
import { AppError, expandHome } from '@/shared/utils.js';

import { stageLesson } from './kanban-lessons.service.js';
import type { KanbanLessonInput } from './kanban-lessons.service.js';

/**
 * The lesson door for every session: the file a `/learn` drops into `pending-lessons/`, which this
 * sweep stages.
 *
 * WHY THIS EXISTS. `stageLesson` has ONE ingest path and ONE front door, this sweep. A session (a
 * plain Claude Code session, a subagent, another project) has no verb that reaches the board, so it
 * writes one JSON file into `pending-lessons/` and this stages it as the rename lands. The MEMORY lane
 * keeps its OWN door in its own module: the two queues' door rules are genuinely different, so a
 * shared sweeper would be a third thing that has to know both.
 *
 * THE PRODUCER CONTRACT IS `<name>.json.tmp`, THEN RENAME TO `<name>.json` — the contract
 * `learn.md` §4 keeps. The scan is `endsWith('.json')`, so a `.tmp`
 * is invisible to it and the rename publishes the lesson whole or not at all. The scan cannot
 * ENFORCE that — it sees only the name a producer declared complete — so a producer writing the
 * final name in place has forfeited the protection, and a half-written document is refused.
 *
 * STAGE, THEN UNLINK — AT-LEAST-ONCE, DELIBERATELY. The opposite order (unlink first) would LOSE a
 * lesson entirely if the staging then failed. This order can re-stage a duplicate if the process
 * dies in the window between the two, which is visible on the review queue and one click to reject.
 * A duplicate is cheap; a silent loss is not, so the trade is made that way on purpose.
 *
 * QUARANTINE WHAT RE-READING WOULD REPEAT; DEFER EVERYTHING ELSE. A malformed file, a door refusal,
 * a `cardId` naming no card: facts about these bytes, so the file moves to `failed/` — a SUBDIR the
 * non-recursive scan never descends into — and is never re-read on every pass forever. Anything
 * else out of the store is the STORE's condition, not the file's, and the file stays queued for the
 * next pass. That arm covers a peer's write lock (`SQLITE_BUSY`/`SQLITE_LOCKED`) and, load-bearingly,
 * "no such table" — what this sweep sees when its first pass runs while `server/index.ts` is still
 * building the routers, a moment before `initializeDatabase()`, the sole caller of `runMigrations`,
 * creates the schema. The polarity is deliberate — quarantine a bad VALUE, defer a store FAULT —
 * and it is the whole point: we never discard a lesson we could still stage, and a store fault
 * nothing will fix costs one log line per pass, which a person can see and act on.
 */

/** The lesson contract's two length bounds, in characters. Over either one is REFUSED, never cut. */
const NAME_MAX_CHARS = 80;
const SUMMARY_MAX_CHARS = 60;

/**
 * The running sweep, or null before it starts.
 *
 * ONE SWEEP PER PROCESS, not one per module construction. The board's router is built once, for
 * `/api/kanban`; a per-construction watch would sweep one directory twice over and stage the same
 * file twice if a second construction ever ran.
 */
let sweepWatch: SpoolWatch | null = null;

/**
 * The spill root, read at CALL time and redirected by one variable (Interfaces §10).
 *
 * Read per call rather than captured at module load: a probe boots its own server against its own
 * scratch root, and a value frozen at import would send that server at the operator's live tree.
 */
function spillRoot(): string {
  return expandHome(process.env.CLOUDCLI_SPILL_ROOT || '~/.cloudcli');
}

/** Where a `/learn` drops its file — the path `learn.md` §4 writes. */
function lessonQueueDir(): string {
  return path.join(spillRoot(), 'pending-lessons');
}

/** Refused files land here, a SUBDIR of the queue so the scan below never re-reads one. */
function lessonFailedDir(): string {
  return path.join(spillRoot(), 'pending-lessons', 'failed');
}

/** One error, in one line, for a log — never a stack a reader has to wade through. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The store's verdict on the CONTENT — the one class of store failure re-reading these bytes would
 * produce again, so the only one worth quarantining: the `AppError` `stageLesson` throws before its
 * transaction opens, for a `cardId` that names no card). A `SqliteError` is the opposite — it says
 * something about the STORE
 * — and a two-code test for BUSY or LOCKED (what this file shipped first) classified "no such table"
 * as permanent and destroyed lessons during the boot race above. Do not narrow it again.
 */
function isPermanentStoreRefusal(error: unknown): boolean {
  return error instanceof AppError;
}

/** A field the store's own NOT NULL column needs, or a refusal naming the field and the reason. */
function requiredText(value: unknown, field: string, maxChars?: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required and must be a non-empty string`);
  }
  if (maxChars !== undefined && value.length > maxChars) {
    throw new Error(`${field} must be <= ${maxChars} characters (it is refused, not truncated)`);
  }
  return value;
}

/** A field that must be a string when present. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

/**
 * THE door for a hand-authored file: the parsed JSON in, a `stageLesson` argument out.
 *
 * The load-bearing job is that a MISSING key refuses cleanly instead of reaching the repository as
 * `undefined` and surfacing as sqlite's own sentence rendered a 500 — the file path is the one place
 * no transport pre-check runs. What is checked here is exactly what the row requires: `name`,
 * `summary` and `trigger` are non-empty strings, `name` and `summary` carry the lesson contract's
 * two length bounds (`learn.md` §2: a bound promised to the writer is one this door has to keep),
 * and the four optional fields carry the shapes the repository can store.
 *
 * The `trigger` is checked only as a non-blank string: this door holds no vocabulary of triggers,
 * and the column tolerates any string.
 *
 * `source` is never read from the file: the ingest path's identity is `'learn'` and the sweep stamps
 * it itself, so a hand-authored file cannot claim any source but `'learn'`.
 */
function lessonInputFromJson(parsed: unknown): KanbanLessonInput {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('the top-level JSON is not an object');
  }
  const data = parsed as Record<string, unknown>;

  const input: KanbanLessonInput = {
    name: requiredText(data.name, 'name', NAME_MAX_CHARS),
    summary: requiredText(data.summary, 'summary', SUMMARY_MAX_CHARS),
    trigger: requiredText(data.trigger, 'trigger'),
  };

  if (data.body !== undefined) input.body = text(data.body, 'body');
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string')) {
      throw new Error('tags must be a list of strings');
    }
    input.tags = data.tags;
  }
  if (data.kind !== undefined) {
    if (data.kind !== 'note' && data.kind !== 'skill_draft') {
      throw new Error("kind must be 'note' or 'skill_draft'");
    }
    input.kind = data.kind;
  }
  if (data.cardId !== undefined) {
    if (data.cardId !== null && typeof data.cardId !== 'string') {
      throw new Error('cardId must be a string or null');
    }
    input.cardId = data.cardId;
  }

  return input;
}

/**
 * Moves a refused file out of the scan set, keeping its bytes for the person to inspect.
 *
 * The reason goes to the log — a sidecar file beside it would be one more thing in the queue's
 * directory for no reader. If even the move fails, the file is unlinked instead: poison must leave
 * the scan set either way, and a second failure costs one line, never a crash.
 */
function refuse(file: string, reason: string): void {
  const stem = path.basename(file);
  console.warn(`[kanban-spill] refusing ${stem}: ${reason}`);
  try {
    fs.mkdirSync(lessonFailedDir(), { recursive: true });
    fs.renameSync(file, path.join(lessonFailedDir(), stem));
  } catch (moveError) {
    console.warn(`[kanban-spill] could not move ${stem} aside (${describe(moveError)}); unlinking`);
    try {
      fs.unlinkSync(file);
    } catch {
      // Leave it: the retry a pass that leaves a .json arms (SPILL_RETRY_MS) re-attempts it, never a tight loop.
    }
  }
}

/** One file, from bytes to a staged row. Poison is moved aside; a transient lock leaves it queued. */
function ingestLessonFile(file: string): void {
  const stem = path.basename(file);

  // REGULAR FILES ONLY, and checked BEFORE the read. `readFileSync` on a FIFO blocks with no
  // timeout and no interrupt — one such entry would wedge the sweep for the life of the process.
  let stats: fs.Stats;
  try {
    stats = fs.statSync(file);
  } catch (error) {
    refuse(file, `unreadable (${describe(error)})`);
    return;
  }
  if (!stats.isFile()) {
    refuse(file, 'not a regular file (a FIFO or device node would wedge the sweep)');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    refuse(file, `unreadable or invalid JSON (${describe(error)})`);
    return;
  }

  let input: KanbanLessonInput;
  try {
    input = lessonInputFromJson(parsed);
  } catch (error) {
    refuse(file, `the door refused it (${describe(error)})`);
    return;
  }

  try {
    stageLesson({ ...input, source: 'learn' });
  } catch (error) {
    if (isPermanentStoreRefusal(error)) {
      refuse(file, `staging refused it (${describe(error)})`);
      return;
    }
    // The STORE's condition, not this file's: leave it queued and retry next pass (see the module
    // docstring — this arm is what keeps the boot race from destroying a lesson).
    console.warn(`[kanban-spill] deferring ${stem} (store not ready): ${describe(error)}`);
    return;
  }

  try {
    fs.unlinkSync(file);
  } catch (error) {
    // Staged but not unlinked: the next pass re-stages a duplicate, which the operator rejects.
    console.warn(`[kanban-spill] staged ${stem} but could not unlink it: ${describe(error)}`);
  }
}

/** A name the scan reads: the producer renames its `.tmp` to this only once the document is whole. */
function isQueuedName(name: string): boolean {
  return name.endsWith('.json');
}

/** Every `.json` file waiting in the queue, oldest first, or none when the directory is absent. */
function queuedFiles(dir: string): string[] {
  try {
    // Name order IS age order: `learn.md` writes an `<epoch>-<slug>.json` name.
    return fs.readdirSync(dir).filter(isQueuedName).sort();
  } catch {
    // A queue that does not exist yet is the COMMON case, not a fault: nothing has been dropped yet.
    return [];
  }
}

/** One pass over the queue. Never throws: one poison file must not end the sweep. */
export function sweepLessonsOnce(): void {
  const dir = lessonQueueDir();
  for (const name of queuedFiles(dir)) {
    try {
      ingestLessonFile(path.join(dir, name));
    } catch (error) {
      console.warn(`[kanban-spill] error on ${name} (continuing): ${describe(error)}`);
    }
  }
}

/**
 * Starts the sweep. Called once per process from `kanban.module.ts`, and idempotent thereafter.
 *
 * A pass runs at once, so a lesson dropped while the server was down is staged as soon as it is up,
 * then on every `.json` name the queue's watch hears. The first pass runs at MODULE-EVALUATION time,
 * before `initializeDatabase()`, so on a schema that has not landed its stage fails with "no such
 * table" — the deferral arm, never a refusal — and the retry `watchSpool` arms for a pass that leaves
 * a file queued stages it. That is why the polarity in `isPermanentStoreRefusal` matters.
 */
export function startLessonSpillSweep(): void {
  if (sweepWatch !== null) return;
  sweepWatch = watchSpool({
    dir: lessonQueueDir(),
    isQueued: isQueuedName,
    sweep: sweepLessonsOnce,
    logError: (message) => console.warn(`[kanban-spill] ${message}`),
  });
}
