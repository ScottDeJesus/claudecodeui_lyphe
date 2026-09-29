/**
 * What the reconciler DOES about the two job states this process owns: `installed` and `restarting`.
 *
 * These are the states that come after the runner is done and before the job is history, and every
 * decision in them is about the same unobservable fact: which Claude Agent SDK the RUNNING server
 * loaded. A process cannot see that about itself from the inside — it knows what it imported at boot,
 * and everything else it knows by asking the supervisor to boot it again and watching what happens.
 * That is why the two states are one file: `installed` asks for the reboot, `restarting` reads the
 * answers to it, and the supervisor's failure line turns the job into a rollback the runner takes over.
 *
 * The one thing this file never does is write a step without writing the job: the caller's `finish`
 * closes a job, and the paths that are not the end of a job write the file themselves, exactly once.
 */

import { performance } from 'node:perf_hooks';

import type { ClaudeUpdateJob, ClaudeUpdateJobState, ClaudeUpdateStep } from '@/shared/claude-update-types.js';

import type { InstalledCliReading } from './update-check.report.js';
import { runCommitStep } from './update-commit.js';
import type { RunGit } from './update-git.js';
import { readJob, stepOf, writeJob } from './update-job.js';

/** How long a reboot request of OURS stands unanswered before the step is put back for another press.
 *  A handover takes seconds; a minute of silence is a supervisor that is not going to answer. */
const REBOOT_ANSWER_TIMEOUT_MS = 60_000;

/** What these handlers need from the tick that calls them: its own directory, the ways out of a job,
 *  and the same collaborators the reconciler was built with. Everything here is per-instance — the
 *  state machine itself lives in `update-reconciler.ts`, which owns when any of this runs. */
export type UpdateStateDependencies = {
  /** Where `job.json` lives — this module's own directory. */
  dir: string;
  /** The repository root: what the commit runs its git commands in. */
  appRoot: string;
  /** Whether the reconciler is started: a reboot answer that arrives after `stop()` is not this
   *  process's answer any more, and must not spawn a runner. */
  isStarted: () => boolean;
  /** Ends the job: the state, the clock, the file, a fresh check, and no more ticking. */
  finish: (job: ClaudeUpdateJob, state: ClaudeUpdateJobState) => void;
  /** Arms the tick again — a failed boot leaves a rollback runner to watch, and the job it writes is
   *  in a state the runner owns. */
  arm: () => void;
  /** The cached reading of the binary a run would spawn, through the cli-version barrel (MAN-502). */
  readInstalledCli: () => Promise<InstalledCliReading>;
  /** What THIS process imported at boot — the one fact that tells a restarted server from a stale one. */
  loadedSdkVersion: string | null;
  /** Asks the supervisor to boot this server's code again and hand the port over. */
  requestReboot: (reason: string) => boolean;
  /** Starts the detached runner for a rollback this file decided on. */
  spawnRunner: (mode: 'install' | 'rollback') => number;
  /** The one way this module asks git anything. */
  runGit: RunGit;
};

