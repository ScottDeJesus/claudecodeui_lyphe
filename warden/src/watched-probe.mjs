// Watched probes: a probe whose reading changes only when a file does, and otherwise only with the
// clock. `file_age` is one by nature (its age grows with time and starts over when the file is
// written); an `exec` probe is one when its definition says so: `watch` names the file the command
// reads and `ages` the unit its leading number counts ("5.0 h since the newest copy").
//
// The scheduler (`probes.mjs`) reads such a probe at start, on a change of its file, and at the
// instant its kept reading, aged, would cross a bound its `pass` or `warn` compares to: the moments
// its status can move, computed from the reading, never polled. Between them its every-seconds turn
// re-sends the kept reading aged to now (`agedOutcome`) and reads nothing.
//
// The watch is on a directory: a directory probe's own, or a file's parent filtered to its name, so a
// writer that renames a finished file into place is heard. A `.partial` name is a write in progress
// and is not a change (INV-7017); the read itself still skips it.

import { statSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';

import { boundsOf } from './expr.mjs';
import { log } from './log.mjs';
import { aged as agedExec, agingOf as agingOfExec } from './probe-kinds/exec.mjs';
import { PARTIAL_SUFFIX, aged as agedFileAge, agingOf as agingOfFileAge } from './probe-kinds/file-age.mjs';
import { waitFor } from './probe-support.mjs';

// A write is several events (open, write, rename): two quiet seconds make them one read.
const SETTLE_MS = 2000;
// A file rewritten without pause must not turn the watch into a read loop.
const READ_SPACING_MS = 30_000;
// A flip is read a second past its instant, so the rounding of the metric the read makes has crossed too.
const FLIP_PAD_MS = 1000;

// A Map, as the scheduler's KIND_RUNNERS: per kind, the reading aged to an instant and the line its metric grows on.
const AGED_KINDS = new Map([
  ['file_age', { aged: agedFileAge, agingOf: agingOfFileAge }],
  ['exec', { aged: agedExec, agingOf: agingOfExec }],
]);

/** Where `spec`'s watch listens: `{ dir, name }` (`name` null for a directory watched as itself), or null for a probe that is not watched. */
export function watchTarget(spec) {
  const path = watchedPath(spec);
  if (path === null) return null;
  return isDirectory(path) ? { dir: path, name: null } : { dir: dirname(path), name: basename(path) };
}

/** The kept reading aged to `nowMs`, as a read then would say it (`{ status, value, data, tookMs }`), or null when nothing is kept. */
export function agedOutcome(spec, kept, nowMs) {
  const kind = AGED_KINDS.get(spec.kind);
  return kind && kept ? kind.aged(spec, kept, nowMs) : null;
}

/** The instant (epoch ms) the kept reading's aged metric reaches the least bound of `pass` or `warn` above it now, or null when none is ahead. */
export function flipAt(spec, kept, nowMs = Date.now()) {
  const kind = AGED_KINDS.get(spec.kind);
  if (!kind || !kept) return null;
  const { metric, zeroAtMs, msPerUnit } = kind.agingOf(spec, kept);
  const current = (nowMs - zeroAtMs) / msPerUnit;
  const ahead = boundsOf(spec, metric).filter((bound) => bound > current);
  return ahead.length === 0 ? null : zeroAtMs + Math.min(...ahead) * msPerUnit;
}

/**
 * The watch one scheduled probe holds, and its two waits: the read after a change and the read at the
 * next flip. `read` and `readAndSend` are the scheduler's; it tells the watch when each of its reads
 * starts and ends, so a change or a flip that falls due during a read is read after it, never beside it.
 * Returns `{ open(), openedSinceRead(), readStarted(), readEnded(kept, nowMs), close() }`; `open` is safe to call
 * on every turn, which is how a watch that failed or was lost is tried again. The target is resolved at
 * every open: a folder that did not exist yet is watched in its parent for its name, and when that name
 * is heard as a folder the watch moves into it. fs.watch holds the directory's inode and goes silent,
 * with no 'error', when the directory is removed, so every rename event checks the directory is still
 * the one watched (its inode and birth time), and a removed or replaced one is a lost watch, reopened at once.
 */
export function createWatch(spec, { read, readAndSend }) {
  let target = null; // resolved afresh at every open (`watchTarget`)
  let identity = null; // the watched directory's inode and birth time, so one removed and made again is noticed
  const settle = { timer: null };
  const flip = { timer: null };
  let watcher = null;
  let failedCode = null; // so a watch that cannot open is logged once, not every turn
  let closed = false;
  let reading = false;
  let owed = null; // 'change' or 'flip': a wait that fell due while a read was going
  let lastReadEndedAt = -Infinity;
  // A watch opened since the last read began has heard nothing of the writes before it: the next turn must read.
  let openedSinceRead = false;

  function changeHeard() {
    if (reading) {
      owed ??= 'change';
      return;
    }
    clearTimeout(settle.timer);
    const waitMs = Math.max(SETTLE_MS, lastReadEndedAt + READ_SPACING_MS - Date.now());
    waitFor(settle, waitMs, () => {
      settle.timer = null;
      if (reading) owed ??= 'change';
      else read();
    });
  }

  function flipDue() {
    flip.timer = null;
    if (reading) owed = 'flip';
    else readAndSend();
  }

  function lose(error) {
    log(`probe ${spec.key}: lost its watch of ${target.dir} (${error?.code ?? error?.name ?? 'unknown'})`);
    watcher?.close();
    watcher = null;
  }

  function open() {
    if (closed) return false;
    if (watcher) return true;
    target = watchTarget(spec);
    if (!target) return false;
    try {
      watcher = watch(target.dir, { persistent: false }, heard);
      identity = identityOf(statSync(target.dir));
    } catch (error) {
      watcher?.close();
      watcher = null;
      const code = error?.code ?? error?.name ?? 'unknown';
      if (code !== failedCode) log(`probe ${spec.key}: cannot watch ${target.dir} (${code}); its turns read until it can`);
      failedCode = code;
      return false;
    }
    watcher.on('error', lose);
    failedCode = null;
    openedSinceRead = true;
    log(`probe ${spec.key}: watching ${target.dir}${target.name ? ` for ${target.name}` : ''}`);
    return true;
  }

  function heard(event, filename) {
    if (event === 'rename' && !isStillWatched()) {
      lose({ code: 'removed' });
      open();
      changeHeard();
      return;
    }
    if (target.name !== null && filename !== null && filename !== undefined && String(filename) === target.name) {
      const next = watchTarget(spec);
      if (next && (next.dir !== target.dir || next.name !== target.name)) {
        watcher?.close();
        watcher = null;
        open();
      }
    }
    if (isChangeOf(target, filename)) changeHeard();
  }

  function isStillWatched() {
    try {
      return identityOf(statSync(target.dir)) === identity;
    } catch (error) {
      if (typeof error?.code === 'string') return false;
      throw error;
    }
  }

  return {
    open,
    openedSinceRead: () => openedSinceRead,
    readStarted() {
      reading = true;
      openedSinceRead = false;
    },
    readEnded(kept, nowMs) {
      reading = false;
      if (closed) return;
      lastReadEndedAt = nowMs;
      clearTimeout(flip.timer);
      flip.timer = null;
      const at = flipAt(spec, kept, nowMs);
      if (at !== null) waitFor(flip, Math.max(0, at + FLIP_PAD_MS - nowMs), flipDue);
      const due = owed;
      owed = null;
      if (due === 'flip') readAndSend();
      else if (due === 'change') changeHeard();
    },
    close() {
      closed = true;
      watcher?.close();
      watcher = null;
      clearTimeout(settle.timer);
      clearTimeout(flip.timer);
    },
  };
}

function watchedPath(spec) {
  const path = spec.kind === 'file_age' ? spec.path : spec.kind === 'exec' && spec.ages ? spec.watch : null;
  return typeof path === 'string' && path !== '' ? path : null;
}

// A path that cannot be read yet is watched as a file: its parent hears it arrive.
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (typeof error?.code === 'string') return false;
    throw error;
  }
}

// The inode alone is not enough: a folder removed and made again at once is given the same inode
// number (measured on eis1's ext4), and only its birth time tells the two apart.
function identityOf(info) {
  return `${info.ino}:${info.birthtimeMs}`;
}

function isChangeOf(target, filename) {
  if (filename === null || filename === undefined) return true; // a platform that names no file: any event may be it
  const name = String(filename);
  if (name.endsWith(PARTIAL_SUFFIX)) return false;
  return target.name === null || name === target.name;
}

