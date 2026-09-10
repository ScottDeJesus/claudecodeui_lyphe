import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The disk side of the plan-runner lane: how one run directory is read, and nothing about
 * what its contents MEAN.
 *
 * The runner owns `<state dir>/<run_id>/`. This server only ever reads it — the runner is a
 * separate process that may be mid-phase right now, and a second writer would race its own
 * atomic rewrite. Four of the files in there are this lane's:
 *
 * - `progress.json` — the whole picture (position, phases, spend, the composed status line).
 *   The runner REPLACES it whole through `atomic_write` (`hooks/plan_runner/state_lock.py:72-90`,
 *   a per-write `mkstemp` scratch plus `os.replace`), called at `progress.py:151`, so a read
 *   caught mid-rewrite is a decode error on the old bytes or a clean read of the new ones —
 *   never a half-record with plausible fields.
 * - `run.json` — the run's own state. This lane reads exactly one field from it: `stopped_at`.
 * - `receipt.json` — its PRESENCE means the run is over; its `status` and `ended_at` say how and when,
 *   which the lane carries for a while so the operator sees the ending before it leaves the tab.
 * - `runner.log` — one appended line per stage change (`progress.py:155`).
 *
 * A fifth file is read from OUTSIDE the run directory: the run's lock under `locks/`, which is
 * the only thing on disk that says a daemon is still breathing. See {@link readRunLockBeat}.
 *
 * The directory holds more than those four, and the rest are ignored on purpose rather than
 * missed. `progress.txt` is the same line plus one row per phase, rendered for a human reading it
 * in a terminal (`progress.py:152`); this lane already has those facts structured, so parsing the
 * prose back would be a second and worse decoder of the file it sits beside. `runner.out` is the
 * daemon's raw stderr (`cmd/daemon.py:47,196`) and `phase_<n>/` holds each soul's transcript —
 * both unbounded, unstructured, and carrying whatever a soul happened to print, which is not
 * something to fan out to every open tab on a two-second poll.
 *
 * Every read here is best-effort by contract. A missing file, an unreadable one, a directory
 * that vanished between the listing and the read: all of them are "absent for this tick"
 * (`null` / `false` / `[]`) and never a thrown error, because the watcher polls this on an
 * interval and one bad directory must never cost the others their reading.
 */

/**
 * The name the runner's lock store goes by inside the default state root. Used ONLY to skip it
 * when listing run directories — it is a sibling of the runs, never one of them. Finding a lock
 * goes through {@link LOCK_DIR}, which is a different path for the reason recorded there.
 */
const LOCKS_DIR_NAME = 'locks';

/**
 * Where the runner's locks actually are — absolute, and deliberately NOT derived from whatever
 * state root this lane was pointed at.
 *
 * The runner hardcodes it. `state_lock.py:36-37` expands `~/.claude/state/runner` at IMPORT time
 * and joins `locks` onto it, and nothing under `hooks/plan_runner/` reads `PLAN_RUNNER_STATE_DIR`
 * at all — `scripts/runner_statusline.py:101` is that variable's only reader anywhere in the
 * runner, and it moves the RUN directories alone. So the env moves where runs are read from and
 * does not move where locks are written.
 *
 * Deriving this from `stateDir` was therefore symmetrical and wrong: point the env at a hermetic
 * tree and every lock lookup misses, every run falls back to its progress file, and every healthy
 * long phase reads `stale` — the exact failure the lock beat exists to prevent, arriving silently
 * and only under the configuration meant to be the safe one.
 *
 * No env of our own here, on purpose: the runner has none, and inventing one would be a second
 * answer to "where are the locks" that could disagree with the program that writes them.
 *
 * One lock per PLAN rather than per run (`state_lock.py:93-96`), which is why a lock is found by
 * hashing a plan path and not by naming a run.
 */
const LOCK_DIR = path.join(os.homedir(), '.claude', 'state', 'runner', 'locks');

/** One file's last reading, kept so an unchanged file is not decoded again on every 2 s tick. */
type CachedRead = {
  mtimeMs: number;
  size: number;
  /** The inode. `os.replace` over a fresh scratch file always lands a NEW one, so this catches a
   *  rewrite that happened to keep the same size inside the same millisecond — which mtime and
   *  size together cannot. It costs nothing: the same `statSync` already answered it. */
  ino: number;
  value: unknown;
};