export function createUpdateStates(dependencies: UpdateStateDependencies): {
  installed: (job: ClaudeUpdateJob) => Promise<void>;
  restarting: (job: ClaudeUpdateJob) => Promise<void>;
  rebootFailed: (detail: string) => void;
} {
  const { dir, appRoot, isStarted, finish, arm, readInstalledCli, loadedSdkVersion, requestReboot, spawnRunner, runGit } =
    dependencies;

  /** One step's verdict: the state, the one line, and the moment it ended. */
  function endStep(step: ClaudeUpdateStep, state: 'done' | 'failed' | 'skipped', detail: string): void {
    step.state = state;
    step.detail = detail;
    step.endedAt = Date.now();
  }

  /** The CLI version, with a reading that threw treated the way the report treats one: as a version
   *  that is not known, which is what the step's own sentence then says. */
  async function readCliVersion(): Promise<string | null> {
    try {
      return (await readInstalledCli()).version;
    } catch {
      return null;
    }
  }

  /**
   * The CLI step's verification, run from `installed` — the one moment the answer means something:
   * npm has finished, so whether the binary a run would spawn is the new one is a fact, not a race.
   * An update restarts idle conversations onto the new binary by itself (the keepalive's sweep) and a
   * turn in flight moves at its next message; a rollback leaves conversations already on the newer
   * build where they are until they close. Either way this pipeline aborts nobody.
   */
  async function verifyCliStep(job: ClaudeUpdateJob, step: ClaudeUpdateStep): Promise<void> {
    const to = step.to;
    const answered = await readCliVersion();
    if (to !== null && answered === to) {
      const head = `Claude Code now answers ${to}.`;
      endStep(
        step,
        'done',
        job.kind === 'rollback' && step.from !== null
          ? `${head} Conversations already on ${step.from} keep it until they close.`
          : `${head} Idle conversations restart onto it now; a conversation mid-turn moves when its turn ends.`,
      );
      return;
    }
    endStep(step, 'failed', `npm finished, but the Claude CLI answers ${answered ?? 'nothing'}`);
  }

  /** The commit, and then the end of the job. The job is `done` whatever the commit decided: what the
   *  update set out to do — install the SDK and have it loaded — happened, and whether the two package
   *  files were the pipeline's to commit is a verdict of its own, on its own step. */
  async function commitAndFinish(job: ClaudeUpdateJob): Promise<void> {
    const commit = stepOf(job, 'commit');
    if (commit !== null) {
      commit.state = 'running';
      commit.startedAt = Date.now();
      await runCommitStep(job, { appRoot, runGit });
    }
    finish(job, 'done');
  }

  return {
    /** `installed`: the runner finished every install step it had. What happens next depends on whether
     *  the job moved the SDK — the only step whose effect this process cannot see until it restarts. */
    async installed(job: ClaudeUpdateJob): Promise<void> {
      const cli = stepOf(job, 'cli');
      if (cli !== null && cli.state === 'done') await verifyCliStep(job, cli);

      const sdk = stepOf(job, 'sdk');
      // A cli-only job is finished the moment the binary answers: no restart is owed, and no file the
      // commit names has moved.
      if (sdk === null) {
        finish(job, cli !== null && cli.state === 'done' ? 'done' : 'failed');
        return;
      }

      const restart = stepOf(job, 'restart');
      // The runner only writes `installed` when every install step is done, so an unfinished sdk step —
      // or no restart step — is a file this build cannot drive: end it rather than tick at it forever.
      if (sdk.state !== 'done' || restart === null) {
        finish(job, 'failed');
        return;
      }
      const to = restart.to;

      // This process already loaded the version the job installed — a restart happened between the
      // install and this pass (the person's own, or a supervisor cycle). Nothing to ask for.
      if (to !== null && loadedSdkVersion === to) {
        endStep(restart, 'done', `this server already runs Claude Agent SDK ${to}`);
        await commitAndFinish(job);
        return;
      }

      if (to !== null && requestReboot(`claude-updates: load Claude Agent SDK ${to}`)) {
        restart.state = 'running';
        restart.detail = null;
        restart.startedAt = Date.now();
        job.state = 'restarting';
        job.restart = { requestedAt: Date.now(), requestedBy: process.pid };
        writeJob(dir, job);
        return;
      }

      // No supervisor to hand over to: the job still owes a restart, and the step says who can give it
      // one. The job stays `restarting` with a null requester, which is the state the rules below
      // deliberately wait in.
      restart.detail =
        `this server is not run by the dev supervisor, so it cannot hand itself over — ` +
        `restart it and SDK ${to ?? 'the installed version'} loads then`;
      job.state = 'restarting';
      writeJob(dir, job);
    },

    /** `restarting`: a reboot was asked for, and this process is waiting to be replaced. The cases are
     *  ordered, and the order is what keeps a boot that was already in flight from being read as the
     *  answer to a request that came after it. */
    async restarting(job: ClaudeUpdateJob): Promise<void> {
      const restart = stepOf(job, 'restart');
      if (restart === null) {
        finish(job, 'failed');
        return;
      }
      const to = restart.to;

      // 1. THIS process loaded the version the job installed: the restart the job asked for is done.
      if (to !== null && loadedSdkVersion === to) {
        endStep(restart, 'done', `the server restarted on Claude Agent SDK ${to}`);
        await commitAndFinish(job);
        return;
      }

      const { requestedAt, requestedBy } = job.restart;

      // 2. A request of our own that nobody answered. Put the step back to `pending` — the state test
      //    inside is what makes it once: a step already back to pending never matches here again, and
      //    the job then simply waits for the next press or the next server restart.
      if (
        requestedBy === process.pid &&
        requestedAt !== null &&
        restart.state === 'running' &&
        Date.now() - requestedAt > REBOOT_ANSWER_TIMEOUT_MS
      ) {
        restart.state = 'pending';
        restart.detail =
          'the supervisor did not answer — press Restart server, or the next server restart loads SDK ' +
          `${to ?? 'the installed version'} and finishes this update`;
        writeJob(dir, job);
        return;
      }

      // 3. Another process booted AFTER the request and loaded something else: that boot WAS the
      //    restart, and it came up on the wrong version. Only a process started after the request may
      //    be read this way — `timeOrigin` is this process's own start — so a boot that was already in
      //    flight when the request went out falls through to the case below instead.
      if (
        requestedBy !== null &&
        requestedBy !== process.pid &&
        requestedAt !== null &&
        performance.timeOrigin > requestedAt
      ) {
        endStep(
          restart,
          'failed',
          `the server restarted but loaded Claude Agent SDK ${loadedSdkVersion ?? 'nothing'}, not ${to ?? 'the installed version'}`,
        );
        finish(job, 'failed');
        return;
      }

      // 4. Anything else is not this job's answer: a boot already in flight, or a requester this
      //    process will never see again. Leave the job exactly as it is — the supervisor's queued
      //    cycle, or a person's press, brings the answer.
    },

    /** The supervisor's answer to a reboot that failed: the new server never came up, so the version
     *  it would have loaded is not there. The job rolls back on disk — in the state that belongs to
     *  the runner — and the person gets the supervisor's own first error line, not a summary of it.
     *  Only OUR request may be answered here: another process's request is a job it already decided
     *  about, and a reconciler that has stopped owes no answer to anything. */
    rebootFailed(detail: string): void {
      if (!isStarted()) return;
      const job = readJob(dir);
      if (job === null || job.state !== 'restarting' || job.restart.requestedBy !== process.pid) return;

      const restart = stepOf(job, 'restart');
      if (restart !== null) endStep(restart, 'failed', `the new server could not boot: ${detail}`);
      job.state = 'rolling-back';
      job.runnerPid = spawnRunner('rollback');
      writeJob(dir, job);
      arm();
    },
  };
}
