/**
 * `check.json`: what the last check read, in the one file that outlives the process that read it.
 *
 * A check is cheap but not free (two registry calls, and a changelog that can be 840 KB), so its
 * result is stored rather than held in memory alone: the API restarts on every server save and on
 * every handover, and a fresh process that answered "nothing is known" until its first tick would
 * show every card blank for the first five seconds of every restart.
 *
 * The shape here is this FILE's, not a wire contract — the wire is `claude-update-types.ts`, and this
 * is the module's own memory of what npm said. Two readers share it: the check service (which fills
 * it) and the report (which renders it), which is why it is a file of its own rather than a type
 * hidden inside either.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ClaudeUpdateNote } from '@/shared/claude-update-types.js';

const CHECK_FILE = 'check.json';

/** What one package's last good check left behind: the version npm named, and the notes beside it. */
export type PackageCheck = {
  /** The npm dist-tag `latest` at that check. Null means no check has ever read this package. */
  latest: string | null;
  /** Why `latest` is what it is: the registry read's failure in words, or null when it answered. The
   *  CLI's and the SDK's are separate, so a check that lost both names each package on its own row. */
  latestError: string | null;
  /**
   * The installed version the notes below were windowed FROM, so the window is `(windowFrom, latest]`.
   *
   * Stored because the window has to fit the install a report will render it for, and the install
   * moves on its own: one that moves DOWN (a rollback, a hand-installed older build) leaves the stored
   * notes starting too high — a short set the next check re-derives, once it can see that the floor it
   * was built for is not the floor it is being asked for. Null means nothing could read the install
   * when the notes were read, which is a set no window can be trusted from.
   */
  windowFrom: string | null;
  /**
   * The changelog sections between `windowFrom` and `latest`, newest first, capped. The report windows
   * this again against what is installed at the moment it answers, so a reader is never shown more
   * than this set holds and never LESS either — unless the install moved under the window, which is
   * what a check compares `windowFrom` against and re-reads for.
   */
  notes: ClaudeUpdateNote[];
  /** Why the notes are missing or short, in the changelog's own words, or null. */
  notesError: string | null;
};

/** The CLI's row of the same, plus the two facts only a globally installed package has. */
export type CliPackageCheck = PackageCheck & {
  /** Whether `npm install -g` is the way to move this host's CLI (packages.ts decides). */
  updatable: boolean;
  /** Why it is not, in plain words, or null. */
  updatableReason: string | null;
};

/** One attempt's whole result, as stored. */
export type StoredCheck = {
  /** When the ATTEMPT ran — a failed attempt counts, so a check that cannot succeed is not retried
   *  on every tick. Null means no attempt has run in this file's lifetime. */
  checkedAt: number | null;
  /** That attempt's failure in words, or null when it read cleanly. */
  error: string | null;
  cli: CliPackageCheck;
  sdk: PackageCheck;
};

/**
 * The state before anything has been checked: no version, no notes, and a CLI that has not been
 * proven updatable here.
 *
 * `updatable` starts false rather than true because it is a permission the pipeline grants itself
 * after looking, and the safe direction for a permission is "not yet". Nothing renders it as a claim
 * anyway: with no `latest` there is no update to offer, so the button it guards is not shown.
 */
function emptyCheck(): StoredCheck {
  return {
    checkedAt: null,
    error: null,
    cli: {
      latest: null,
      latestError: null,
      windowFrom: null,
      notes: [],
      notesError: null,
      updatable: false,
      updatableReason: null,
    },
    sdk: { latest: null, latestError: null, windowFrom: null, notes: [], notesError: null },
  };
}

/** Whether a value read off disk is one note. Anything else is dropped rather than trusted. */
function isNote(value: unknown): value is ClaudeUpdateNote {
  const note = (value ?? {}) as Partial<ClaudeUpdateNote>;
  return typeof note.version === 'string' && typeof note.body === 'string';
}

/** One package's stored fields, with every missing or wrong-typed one taking the empty default. */
function readPackageCheck(value: unknown): PackageCheck {
  const shape = (value ?? {}) as Partial<PackageCheck>;
  return {
    latest: typeof shape.latest === 'string' ? shape.latest : null,
    latestError: typeof shape.latestError === 'string' ? shape.latestError : null,
    windowFrom: typeof shape.windowFrom === 'string' ? shape.windowFrom : null,
    notes: Array.isArray(shape.notes) ? shape.notes.filter(isNote) : [],
    notesError: typeof shape.notesError === 'string' ? shape.notesError : null,
  };
}

/** The CLI's stored fields, over the same defaults plus its own two. */
function readCliCheck(value: unknown): CliPackageCheck {
  const shape = (value ?? {}) as Partial<CliPackageCheck>;
  return {
    ...readPackageCheck(value),
    updatable: shape.updatable === true,
    updatableReason: typeof shape.updatableReason === 'string' ? shape.updatableReason : null,
  };
}

/** Whether a stored `checkedAt` is a time this clock has reached. A number in the future is not one:
 *  no check this host ran can have stamped a moment that has not arrived yet. */
function isCheckedAt(value: unknown): value is number {
  return typeof value === 'number' && value <= Date.now();
}

/**
 * The stored check, or the empty one.
 *
 * Every unreadable state reads the same way — absent, not JSON, or a shape from some other build —
 * because there is exactly one honest answer to all of them: nothing is known yet, and the cards will
 * say so until a check has run. A file written by a hand or a build this one does not recognise is
 * therefore never trusted field by field; it is dropped whole.
 *
 * A `checkedAt` the clock has NOT reached yet is read as no check at all, rather than as a check. A
 * clock that stepped back between the write and this read (a resume from suspend, NTP, a file copied
 * from a host whose clock runs ahead) would otherwise park the cadence until real time caught up with
 * a stamp made in a future that no longer exists — up to the size of the step, with `nextCheckAt`
 * counting down to it the whole while. A check that reruns is the safe direction, and it re-stamps.
 */
export function readStoredCheck(dir: string): StoredCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, CHECK_FILE), 'utf8'));
  } catch {
    return emptyCheck();
  }

  const shape = (parsed ?? {}) as { checkedAt?: unknown; error?: unknown; cli?: unknown; sdk?: unknown };
  return {
    checkedAt: isCheckedAt(shape.checkedAt) ? shape.checkedAt : null,
    error: typeof shape.error === 'string' ? shape.error : null,
    cli: readCliCheck(shape.cli),
    sdk: readPackageCheck(shape.sdk),
  };
}

/**
 * Writes the check: a fully written temp file first, then a rename over `check.json`, so a reader
 * sees the previous check whole or this one whole and never a half-written file. The same write
 * `update-job.ts` makes for the job, for the same reason, and the temp name carries this process's
 * pid so two writers cannot collide on it.
 *
 * The directory is created when it is not there. In production `claudeUpdatesDir()` has already made
 * it, but this file is the one that decides what the pipeline's memory looks like on disk, and it
 * should not depend on somebody else having done that first.
 */
export function writeStoredCheck(dir: string, check: StoredCheck): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, CHECK_FILE);
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(check, null, 2), { mode: 0o600 });
  fs.renameSync(temp, target);
}
