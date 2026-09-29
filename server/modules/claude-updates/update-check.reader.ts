/**
 * One package's check, read from the world: the newest version npm names, and the notes that go with
 * it.
 *
 * This is the half of a check that talks to something outside this host, and it is kept apart from
 * the service that schedules and stores checks for one reason: everything here is a question with a
 * failure answer — a registry that cannot be reached, a changelog that says 404 — and none of those
 * failures may cost the facts already read. So every path returns a value, none throws, and the part
 * of a check that stands is always the part that answered.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ClaudeUpdateNote, ClaudeUpdatePackageKey } from '@/shared/claude-update-types.js';
import { isBehindInstalled } from '@/shared/version-order.js';

import { fetchChangelog, notesBetween } from './changelog.js';
import { packageRow, readCliUpdatable } from './packages.js';
import type { CliPackageCheck, PackageCheck } from './update-check.store.js';

const execFileAsync = promisify(execFile);

/**
 * The ceiling on `npm view`. The same 30 s the package table allows `npm root -g`: this is a
 * registry call on a command that exits in under a second when the network is well, and the ceiling
 * exists for a registry that has stopped answering rather than one that is slow.
 */
const NPM_VIEW_TIMEOUT_MS = 30_000;

/**
 * npm's own patience, set so that npm always speaks before the ceiling above does.
 *
 * npm holds its whole `npm error …` block back until it has given up by itself, and with its defaults
 * against an unreachable registry that takes tens of seconds (two retries, each waiting out a
 * `fetch-retry-mintimeout` that starts at ten). A check killed at 30 s would then have an empty stderr
 * and only execFile's own `Command failed: …` left to report — the one outcome where the wording says
 * nothing about why. One attempt, ten seconds, puts npm's own cause (`ECONNREFUSED`, `FETCH_ERROR`, a
 * proxy's refusal) well inside the ceiling: measured 10.2 s against a socket that accepts and never
 * answers, and 0.2 s against a refused port. The price is that a registry seen mid-blip fails this
 * check instead of the next attempt — half an hour's wait, or the button that asks for one now.
 */
const NPM_FETCH_TIMEOUT_MS = 10_000;

/**
 * How many notes one package may store.
 *
 * A section count, not a byte bound — the newest 300 sections of the CLI's changelog serialize to
 * roughly 800 KiB, and this does not stop that. What it stops is a window that grows with the whole
 * history: the newest sections are the ones kept, so the cap bites only for an install hundreds of
 * releases behind, and the note for `latest` — the one thing a report needs to call a changelog
 * current — can never be the note dropped.
 */
const NOTES_CAP = 300;

/**
 * The first line npm itself called an error; else why a child had to be stopped; else the first line
 * it printed; else words.
 *
 * npm prints `npm error <what went wrong>` on every line of a real failure, and the first is the one
 * worth showing — which is what the fetch timeout above exists to make sure this host gets to read. A
 * kill that still reaches the child (a registry that answers on a trickle, past even npm's patience)
 * is reported as the fact it is rather than as execFile's `Command failed: …`, which names the command
 * and never the cause. With no output at all — `npm` not on this host's PATH, a spawn that failed
 * outright — the error's own message is the whole story.
 */
function npmFailureLine(error: unknown): string {
  const shape = error as { stderr?: unknown; killed?: unknown; signal?: unknown } | null;
  const stderr = shape?.stderr;
  const printed = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '';
  const message = error instanceof Error ? error.message : String(error);
  const lines = (printed.trim() || message)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const npmErrorLine = lines.find((line) => line.startsWith('npm error'));
  if (npmErrorLine !== undefined) return npmErrorLine;
  if (shape?.killed === true || typeof shape?.signal === 'string') {
    return `npm did not answer within ${NPM_VIEW_TIMEOUT_MS / 1000} s and was stopped`;
  }
  return lines[0] ?? 'npm said nothing';
}

/**
 * The version npm calls `latest` for one package.
 *
 * The cwd is the repository, so a `.npmrc` beside it is honoured; stdout is parsed as JSON because
 * that is what `--json` promises, and a dist-tag answers as a bare string (`"2.1.284"`).
 *
 * The two `npm_config_*` variables are the child's only difference from this process's environment,
 * and they are set HERE rather than by argv so the command stays the one line it is everywhere else —
 * a `.npmrc` can set neither, because these outrank it.
 */
