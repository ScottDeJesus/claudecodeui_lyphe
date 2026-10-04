/**
 * The reconciler: the API's half of a job, one tick at a time.
 *
 * A job has two writers, split by STATE. `installing` and `rolling-back` belong to the detached
 * runner, which is the only process that can see the commands it runs. Every other state belongs to
 * whoever holds the port, and that is this tick — because a job outlives the API that asked for it:
 * the install finishes, the server hands itself over, and it is a DIFFERENT process that must notice
 * which SDK it loaded, run the commit, or admit the new server never came up and roll back.
 *
 * The tick runs once a second, and only while a job is unfinished: `start()` reads `job.json` once and
 * arms it for a non-terminal job, a pass that sees a terminal job disarms it — and asks for a fresh
 * check when the write that ended the job was the RUNNER's, which no other path would notice — and
 * `kick()` re-arms it when an action writes a new job. No timer runs for a repository with no update
 * in it — the steady state of this file is one read at boot.
 *
 * This file is the WHEN: the arming, the one-pass-at-a-time guard, and the dispatch on what the file
 * says. What a state then MEANS — the CLI's verification, the reboot, the rollback a failed boot turns
 * into — is `update-reconciler.states.ts`, and the two files know the job only through `update-job.ts`.
 */

import type { ClaudeUpdateJob, ClaudeUpdateJobState } from '@/shared/claude-update-types.js';

import type { InstalledCliReading } from './update-check.report.js';
import type { RunGit } from './update-git.js';
import { isRunnerAlive, readJob, writeJob } from './update-job.js';
import { createUpdateStates } from './update-reconciler.states.js';

/** How often a pass runs while a job is unfinished. The runner writes each step change as it happens;
 *  a person watching the panel should not wait longer than this to see one. */
const TICK_INTERVAL_MS = 1_000;

/** The running step's verdict when the runner it belonged to vanished — a unit restart takes the
 *  detached runner's whole cgroup with it, and what is on disk is then all anyone can honestly say. */
const INTERRUPTED_DETAIL =
  'the update runner stopped before it finished — the cards show what is on disk now; press Update and restart to finish';

/** The states a job never leaves. A job in one of these is history: nothing acts on it, and nothing
 *  arms a timer for it. */
const TERMINAL_STATES: readonly ClaudeUpdateJobState[] = ['done', 'failed', 'rolled-back', 'interrupted'];