const readCache = new Map<string, CachedRead>();

/** A non-empty string, or `null` — the descent convention (`descent.transport.ts:44-46`). */
export function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads a file through the cache, decoding it with `parse` only when its stat changed.
 *
 * The cache is keyed by absolute path and never evicted by age. A failed `stat` drops that one
 * file, which covers everything this lane keeps asking about; what it cannot cover is a file this
 * lane stops asking about, since a path never read again is never stat'd again. That is what
 * {@link pruneVanishedReads} is for, on both populations that go quiet — see it for which.
 */
function readCached(filePath: string, parse: (raw: string) => unknown): unknown {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    // Absent, or a directory that went away underneath us. Either way there is nothing to
    // remember about it, so the entry goes too — a file recreated later re-reads from scratch.
    readCache.delete(filePath);
    return null;
  }

  const cached = readCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size && cached.ino === stats.ino) {
    return cached.value;
  }

  let value: unknown = null;
  try {
    value = parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // A decode error mid-rewrite is NORMAL here, not a fault: the runner replaces
    // `progress.json` whole while we poll. `null` is cached against this exact stat so the same
    // bad bytes are not decoded again every tick, and the next rewrite changes the stat.
    value = null;
  }

  readCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino, value });
  return value;
}

/** A JSON object, or `null` for anything else — an array or a bare number is not a record. */
function parseJsonRecord(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

/**
 * Drops cached reads for files this lane will not ask about again.
 *
 * Two populations go quiet, for different reasons, and each needs its own retirement:
 *
 * - A RUN's files, retired by their directory no longer being listed. Scoped by grandparent so a
 *   cache shared with any other root — there is only one today — could never lose an entry this
 *   listing has no business judging.
 * - A LOCK, retired against a listing of {@link LOCK_DIR}. It cannot ride the run test: a lock is
 *   never one of the listed run directories, so that test would drop it on EVERY tick — the one
 *   file rewritten every 30 s, and precisely the read the cache exists to spare. Nor can it be
 *   left to its own failed `stat` in {@link readCached}, which only fires on a path still being
 *   read: `classifyRun` never asks for the lock of a receipted run (the ending is read first, and
 *   an ended run keeps its last written beat), so the moment a run finishes its lock entry stops
 *   being stat'd and would sit in the map for the life of the
 *   process — one object per plan ever run, small and unbounded, which is a leak however small.
 *
 * One `readdir` of a directory holding one file per active plan replaces the per-entry stats it
 * would otherwise take. A lock directory that cannot be listed is read as EMPTY rather than
 * skipped: being wrong that way costs a re-read on the next tick, while skipping would restore
 * the leak this exists to close.
 */
function pruneVanishedReads(root: string, liveRunDirs: Set<string>): void {
  let lockFiles: Set<string>;
  try {
    lockFiles = new Set(fs.readdirSync(LOCK_DIR));
  } catch {
    lockFiles = new Set();
  }

  for (const key of [...readCache.keys()]) {
    const dir = path.dirname(key);
    if (dir === LOCK_DIR) {
      if (!lockFiles.has(path.basename(key))) readCache.delete(key);
      continue;
    }
    if (path.dirname(dir) === root && !liveRunDirs.has(dir)) readCache.delete(key);
  }
}

/**
 * Every run directory under `stateDir`, sorted by name.
 *
 * `locks/` is the runner's own lock store, not a run, and is skipped by name; anything that is
 * not a directory is skipped by its dirent (the state dir carries loose files too). The sort
 * matches `runner_statusline.py:collect`, so two runs that started in the same second are
 * ordered the same way in the bar and in this lane.
 */
export function listRunDirs(stateDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch {
    return []; // no state dir yet ⇒ no runs, which is a fact and not a failure
  }

  const root = path.resolve(stateDir);
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== LOCKS_DIR_NAME)
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(root, name));

  pruneVanishedReads(root, new Set(dirs));
  return dirs;
}

/** The four files of one run directory, each absent-tolerant. */
export type RunnerRunFiles = {
  progress: unknown | null;
  run: unknown | null;
  /** True when a readable receipt is on disk — derived from `receipt`, never a second syscall (see `readRunFiles`). */
  hasReceipt: boolean;
  /** The receipt's record, or `null` when there is none. */
  receipt: unknown | null;
  logLines: string[];
};

