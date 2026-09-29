/**
 * The report's composition: three versions per package, and the notes between two of them.
 *
 * Kept apart from the check service for one reason, and it is the reason it exists at all: this is
 * the half that has to agree with the client field for field (`claude-update-types.ts`), while the
 * service's half is a cadence and a file. What changes together — a field added to a package, a
 * sentence reworded — changes here, and `report()` in the service is then one call wide.
 *
 * Every version in here comes from a place of its own and none is inferred from another: what is on
 * disk, what THIS process imported, and what npm last answered.
 */

import type {
  ClaudeUpdateJob,
  ClaudeUpdateNote,
  ClaudeUpdatePackage,
  ClaudeUpdatesReport,
} from '@/shared/claude-update-types.js';
import { isBehindInstalled } from '@/shared/version-order.js';

import { notesBetween } from './changelog.js';
import { LOADED_SDK_VERSION, packageRow } from './packages.js';
import type { CliPackageCheck, PackageCheck, StoredCheck } from './update-check.store.js';

/** The two rows, resolved once: `cli` first, which is the order every report keeps. */
const CLI = packageRow('cli');
const SDK = packageRow('sdk');

/** The installed CLI as this module reads it — the reading's own words included. */
export type InstalledCliReading = { version: string | null; reason: string | null };

/** Everything one report is built from: the stored check, the readings taken for THIS answer, and
 *  the two facts the module knows and the check service does not. */
type ReportInput = {
  check: StoredCheck;
  /** True while a check is in flight in this process. */
  checking: boolean;
  /** When the next check is due, or null before the first one. */
  nextCheckAt: number | null;
  /** The installed CLI, read for this answer. */
  cli: InstalledCliReading;
  /** The SDK's package.json in this repository, read for this answer. */
  sdkInstalled: string | null;
  /** The current job, or the last one, as the module read it. */
  job: ClaudeUpdateJob | null;
  /** Whether this API can hand itself over. */
  supervised: boolean;
};

/** Whether an update is there: both versions known, and the installed one BEHIND the newest. Order,
 *  never equality — a differing pair is not an update, and `version-order.ts` owns that rule. */
function isUpdateAvailable(installed: string | null, latest: string | null): boolean {
  return installed !== null && latest !== null && isBehindInstalled(installed, latest);
}

/** Why a row has no newest version to compare against, in the words of the read that failed for THIS
 *  package. A check that has never run and a check that failed read differently, and both read as
 *  something: a check that lost both registry reads names each package on its own row. */
function noLatestReason(check: StoredCheck, own: PackageCheck): string {
  if (check.checkedAt === null) return 'the first check has not run yet';
  return own.latestError ?? check.error ?? 'npm has not answered with a version for this package yet';
}

/** The notes a reader on `installed` is shown: the stored window, narrowed to where they are now. */
function notesFor(check: PackageCheck, installed: string | null, latest: string | null): ClaudeUpdateNote[] {
  if (installed === null || latest === null) return [];
  return notesBetween(check.notes, installed, latest);
}

/**
 * Why the notes are short, or null when they are not. Set only while an update is available — a null
 * `latest` IS no update, so there is nothing to be short of.
 *
 * Three ways to be short, and each one is named where it is seen. The notes may not reach `latest` —
 * a changelog that lags npm, or a read that failed, whose own words are kept beside them. Or the
 * window's floor may sit ABOVE the install being answered: a rollback leaves that, the notes start
 * higher than the releases this reader is owed, and it lasts only until the next check re-derives the
 * window. Or nothing was ever read for this package at all, which is a host whose install could not be
 * read back when its checks ran. The floor is tested BEFORE the "no entry" line for the second case's
 * sake: notes that start too high are missing sections a changelog may well hold, and saying it has no
 * entry for `latest` would be a falsehood the reader has no way to see through.
 */
function notesReasonFor(check: PackageCheck, installed: string | null, latest: string | null): string | null {
  if (installed === null || latest === null) return null;
  const floor = check.windowFrom;
  const shortWindow =
    floor !== null && isBehindInstalled(installed, floor)
      ? `the notes were read for an install on ${floor} — the next check reads the rest`
      : null;
  if (!check.notes.some((note) => note.version === latest)) {
    if (check.notesError !== null) return `the changelog could not be read: ${check.notesError}`;
    if (shortWindow !== null) return shortWindow;
    if (check.notes.length === 0) return 'the changelog has not been read for this package yet';
    return `the changelog has no entry for ${latest} yet`;
  }
  return shortWindow;
}

/**
 * The CLI's one `reason` line, in the order a person can act on it: what could not be read at all
 * first, then what npm has not answered, then why this pipeline will not install it.
 */
function cliReason(input: ReportInput, check: CliPackageCheck): string | null {
  if (input.cli.version === null) return input.cli.reason;
  if (check.latest === null) return noLatestReason(input.check, check);
  return check.updatable ? null : check.updatableReason;
}

/**
 * The CLI's row. `loaded` is always null: each conversation announces its own CLI version, and
 * `/api/cli-version` is where that is read — this process loads no CLI of its own.
 */
function cliPackage(input: ReportInput): ClaudeUpdatePackage {
  const check = input.check.cli;
  const installed = input.cli.version;
  const updateAvailable = isUpdateAvailable(installed, check.latest);
  return {
    key: CLI.key,
    name: CLI.name,
    label: CLI.label,
    installed,
    loaded: null,
    latest: check.latest,
    updateAvailable,
    updatable: check.updatable,
    reason: cliReason(input, check),
    notes: notesFor(check, installed, check.latest),
    notesReason: updateAvailable ? notesReasonFor(check, installed, check.latest) : null,
    changelogUrl: CLI.changelogUrl,
  };
}

/**
 * The SDK's row. `installed` is read fresh from this repository's `node_modules` and `loaded` is what
 * THIS process imported at boot, which is why the two can differ and why the client says so in words
 * when they do.
 *
 * `updatable` is true unconditionally: this repository pins the SDK in its own package.json, so
 * installing it here is always something the pipeline can do.
 */
function sdkPackage(input: ReportInput): ClaudeUpdatePackage {
  const check = input.check.sdk;
  const installed = input.sdkInstalled;
  const updateAvailable = isUpdateAvailable(installed, check.latest);
  return {
    key: SDK.key,
    name: SDK.name,
    label: SDK.label,
    installed,
    loaded: LOADED_SDK_VERSION,
    latest: check.latest,
    updateAvailable,
    updatable: true,
    reason:
      installed === null
        ? 'the Claude Agent SDK package could not be read from this repository'
        : check.latest === null
          ? noLatestReason(input.check, check)
          : null,
    notes: notesFor(check, installed, check.latest),
    notesReason: updateAvailable ? notesReasonFor(check, installed, check.latest) : null,
    changelogUrl: SDK.changelogUrl,
  };
}

/**
 * The report, as the route answers it. Pure: everything it needs was read by the caller, which is
 * what lets the same stored check be rendered against two different readings without either of them
 * being cached here.
 */
export function buildReport(input: ReportInput): ClaudeUpdatesReport {
  return {
    checkedAt: input.check.checkedAt,
    checking: input.checking,
    checkError: input.check.error,
    nextCheckAt: input.nextCheckAt,
    supervised: input.supervised,
    packages: [cliPackage(input), sdkPackage(input)],
    job: input.job,
  };
}
