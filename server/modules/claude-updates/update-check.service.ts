/**
 * The check service: the newest version of each package, on a cadence, and the report that answers
 * with it.
 *
 * Three things live here and nowhere else. The CADENCE — a tick every five minutes that checks only
 * when half an hour has passed, so a boot shows something five seconds in and a long-lived process
 * does not ask the registry six hundred times a day. The MEMORY — `check.json`, read once as this
 * service is built, so an API that just restarted answers with the last check rather than with
 * nothing. And the one journal line every check writes, success or failure.
 *
 * `checkNow` never rejects and is never run twice at once: a check is a fact about the world, and a
 * second one asked for while the first is in flight would be the same fact at more cost.
 *
 * The report's own composition is a file beside this one (`update-check.report.ts`) — that half
 * changes when the client's contract does, this half when the policy does.
 */

import type { ClaudeUpdateJob, ClaudeUpdatesReport } from '@/shared/claude-update-types.js';

import { packageRow, readSdkVersionOnDisk } from './packages.js';
import { buildReport } from './update-check.report.js';
import type { InstalledCliReading } from './update-check.report.js';
import { readCliUpdatableForCheck, readPackageCheck } from './update-check.reader.js';
import { readStoredCheck, writeStoredCheck } from './update-check.store.js';
import type { StoredCheck } from './update-check.store.js';

/** How long one check stands. Shorter than this and the report is a registry poll; longer and a
 *  release published after a check waits more than half an hour to be offered. `nextCheckAt` is this
 *  past `checkedAt`, so the two numbers the client reads are one apart. */
const CHECK_INTERVAL_MS = 30 * 60_000;

/** How often a tick asks whether a check is due. Cheap by construction: it reads a number and stops. */
const TICK_INTERVAL_MS = 5 * 60_000;

/** The first tick after `start()`. Not zero: this is armed from the `listen` callback, while the
 *  server is still opening its own doors, and a check is nobody's emergency. */
const FIRST_TICK_DELAY_MS = 5_000;

/** The two labels the journal line names, cli first. */
const CLI_LABEL = packageRow('cli').label;
const SDK_LABEL = packageRow('sdk').label;

/** What the service is built with. Nothing here reads the environment or resolves a binary. */
type UpdateCheckDependencies = {
  /** Where `check.json` lives — this module's own directory. */
  dir: string;
  /** The repository root: the cwd `npm view` runs in, so the repo's own `.npmrc` is honoured. */
  appRoot: string;
  /**
   * The installed CLI reading: `readInstalledCliVersion()` through the cli-version barrel, which is
   * the ONE cached reading of the binary a run would spawn — the same one the chat runtime asks at
   * send time. A check and a report both take it from here rather than resolving a binary of their
   * own (MAN-502 rule 1: a second rule would drift, and a version for a binary nothing runs is worse
   * than none at all).
   */
  readInstalledCli: () => Promise<InstalledCliReading>;
};

