// `file_age {path}` — how long since a file was written. `path` is a file, or a directory whose
// newest regular file (directly inside it, symlinks and subdirectories not counted) is the one
// measured. Metric: `age` in seconds. `pass` is required — what age is too old is the whole
// definition — so a spec without one is judged unreadable rather than quietly ok.
//
// A `*.partial` file in a directory is a write in progress or a write that died, never a finished
// file, and is not counted: `docstore/bin/backup` writes `<name>.partial` and renames it onto
// `<name>` only after pg_dump exits 0, and a pg_dump that fails — even on a refused login — leaves
// a fresh empty `.partial` behind. Counting it would make a backup that fails every night read as
// written just now.
//
// The run keeps the file it found, `{ name, mtimeMs }`, in `memory.kept` (and drops it when the
// read did not complete): its age is then the clock's alone until the file changes, and the
// scheduler ages it to any instant without reading (`aged`, `watched-probe.mjs`).

import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { TIMED_OUT, deadlineMs, elapsedMs, finishProbe, formatSeconds, missingField, unrunnable, withDeadline } from '../probe-support.mjs';

export const PARTIAL_SUFFIX = '.partial';

// A file can be renamed away between listing a directory and reading its stat — a backup moving
// `x.partial` onto `x` does exactly that — so a vanished entry is skipped, not an error.
async function statIfPresent(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function newestRegularFile(path) {
  const info = await statIfPresent(path);
  if (!info) return null;
  if (info.isFile()) return { name: basename(path), mtimeMs: info.mtimeMs };
  if (!info.isDirectory()) return null;

  const entries = await readdir(path, { withFileTypes: true });
  const finished = entries.filter((entry) => entry.isFile() && !entry.name.endsWith(PARTIAL_SUFFIX));
  const files = await Promise.all(finished.map(async (entry) => {
    const entryInfo = await statIfPresent(join(path, entry.name));
    return entryInfo ? { name: entry.name, mtimeMs: entryInfo.mtimeMs } : null;
  }));
  // Name breaks a same-millisecond tie so the file reported does not change between runs.
  const present = files.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  return present[0] ?? null;
}

function describeAge(seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
}

export async function run(spec, memory) {
  const missing = missingField(spec, ['path']);
  if (missing) {
    forget(memory);
    return unrunnable(spec, missing);
  }

  const startedAt = performance.now();
  let found;
  try {
    found = await withDeadline(newestRegularFile(spec.path), deadlineMs(spec));
  } catch (error) {
    forget(memory);
    const tookMs = elapsedMs(startedAt);
    return finishProbe(spec, {
      completed: false,
      sentence: `Cannot read ${spec.path} (${error.code ?? error.name})`,
      data: { error: error.code ?? error.name },
    }, tookMs);
  }
  const tookMs = elapsedMs(startedAt);

  if (found === TIMED_OUT || !found) forget(memory);
  if (found === TIMED_OUT) {
    return finishProbe(spec, {
      completed: false,
      sentence: `No answer within ${formatSeconds(spec.timeout)}`,
      data: { error: 'timeout' },
    }, tookMs);
  }
  if (!found) {
    return finishProbe(spec, { completed: false, sentence: `No file in ${spec.path}`, data: { error: 'no-file' } }, tookMs);
  }

  if (memory) memory.kept = found;
  return judgedAge(spec, found, Date.now(), tookMs);
}

/** The kept file's reading at `nowMs`, as a read then would make it. Consumer: `watched-probe.mjs`. */
export function aged(spec, kept, nowMs) {
  return judgedAge(spec, kept, nowMs, 0);
}

/** The line the `age` metric grows on: zero at the file's mtime, one per second. Consumer: `watched-probe.mjs`'s `flipAt`. */
export function agingOf(_spec, kept) {
  return { metric: 'age', zeroAtMs: kept.mtimeMs, msPerUnit: 1000 };
}

function judgedAge(spec, kept, nowMs, tookMs) {
  // A mtime a little in the future (clock skew between writer and reader) is a file written just now.
  const age = Math.max(0, Math.round((nowMs - kept.mtimeMs) / 1000));
  return finishProbe(spec, {
    completed: true,
    sentence: `Newest file written ${describeAge(age)} ago (${kept.name})`,
    metrics: { age },
    data: { age, file: kept.name },
  }, tookMs);
}

function forget(memory) {
  if (memory) delete memory.kept;
}
