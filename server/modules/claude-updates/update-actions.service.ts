/**
 * The two things a person can ask the pipeline to DO: install an update (or roll one back), and
 * restart the server.
 *
 * Both are refusals first. An update is a claim about versions someone read off a screen, and between
 * that reading and this call the world can move: a job can already be running, npm can have published
 * a newer `latest`, a package can be one this host cannot install. So each action is a list of checks
 * in a fixed order, and the answer to a failed one is a refusal with a status and a sentence — never a
 * job started on versions that no longer mean what the caller thought.
 *
 * What the checks are FOR is what the caller saw: `targets` are the versions the tab displayed, not a
 * command to install them. That is why the two kinds of job are told apart by comparing them against
 * the check's CURRENT report (`update`: every target is that package's `latest`) and against the last
 * finished job (`rollback`: every target is the version that job moved away from) — and why a request
 * that matches neither is stale rather than accepted.
 *
 * Both actions end by kicking the reconciler: the job is on disk, and what happens to it next belongs
 * to the tick.
 */

import type {
  ClaudeUpdateJobState,
  ClaudeUpdatePackage,
  ClaudeUpdatePackageKey,
  ClaudeUpdateRefusal,
  ClaudeUpdatesReport,
} from '@/shared/claude-update-types.js';

import { readSdkVersionOnDisk } from './packages.js';
import type { InstalledCliReading, ReportReadings } from './update-check.report.js';
import type { RunGit } from './update-git.js';
import { PACKAGE_FILES, createJob, readJob, stepOf, writeJob } from './update-job.js';

/** What both actions answer: done, or refused with the status the route sends and the words it sends. */
export type UpdateActionResult =
  | { ok: true }
  | { ok: false; status: 400 | 409; refusal: ClaudeUpdateRefusal };

/**
 * The states in which a job owns this host's `node_modules` and a second one may not be started: the
 * two the runner process writes, plus the two the API is midway through — `installed` owes a restart,
 * and `restarting` is waiting for one. Every other state is history, and a new job replaces it.
 * consumer: update-auto-install.service.ts, for which a job in one of these states is an install under way.
 */
export const APPLY_ACTIVE_STATES: readonly ClaudeUpdateJobState[] = ['installing', 'installed', 'restarting', 'rolling-back'];

/** The states a restart may not interrupt: exactly the two the RUNNER owns, where an install or a
 *  rollback is halfway through writing the tree a reboot would load. */
const RESTART_ACTIVE_STATES: readonly ClaudeUpdateJobState[] = ['installing', 'rolling-back'];

/** The reboot request's reason, in the journal beside the pid that sent it. ONE string for both the
 *  recorded request and the message, so the two can never describe different asks. */
const RESTART_REASON = 'claude-updates: restart requested from Settings';

/** One package and the version asked for it, from a targets object already read off the wire. */
type NamedTarget = { key: ClaudeUpdatePackageKey; version: string };

/** Everything the actions need. `check` is the check service itself: its report is where `latest` and
 *  `updatable` come from, read fresh, so an action never decides on a version the report has moved on
 *  from. `appRoot` is not here on purpose — the one git call this file makes goes through `runGit`,
 *  which the module already bound to the repository root. */
type UpdateActionsDependencies = {
  /** Where `job.json` lives — this module's own directory. */
  dir: string;
  /** The check service, for the current report. */
  check: { report: (job: ClaudeUpdatesReport['job'], supervised: boolean) => Promise<ReportReadings> };
  /** The tick to wake once a job is on disk. */
  reconciler: { kick: () => void };
  /** Starts the detached runner. */
  spawnRunner: (mode: 'install' | 'rollback') => number;
  /** The one way this module asks git anything. */
  runGit: RunGit;
  /** Asks the supervisor to boot this server's code again. False means nothing was sent. */
  requestReboot: (reason: string) => boolean;
  /** Whether this API can hand itself over at all (`supervised-boot`'s `supervised`). */
  supervised: boolean;
  /** The cached reading of the binary a run would spawn, through the cli-version barrel (MAN-502). */
  readInstalledCli: () => Promise<InstalledCliReading>;
};

/** A refusal, in the shape both actions answer with and the route formats. */
function refuse(
  status: 400 | 409,
  error: ClaudeUpdateRefusal['error'],
  message: string,
): UpdateActionResult {
  return { ok: false, status, refusal: { error, message } };
}