/**
 * Reads one run directory's four files.
 *
 * `hasReceipt` is derived from the receipt READ, not from a second `existsSync`: the runner writes
 * a receipt atomically, so a record that reads is the whole signal and a file that does not is none.
 */
export function readRunFiles(dir: string): RunnerRunFiles {
  const logLines = readCached(path.join(dir, 'runner.log'), (raw) =>
    raw.split('\n').filter((line) => line.length > 0),
  );

  const receipt = readCached(path.join(dir, 'receipt.json'), parseJsonRecord);
  return {
    progress: readCached(path.join(dir, 'progress.json'), parseJsonRecord),
    run: readCached(path.join(dir, 'run.json'), parseJsonRecord),
    // ONE read decides both: the runner writes a receipt atomically (`state_lock.atomic_write`),
    // so it is either whole or absent — and a resume's rename landing between a separate
    // `existsSync` and this read would have painted one tick of a phantom `unknown` ending on a
    // run that is in fact restarting. A record that reads is a receipt; nothing else is.
    receipt,
    hasReceipt: receipt !== null,
    logLines: Array.isArray(logLines) ? (logLines as string[]) : [],
  };
}

/**
 * The heartbeat of the LOCK held for `planPath`, when that lock names `runId` — otherwise `null`.
 *
 * This is the lane's liveness signal, and it is not the one the terminal bar uses.
 * `progress.json.heartbeat_at` is set to "now" at `progress.py:185`, inside `_assemble`, which is
 * reached ONLY through `write` (`:139`, whose contract at `:141` is "Called after every stage
 * change") and written at `:151`. So the field advances on a stage change and at no other moment:
 * a perfectly healthy phase that spends twenty minutes in one fix-pass has a progress heartbeat
 * twenty minutes old. Aged against a fifteen-minute cut, that run reads stale while it is working
 * — measured on this host at 96 s of progress age against 6 s of lock age, on a phase whose own
 * budget is 5400 s.
 *
 * The lock is the honest beat: a daemon thread rewrites `heartbeat_at` every 30 s for as long as
 * it lives (`state_lock.py:239-250`, `HEARTBEAT_S = 30`), independently of what any phase is
 * doing. `follow` reads liveness the same way (`cmd/observe.py:140-141`).
 *
 * RESIDUE, named: that independence cuts both ways. The beat thread survives a run that is alive
 * but WEDGED — a phase blocked forever on a subprocess that never returns keeps its lock beaten
 * every 30 s, so this lane reads it `live` indefinitely, where aging the progress file would have
 * raised `stale` after 900 s. The trade is deliberate: a false `stale` on every long healthy
 * phase is constant and misleading, a wedge is rare, and `position.stage_since` is what still
 * shows it — a stage that has not moved in an hour is the cue this lane leaves the reader.
 *
 * The `run_id` match is the whole point of the check and not a formality. A lock is keyed by
 * PLAN, so the lock sitting at this path may belong to a LATER run of the same plan that took
 * over from this one; borrowing its beat would show a dead run as live forever. When no lock
 * names this run — every fixture, a crashed daemon, a run whose lock was released — the caller
 * falls back to the progress file, and that run is judged by its own last write, which is then a
 * real lapse rather than an artefact.
 *
 * `realpath` mirrors `lock_path` exactly (`state_lock.py:93-96`): the runner hashes the RESOLVED
 * plan path so two symlinks to one plan share one lock, and a hash of the unresolved spelling
 * would simply miss the file and silently degrade every symlinked plan to the fallback.
 *
 * Takes no state root, because a lock's location does not depend on one — see {@link LOCK_DIR}.
 */
export function readRunLockBeat(planPath: string, runId: string): number | null {
  let resolvedPlanPath: string;
  try {
    resolvedPlanPath = fs.realpathSync(planPath);
  } catch {
    return null; // the plan went away between the existence check and here ⇒ no lock to find
  }

  const key = crypto.createHash('sha256').update(resolvedPlanPath, 'utf8').digest('hex').slice(0, 16);
  const lock = readCached(path.join(LOCK_DIR, `${key}.json`), parseJsonRecord);
  if (lock === null) return null;

  const record = lock as Record<string, unknown>;
  if (record.run_id !== runId) return null;

  const beat = record.heartbeat_at;
  return typeof beat === 'number' && Number.isFinite(beat) ? beat : null;
}