async function readLatestFromNpm(name: string, appRoot: string): Promise<{ latest: string } | { error: string }> {
  let stdout: string;
  try {
    const result = await execFileAsync('npm', ['view', name, 'dist-tags.latest', '--json'], {
      cwd: appRoot,
      timeout: NPM_VIEW_TIMEOUT_MS,
      env: {
        ...process.env,
        npm_config_fetch_timeout: String(NPM_FETCH_TIMEOUT_MS),
        npm_config_fetch_retries: '0',
      },
    });
    stdout = result.stdout;
  } catch (error) {
    return { error: npmFailureLine(error) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return { error: `npm printed ${JSON.stringify(stdout.trim().slice(0, 120))} instead of a version` };
  }
  if (typeof parsed !== 'string' || parsed.length === 0) {
    return { error: `npm answered with ${JSON.stringify(parsed).slice(0, 120)}, not a version` };
  }
  return { latest: parsed };
}

/**
 * Whether the changelog has to be read again.
 *
 * Three ways to need it, and no others. The newest version MOVED, so there is something new to show.
 * The floor the stored window was built from moved — and only downward. An install that fell BELOW
 * its window's floor is owed sections the window does not hold, and only a fresh read widens it; an
 * install that moved up needs nothing, because the stored set is still wider than that reader needs
 * and the report narrows it. A null floor is re-derived once, which is what heals the files this
 * field arrived after and the windows a check built with no install reading. Or an update is ON OFFER
 * and the notes still do not reach it — a changelog that lags npm by a release, retried once per
 * check, because the lag is measured in minutes and a check runs at most every half hour.
 *
 * Nothing else reads it. A host already ON the newest version in particular does not: there is
 * nothing to offer it, and reading hundreds of kilobytes per check to keep notes nobody is shown is
 * what this test, the floor and the cap are all here to prevent.
 */
function needsChangelog(previous: PackageCheck, latest: string, installed: string | null): boolean {
  if (previous.latest !== latest) return true;
  if (installed === null) return false;
  const fellBelowFloor = previous.windowFrom === null || isBehindInstalled(installed, previous.windowFrom);
  if (fellBelowFloor) return true;
  const notesCoverLatest = previous.notes.some((note) => note.version === latest);
  return isBehindInstalled(installed, latest) && !notesCoverLatest;
}

/**
 * The sections one check stores: everything this install has not lived through, capped, newest first.
 *
 * An install that could not be read has no lower bound to window from, so the sections are kept from
 * the top of the file: that is the set a report could still window if the reading recovers before the
 * next check, and the next check re-derives it the moment a reading is in hand. The floor this set was
 * built from is stored beside it (`windowFrom`), which is what lets a later check see that the install
 * moved and widen the window rather than keep serving a short one.
 */
function windowOf(notes: ClaudeUpdateNote[], installed: string | null, latest: string): ClaudeUpdateNote[] {
  const window = installed === null ? notes : notesBetween(notes, installed, latest);
  return window.slice(0, NOTES_CAP);
}

/** What one package's check needs: where to run npm, which package, what was stored, and what is
 *  installed right now — the window's lower bound, or null when nothing could read it. */
type PackageCheckRequest = {
  appRoot: string;
  key: ClaudeUpdatePackageKey;
  previous: PackageCheck;
  installed: string | null;
};

/**
 * One package, checked: the newest version, and the notes between the installed version and it.
 *
 * A failed registry read returns the previous FIELDS untouched and the failure in words — the caller
 * stores the words and keeps what it had, which is what "the last good fields stand" means. The words
 * ride on the row too (`latestError`), so a check that lost both reads names each package on its own
 * card instead of naming whichever one failed first. A failed CHANGELOG read is not a failed check:
 * the version was read, so it is stored, and the notes simply come back short with the reason beside
 * them.
 */
export async function readPackageCheck(
  request: PackageCheckRequest,
): Promise<{ next: PackageCheck; error: string | null }> {
  const row = packageRow(request.key);

  const read = await readLatestFromNpm(row.name, request.appRoot);
  if ('error' in read) {
    const error = `npm could not read ${row.name}: ${read.error}`;
    return { next: { ...request.previous, latestError: error }, error };
  }

  if (!needsChangelog(request.previous, read.latest, request.installed)) {
    // Nothing here was worth a fresh read — the notes already cover this version, or there is nothing
    // on offer for the install being checked, which is a host already on the newest version and owed
    // no notes at all. Either way an earlier changelog failure is answered rather than carried, and
    // `windowFrom` rides along untouched, because these notes are still that window's.
    return {
      next: { ...request.previous, latest: read.latest, latestError: null, notesError: null },
      error: null,
    };
  }

  const fetched = await fetchChangelog(row.changelogRawUrl);
  if ('error' in fetched) {
    // The version was read, so it stands. The notes come back as they were with the failure beside
    // them, and the floor stays where it was: what is stored was windowed from that floor, not now.
    return {
      next: { ...request.previous, latest: read.latest, latestError: null, notesError: fetched.error },
      error: null,
    };
  }

  return {
    next: {
      latest: read.latest,
      latestError: null,
      windowFrom: request.installed,
      notes: windowOf(fetched.notes, request.installed, read.latest),
      notesError: null,
    },
    error: null,
  };
}

/**
 * The CLI's two `updatable` fields for one check, with a throw turned into words.
 *
 * `readCliUpdatable()` answers in words rather than throwing, so this exists for the one path it does
 * not cover — naming the binary a run would spawn. A check that lost BOTH versions because deciding
 * whether one of them could be installed failed would be the worst of the two outcomes, and this is
 * the four lines that make sure it cannot happen.
 */
export async function readCliUpdatableForCheck(): Promise<Pick<CliPackageCheck, 'updatable' | 'updatableReason'>> {
  try {
    const answer = await readCliUpdatable();
    return { updatable: answer.updatable, updatableReason: answer.reason };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      updatable: false,
      updatableReason: `whether the Claude CLI can be updated here could not be decided: ${detail}`,
    };
  }
}