/** The package row of a report by key. A report always carries both rows, in order. */
function packageOf(report: ReportReadings, key: ClaudeUpdatePackageKey): ClaudeUpdatePackage {
  const row = report.packages.find((entry) => entry.key === key);
  if (row === undefined) throw new Error(`the report carries no ${key} package`);
  return row;
}

/**
 * The targets object as a request, or null when it is not one: only `cli`/`sdk` keys, every value a
 * string, and at least one of them. Anything else is a bad request, not a version mismatch — this is
 * the shape test, and every later check may assume it passed.
 */
function readNamedTargets(targets: unknown): NamedTarget[] | null {
  if (typeof targets !== 'object' || targets === null || Array.isArray(targets)) return null;
  const entries = Object.entries(targets as Record<string, unknown>);
  if (entries.length === 0) return null;

  const named: NamedTarget[] = [];
  for (const [key, version] of entries) {
    if (key !== 'cli' && key !== 'sdk') return null;
    if (typeof version !== 'string') return null;
    named.push({ key, version });
  }
  return named;
}

/** The targets as the job file takes them: one version per package, keyed. */
function targetRecord(named: NamedTarget[]): Partial<Record<ClaudeUpdatePackageKey, string>> {
  const record: Partial<Record<ClaudeUpdatePackageKey, string>> = {};
  for (const target of named) record[target.key] = target.version;
  return record;
}

/**
 * Which kind of job these targets name, or null when they name neither.
 *
 * An update is what the screen offered: every target IS that package's `latest` right now. A rollback
 * is what the last finished update moved away from: every target is that job's own `from` for its
 * package, one package or both. A set mixing the two matches neither rule — and so does a request
 * whose versions have simply moved — which is the point of comparing all of them, never one.
 */
function selectKind(
  named: NamedTarget[],
  report: ReportReadings,
  job: ClaudeUpdatesReport['job'],
): 'update' | 'rollback' | null {
  if (named.every((target) => packageOf(report, target.key).latest === target.version)) return 'update';

  if (job !== null && job.kind === 'update' && job.state === 'done') {
    if (named.every((target) => stepOf(job, target.key)?.from === target.version)) return 'rollback';
  }
  return null;
}

/** What the CLI answers now, with a reading that threw treated as a version that is not known — the
 *  same reading a report shows, and the same way it shows a failed one. */
async function readCliVersion(readInstalledCli: () => Promise<InstalledCliReading>): Promise<string | null> {
  try {
    return (await readInstalledCli()).version;
  } catch {
    return null;
  }
}

