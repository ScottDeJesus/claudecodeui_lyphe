import fs from 'node:fs';
import path from 'node:path';

import { expandHome } from '@/shared/utils.js';

import { stageMemoryCandidate, validateMemoryArgs } from './memory.service.js';
import type { MemoryCandidateInput } from './memory.service.js';

/**
 * The memory lane's own queue door: the file a session drops when it has something durable to
 * propose and no way to write it itself.
 *
 * WHY THIS EXISTS. A session cannot write a memory — the operator's approval IS the lane, and the
 * write destinations are guarded surfaces. So a session PROPOSES: it writes one JSON file into
 * `pending-memories/` and this picks it up within 15 seconds and stages it as a reviewable
 * candidate. The lane is the only writer; a session is only ever a petitioner.
 *
 * *THIS* MODULE SWEEPS *THIS* QUEUE. The board's lesson queue has its own door in its own module,
 * with the same cadence and the same discipline. There is no third home that knows about both, and
 * none is wanted: the two queues have different door rules, different stage verbs and different
 * failure vocabularies, so a shared engine would be a layer that exists only to be parameterised.
 *
 * THE DOOR IS REUSED, NEVER FORKED. Every file goes through `validateMemoryArgs` — the single home
 * for the intake rules — and `stageMemoryCandidate`, which is the same pair the HTTP route calls. A
 * hand-authored file therefore passes byte-identical guards, and any key the door does not whitelist
 * is dropped rather than stored. `stageMemoryCandidate` gets `'spill'` as its `source`: source is the
 * INGEST PATH's identity, never the file's claim.
 *
 * THE PRODUCER CONTRACT IS `<name>.json.tmp`, THEN RENAME TO `<name>.json` — see `remember.md` §4.
 * A half-written JSON document is refused at the door and moved aside with no retry, because
 * re-reading the same bytes fails the same way; the `.tmp` name is the only protection there is.
 *
 * STAGE, THEN UNLINK — AT-LEAST-ONCE, DELIBERATELY. The opposite order would LOSE a proposal if the
 * staging then failed. This order can re-stage a duplicate if the process dies between the two, and
 * the operator denies one from the queue. A duplicate is cheap; a silent loss is not.
 *
 * A REFUSAL LEAVES THE SCAN SET, AND ANY STORE FAULT DOES NOT. A file the DOOR refuses is moved to
 * `failed/` — a SUBDIR the non-recursive scan never descends into — so it is never re-read every 15
 * seconds forever, and its bytes are kept for the person to inspect. Everything that comes out of
 * `stageMemoryCandidate` is deferred instead, with the file left queued: the stage verb is a bare
 * INSERT whose only failures are the store's own condition (a peer's write lock, a disk fault, and
 * load-bearingly "no such table" — this sweep's first pass runs while `server/index.ts` is still
 * building the routers, a moment before `initializeDatabase()`, the sole caller of `runMigrations`,
 * creates the schema). The door is where a fact about the bytes is decided; a store failure is a
 * fact about the store, and it changes. A narrowing to `SQLITE_BUSY`/`SQLITE_LOCKED` alone shipped
 * here first and destroyed proposals during that boot race; the polarity — a door `ValueError`
 * quarantined, an `OperationalError` deferred — is load-bearing and
 * must not be narrowed again. The price is that a store fault nothing
 * will fix leaves one line per pass with the file still queued — visible and actionable — instead of
 * losing a proposal one second before it could have been staged.
 */

/** The sweep's cadence. Latency only — staging is idempotent at the operator's review. */
const SPILL_INTERVAL_MS = 15_000;

/**
 * The running sweep, or null before it starts.
 *
 * ONE SWEEP PER PROCESS, not one per module construction: a second construction — a second mount, a
 * reload seam — would otherwise race the first over one directory and stage the same proposal twice.
 */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * The spill root, read at CALL time and redirected by one variable (Interfaces §10).
 *
 * Read per call rather than captured at module load, so a probe's server sweeps its own scratch tree
 * and never the operator's.
 */
function spillRoot(): string {
  return expandHome(process.env.CLOUDCLI_SPILL_ROOT || '~/.cloudcli');
}

/** Where a proposing session drops its file — the path `remember.md` §4 writes. */
function memoryQueueDir(): string {
  return path.join(spillRoot(), 'pending-memories');
}