/** An error's own words, for the two places a failure becomes a sentence here. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createUpdateCheckService(dependencies: UpdateCheckDependencies): {
  report: (job: ClaudeUpdateJob | null, supervised: boolean) => Promise<ClaudeUpdatesReport>;
  checkNow: () => Promise<void>;
  start: () => void;
  stop: () => void;
} {
  const { dir, appRoot, readInstalledCli } = dependencies;

  // Read ONCE, here, at build time — which for the server entrypoint is process start. Every report
  // is answered from this, so a request never waits on a file; a check replaces what is here and on
  // disk together.
  let stored: StoredCheck = readStoredCheck(dir);
  let inFlight: Promise<void> | null = null;
  let firstTick: NodeJS.Timeout | null = null;
  let tick: NodeJS.Timeout | null = null;

  /**
   * The CLI as the reading answers it, with a rejection turned into the reason the shape already has
   * room for. To every caller below, a reading that throws and a reading that answers null are the
   * same fact: the version is not known, and here is why in words.
   */
  async function readCliReading(): Promise<InstalledCliReading> {
    try {
      return await readInstalledCli();
    } catch (error) {
      return { version: null, reason: `the Claude CLI's version could not be read: ${messageOf(error)}` };
    }
  }

  /** One check, start to finish: the reads, the file, and the one journal line that reports it. */
  async function runCheck(): Promise<void> {
    // The installed CLI is read BEFORE the checks, never after: the window a check stores is the one
    // this install is in at the moment it asks, and a version read after a slow registry call would
    // be an answer to a different question.
    const cliReading = await readCliReading();

    const [cliRead, sdkRead, updatable] = await Promise.all([
      readPackageCheck({ appRoot, key: 'cli', previous: stored.cli, installed: cliReading.version }),
      readPackageCheck({ appRoot, key: 'sdk', previous: stored.sdk, installed: readSdkVersionOnDisk() }),
      readCliUpdatableForCheck(),
    ]);

    const next: StoredCheck = {
      checkedAt: Date.now(),
      error: cliRead.error ?? sdkRead.error,
      cli: { ...cliRead.next, ...updatable },
      sdk: sdkRead.next,
    };

    // The file first, the line second, so the two never disagree about what the last check read. A
    // write that fails does not lose the check — this process answers from memory either way — but it
    // is said out loud rather than swallowed, and it is what the report will call `checkError`.
    let writeFailure: string | null = null;
    try {
      writeStoredCheck(dir, next);
    } catch (error) {
      writeFailure = `check.json could not be written: ${messageOf(error)}`;
    }
    next.error ??= writeFailure;

    stored = next;
    if (next.error === null) {
      // Exactly one line per check, and this is the success one: both registry reads answered, so
      // both versions are strings here.
      console.log(
        `[claude-updates] checked npm: ${CLI_LABEL} latest ${next.cli.latest} · ${SDK_LABEL} latest ${next.sdk.latest}`,
      );
    } else {
      console.error(`[claude-updates] check failed: ${next.error}`);
    }
  }

  /**
   * Runs one check, or joins the one already running. Resolves when that check is done and never
   * rejects: a caller awaiting this is a route that must answer a report whatever the registry did.
   */
  function checkNow(): Promise<void> {
    inFlight ??= runCheck()
      .catch((error) => {
        // Unreachable while everything above returns values instead of throwing, and kept for the day
        // one of them does not: the line is still exactly one, and the caller still gets a resolved
        // promise rather than an error it has nowhere to put.
        console.error(`[claude-updates] check failed: ${messageOf(error)}`);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /**
   * One tick: a check only when one is due, or when none has ever run in this file's lifetime.
   *
   * A NEGATIVE gap is the same stamp-from-the-future the store refuses on read, seen by a process that
   * was already running when the clock stepped back: the check in memory is now dated ahead of this
   * clock, and `>=` alone would hold the cadence until real time passed it. Checking is what
   * re-stamps it.
   */
  function checkIfDue(): void {
    if (stored.checkedAt === null) {
      void checkNow();
      return;
    }
    const sinceLastCheck = Date.now() - stored.checkedAt;
    if (sinceLastCheck >= CHECK_INTERVAL_MS || sinceLastCheck < 0) void checkNow();
  }

  /**
   * Arms the cadence: a tick every five minutes, its first run five seconds from now.
   *
   * Both timers are unref'd, so a check never keeps this process alive on its own — the server's own
   * socket is what holds it open, and a shutdown between two ticks is a shutdown that does not wait
   * for a registry.
   */
  function start(): void {
    if (firstTick !== null || tick !== null) return;
    firstTick = setTimeout(() => {
      firstTick = null;
      checkIfDue();
    }, FIRST_TICK_DELAY_MS);
    tick = setInterval(checkIfDue, TICK_INTERVAL_MS);
    firstTick.unref();
    tick.unref();
  }

  /** Stops both timers. A check already in flight is left to finish: it holds nothing this process
   *  needs, and its line is worth having. */
  function stop(): void {
    if (firstTick !== null) {
      clearTimeout(firstTick);
      firstTick = null;
    }
    if (tick !== null) {
      clearInterval(tick);
      tick = null;
    }
  }

  /**
   * The report, as the route answers it: the two readings taken fresh, the stored check, and the two
   * facts that belong to the module — the current job, and whether this API can hand itself over.
   */
  async function report(job: ClaudeUpdateJob | null, supervised: boolean): Promise<ClaudeUpdatesReport> {
    const cli = await readCliReading();
    return buildReport({
      check: stored,
      checking: inFlight !== null,
      nextCheckAt: stored.checkedAt === null ? null : stored.checkedAt + CHECK_INTERVAL_MS,
      cli,
      sdkInstalled: readSdkVersionOnDisk(),
      job,
      supervised,
    });
  }

  return { report, checkNow, start, stop };
}