export function createUpdateActions(dependencies: UpdateActionsDependencies): {
  applyUpdate: (targets: Partial<Record<ClaudeUpdatePackageKey, string>>) => Promise<UpdateActionResult>;
  restartServer: () => Promise<UpdateActionResult>;
} {
  const { dir, check, reconciler, spawnRunner, runGit, requestReboot, supervised } = dependencies;

  /** True from the moment an apply has a valid request in hand until its job is on disk or it refused.
   *  Every step in between awaits — the report, the CLI reading, a real `git diff` — so without it two
   *  calls in one burst both read a world with no job in it and both start one (measured 2026-09-28:
   *  two accepts, two runners spawned, one file naming only the second). */
  let startingUpdate = false;

  /** What each named package is on disk right now, read for the packages asked about only: the CLI
   *  reading spawns a binary, and a request naming only the SDK never pays for it. Read HERE rather
   *  than out of the report because these are the versions a job's steps record as `from`. */
  async function readInstalled(
    named: NamedTarget[],
  ): Promise<Partial<Record<ClaudeUpdatePackageKey, string | null>>> {
    const installed: Partial<Record<ClaudeUpdatePackageKey, string | null>> = {};
    for (const target of named) {
      installed[target.key] =
        target.key === 'cli' ? await readCliVersion(dependencies.readInstalledCli) : readSdkVersionOnDisk();
    }
    return installed;
  }

  return {
    /**
     * Starts the job the targets name, or refuses. The checks run in this order, and the order is the
     * service: the shape of the request, then whether a job is running, then whether the versions are
     * still the ones the caller saw — because that answer needs no reading of the disk, and a request
     * whose versions have moved should be told so rather than told what this host can install.
     *
     * The two job-active guards are one rule from both sides of the awaits below: the call inside
     * them, and the file, which is the only thing two processes share.
     */
    async applyUpdate(targets): Promise<UpdateActionResult> {
      const named = readNamedTargets(targets);
      if (named === null) {
        return refuse(400, 'bad-request', 'the targets must name cli, sdk, or both, each with a version string');
      }

      if (startingUpdate) {
        return refuse(409, 'job-active', 'an update is already being started — wait for it to finish');
      }
      // Held across every await below, and released on every way out — a `finally`, because one missed
      // release would refuse every later press for the life of this process.
      startingUpdate = true;
      try {
        // Read once and used twice: the same file says whether a job is running, and it is the last
        // job a rollback's `from` versions come from.
        const job = readJob(dir);
        if (job !== null && APPLY_ACTIVE_STATES.includes(job.state)) {
          return refuse(409, 'job-active', `a job is already ${job.state} — wait for it to finish`);
        }

        const report = await check.report(job, supervised);
        const kind = selectKind(named, report, job);
        if (kind === null) {
          return refuse(409, 'stale-target', 'the versions on screen are no longer the newest — read them again');
        }

        if (named.some((target) => target.key === 'cli')) {
          const cli = packageOf(report, 'cli');
          if (!cli.updatable) {
            return refuse(409, 'not-updatable', cli.reason ?? 'the Claude Code package cannot be updated on this host');
          }
        }

        const installed = await readInstalled(named);
        // A target equal to what is already installed is not a failure — it is nothing to do, and it
        // is dropped before the job is built so the steps never name a move that is not one.
        const remaining = named.filter((target) => installed[target.key] !== target.version);
        if (remaining.length === 0) {
          return refuse(409, 'nothing-to-update', 'every package asked for is already installed');
        }

        // The clean-at-start test, for the two files an SDK install rewrites and only when this job
        // touches them. The commit reads this flag; a job that never hashes those files never pays.
        let cleanAtStart = false;
        if (remaining.some((target) => target.key === 'sdk')) {
          const diff = await runGit(['diff', '--quiet', 'HEAD', '--', ...PACKAGE_FILES]);
          cleanAtStart = diff.code === 0;
        }

        // The guard read above is stale the moment this function awaits: the read that counts is this
        // one, with NO await between it and the write below — one synchronous claim of the file, so a
        // job written in that window by another request (or another process across a handover) is
        // refused rather than overwritten. `createJob` truncates the log, so the refusal comes first.
        const onDisk = readJob(dir);
        if (onDisk !== null && APPLY_ACTIVE_STATES.includes(onDisk.state)) {
          return refuse(409, 'job-active', `a job is already ${onDisk.state} — wait for it to finish`);
        }

        const newJob = createJob(dir, { kind, targets: targetRecord(remaining), installed, cleanAtStart });
        // Spawned before the file names it, and the file written after the spawn names the pid: the
        // runner waits for its own pid to appear, so a job that never did is a runner that never started.
        newJob.runnerPid = spawnRunner('install');
        writeJob(dir, newJob);
        reconciler.kick();
        return { ok: true };
      } finally {
        startingUpdate = false;
      }
    },

    /**
     * Restarts this server, and — when a job is waiting on exactly that — records the request the way
     * the reconciler's own request is recorded, so a boot that fails still rolls back instead of
     * leaving the job waiting forever.
     */
    async restartServer(): Promise<UpdateActionResult> {
      if (!supervised) {
        return refuse(
          409,
          'not-supervised',
          'this server is not run by the dev supervisor, so it cannot hand itself over',
        );
      }

      const job = readJob(dir);
      if (job !== null && RESTART_ACTIVE_STATES.includes(job.state)) {
        return refuse(409, 'job-active', `the ${job.state} runner owns the job — wait for it to finish`);
      }

      if (job !== null && job.state === 'restarting') {
        const restart = stepOf(job, 'restart');
        if (restart !== null) {
          restart.state = 'running';
          restart.detail = 'restart requested from Settings';
          restart.startedAt = Date.now();
        }
        job.restart = { requestedAt: Date.now(), requestedBy: process.pid };
        writeJob(dir, job);
      }

      // The channel can close between the check above and this send — the supervisor is a separate
      // process. False is that fact, and the answer is the same one: this API cannot restart itself.
      if (!requestReboot(RESTART_REASON)) {
        return refuse(409, 'not-supervised', 'the supervisor channel is closed — restart the unit');
      }

      reconciler.kick();
      return { ok: true };
    },
  };
}