/** Refused files land here, a SUBDIR of the queue so the scan below never re-reads one. */
function memoryFailedDir(): string {
  return path.join(spillRoot(), 'pending-memories', 'failed');
}

/** One error, in one line, for a log — never a stack a reader has to wade through. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Moves a refused file out of the scan set, keeping its bytes for the person to inspect.
 *
 * The reason goes to the log — the candidate a person will actually read is the queue's own view,
 * and a sidecar file would be one more thing in the directory for no reader. If even the move fails,
 * the file is unlinked instead: a refusal must leave the scan set either way, and a second failure
 * costs one line, never a crash.
 */
function refuse(file: string, reason: string): void {
  const stem = path.basename(file);
  console.warn(`[memory-spill] refusing ${stem}: ${reason}`);
  try {
    fs.mkdirSync(memoryFailedDir(), { recursive: true });
    fs.renameSync(file, path.join(memoryFailedDir(), stem));
  } catch (moveError) {
    console.warn(`[memory-spill] could not move ${stem} aside (${describe(moveError)}); unlinking`);
    try {
      fs.unlinkSync(file);
    } catch {
      // Leave it: the next pass re-attempts, and 15 seconds apart is never a tight loop.
    }
  }
}

/** One file: declared to the door, staged as a pending candidate, then unlinked. */
function ingestMemoryFile(file: string): void {
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

  let input: MemoryCandidateInput;
  try {
    // The door is the whole check: target allowlist, project slug shape AND existence, body bounds,
    // the `memory` target's one-line index. A refusal is a permanent fact about these bytes.
    input = validateMemoryArgs(parsed);
  } catch (error) {
    refuse(file, `the door refused it (${describe(error)})`);
    return;
  }

  try {
    stageMemoryCandidate(input, 'spill');
  } catch (error) {
    // The STORE's condition, not this file's: leave it queued and retry next pass. The door above
    // already decided every fact about these bytes, so nothing reaching here is a permanent refusal
    // — see the module docstring, and do not narrow this arm to a code list.
    console.warn(`[memory-spill] deferring ${stem} (store not ready): ${describe(error)}`);
    return;
  }

  try {
    fs.unlinkSync(file);
  } catch (error) {
    // Staged but not unlinked: the next pass stages a duplicate, which the operator denies.
    console.warn(`[memory-spill] staged ${stem} but could not unlink it: ${describe(error)}`);
  }
}

/** Every `.json` file waiting in the queue, oldest first, or none when the directory is absent. */
function queuedFiles(dir: string): string[] {
  try {
    // Name order IS age order: `remember.md` writes an `<epoch>-<slug>.json` name.
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    // A queue that does not exist yet is the COMMON case, not a fault.
    return [];
  }
}

/** One pass over the queue. Never throws: one poison file must not end the sweep. */
export function sweepMemoriesOnce(): void {
  const dir = memoryQueueDir();
  for (const name of queuedFiles(dir)) {
    try {
      ingestMemoryFile(path.join(dir, name));
    } catch (error) {
      console.warn(`[memory-spill] error on ${name} (continuing): ${describe(error)}`);
    }
  }
}

/**
 * Starts the sweep. Called once per process from `memory-intake.module.ts`, idempotent thereafter.
 *
 * The first pass runs immediately rather than at the first tick, so a proposal dropped while the
 * server was down is staged as soon as it is up. It runs at MODULE-EVALUATION time, i.e. before
 * `initializeDatabase()`, so on a database whose schema has not landed yet its stage fails with "no
 * such table" — deferred, never refused, and the next pass stages it 15 seconds later.
 *
 * The timer is unref'd: a pending sweep must never be
 * a reason for the process to stay alive. The pass is wrapped because an exception out of an interval
 * callback is an uncaught exception — the whole server would go down over one unreadable file.
 */
export function startMemorySpillSweep(): void {
  if (sweepTimer !== null) return;

  const tick = (): void => {
    try {
      sweepMemoriesOnce();
    } catch (error) {
      console.warn(`[memory-spill] sweep error (continuing): ${describe(error)}`);
    }
  };

  tick();
  sweepTimer = setInterval(tick, SPILL_INTERVAL_MS);
  sweepTimer.unref();
}