function isTerminal(state: ClaudeUpdateJobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Everything the reconciler needs. Nothing here reads the environment or resolves a binary: the
 *  module that builds this owns that, and this file owns only the state machine. */
type UpdateReconcilerDependencies = {
  /** Where `job.json` lives — this module's own directory. */
  dir: string;
  /** The repository root: what the commit runs its git commands in. */
  appRoot: string;
  /** Whether this API is serving yet; a pass before that would act on a job it cannot finish. */
  isListening: () => boolean;
  /** The cached reading of the binary a run would spawn, through the cli-version barrel (MAN-502). */
  readInstalledCli: () => Promise<InstalledCliReading>;
  /** What THIS process imported at boot — the one fact that tells a restarted server from a stale one. */
  loadedSdkVersion: string | null;
  /** Asks the supervisor to boot this server's code again and hand the port over. */
  requestReboot: (reason: string) => boolean;
  /** Registers the listener the supervisor's answer to a FAILED reboot lands on. */
  onRebootFailed: (listener: (detail: string) => void) => void;
  /** Starts the detached runner for a rollback the states decide on. */
  spawnRunner: (mode: 'install' | 'rollback') => number;
  /** Asks the check service for a fresh check. Fire and forget — a check never rejects. */
  runCheck: () => void;
  /** The one way this module asks git anything. */
  runGit: RunGit;
};

export function createUpdateReconciler(dependencies: UpdateReconcilerDependencies): {
  start: () => void;
  stop: () => void;
  kick: () => void;
} {
  const { dir, isListening } = dependencies;

  let tick: NodeJS.Timeout | null = null;
  /** True while a pass is in flight. A pass awaits a CLI probe and a git commit; a second one starting
   *  underneath would read a job the first is midway through writing. */
  let busy = false;
  let started = false;

  /** Arms the tick. Idempotent: `start()` and `kick()` both come through here. */
  function arm(): void {
    if (tick !== null) return;
    tick = setInterval(passTick, TICK_INTERVAL_MS);
    // Unref'd, like the check's timers: a job must never be the reason this process stays alive.
    tick.unref();
  }

  function disarm(): void {
    if (tick === null) return;
    clearInterval(tick);
    tick = null;
  }

  /** Ends the job: the state, the clock, the file — and, the job closed, a fresh check and no more
   *  ticking. Called only by a pass that just decided the job's end. */
  function finish(job: ClaudeUpdateJob, state: ClaudeUpdateJobState): void {
    job.state = state;
    job.endedAt = Date.now();
    writeJob(dir, job);
    disarm();
    dependencies.runCheck();
  }

  /** The runner died mid-install (or was killed with the unit). Its step cannot be left `running`:
   *  nothing will ever finish it, and a spinner over a dead runner is a lie a person waits on. */
  function interrupt(job: ClaudeUpdateJob): void {
    const running = job.steps.find((step) => step.state === 'running');
    if (running !== undefined) {
      running.state = 'failed';
      running.detail = INTERRUPTED_DETAIL;
      running.endedAt = Date.now();
    }
    finish(job, 'interrupted');
  }

  /** The states this process owns, wired to the two things only this closure can give them: how a job
   *  ends, and how the tick is armed again when a failed boot leaves a rollback to watch. */
  const states = createUpdateStates({
    dir,
    appRoot: dependencies.appRoot,
    isStarted: () => started,
    finish,
    arm,
    readInstalledCli: dependencies.readInstalledCli,
    loadedSdkVersion: dependencies.loadedSdkVersion,
    requestReboot: dependencies.requestReboot,
    spawnRunner: dependencies.spawnRunner,
    runGit: dependencies.runGit,
  });

  /** One pass, chosen by the state the file is in — and nothing else: a job this build cannot read
   *  stays where it is rather than being guessed at. */
  async function pass(): Promise<void> {
    const job = readJob(dir);
    if (job === null || isTerminal(job.state)) {
      disarm();
      // A job the RUNNER ended (`failed`, `rolled-back`) arrived at a terminal state without a pass of
      // ours, and it is still an end: the versions it moved are exactly what a check compares, and the
      // panel should not wait out the cadence to see them. Only `finish()` used to ask, so this is the
      // one memory the tick keeps — the disarm above is what makes it once per arming, not per second.
      if (job !== null) dependencies.runCheck();
      return;
    }

    switch (job.state) {
      case 'installing':
      case 'rolling-back':
        // The runner owns this state. Its death is the one fact here the outcome is not in the file.
        if (isRunnerAlive(job.runnerPid)) return;
        interrupt(job);
        return;
      case 'installed':
        await states.installed(job);
        return;
      case 'restarting':
        await states.restarting(job);
        return;
    }
  }

  /** One tick. Nothing runs before this API is listening — a pass only finishes a job by serving —
   *  and a pass already in flight owns the file until it is done with it. */
  function passTick(): void {
    if (!started || !isListening() || busy) return;
    busy = true;
    void pass()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[claude-updates] the reconciler could not act on the job: ${message}`);
      })
      .finally(() => {
        busy = false;
      });
  }

  return {
    /** Registers the supervisor's failure line — it can arrive at any moment after a request — and
     *  arms the tick if, and only if, there is a job to reconcile. */
    start(): void {
      if (started) return;
      started = true;
      dependencies.onRebootFailed(states.rebootFailed);
      const job = readJob(dir);
      if (job !== null && !isTerminal(job.state)) arm();
    },
    /** Off for good: no more passes, and no answer to a reboot this process no longer owes. */
    stop(): void {
      started = false;
      disarm();
    },
    /** An action just wrote a job: make sure a pass is coming. Before `start()` this does nothing —
     *  the module arms the reconciler as part of taking over the port. */
    kick(): void {
      if (!started) return;
      arm();
    },
  };
}
