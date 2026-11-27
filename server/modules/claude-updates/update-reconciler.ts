/**
 * The reconciler: the API's half of a job, one pass at a time.
 *
 * A job has two writers, split by STATE. `installing` and `rolling-back` belong to the detached
 * runner, which is the only process that can see the commands it runs. Every other state belongs to
 * whoever holds the port, and that is this reconciler — because a job outlives the API that asked for
 * it: the install finishes, the server hands itself over, and it is a DIFFERENT process that must
 * notice which SDK it loaded, run the commit, or admit the new server never came up and roll back.
 *
 * WHAT WAKES A PASS. No clock: while a job is unfinished the reconciler is ARMED — a watch on this
 * directory hears every write of `job.json` (the runner's step changes, an action's new job, another
 * process's), and a runner this process spawned announces its own exit through `kick()`. What no
 * event announces is a deadline, so every settled pass leaves at most one timer behind
 * (`update-reconciler.wake.ts`). `start()` and `kick()` arm and pass at once for an unfinished job;
 * a pass that finds no job or a finished one disarms — and asks for a fresh check when the write that
 * ended the job was the RUNNER's, which no other path would notice. A repository with no update in it
 * holds no watch and no timer — the steady state of this file is one read at boot.
 *
 * This file is the WHEN: the arming, the one-pass-at-a-time guard, and the dispatch on what the file
 * says. What a state then MEANS — the CLI's verification, the reboot, the rollback a failed boot turns
 * into — is `update-reconciler.states.ts`, and the files know the job only through `update-job.ts`.
 */

import type { ClaudeUpdateJob, ClaudeUpdateJobState } from '@/shared/claude-update-types.js';
import { type DirectoryWatch, watchDirectory } from '@/shared/directory-watch.service.js';

import type { InstalledCliReading } from './update-check.report.js';
import type { RunGit } from './update-git.js';
import { JOB_FILE, isRunnerAlive, readJob, writeJob } from './update-job.js';
import { createUpdateStates } from './update-reconciler.states.js';
import { isTerminal, nextWakeMs } from './update-reconciler.wake.js';

/** The running step's verdict when the runner it belonged to vanished — a unit restart takes the
 *  detached runner's whole cgroup with it, and what is on disk is then all anyone can honestly say. */
const INTERRUPTED_DETAIL =
  'the update runner stopped before it finished — the cards show what is on disk now; press Update and restart to finish';

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
  /** Whether this process will hear that runner's exit (it spawned it). A runner it will not hear is
   *  looked at on `RUNNER_LIVENESS_MS` instead. */
  holdsRunnerExit: (runnerPid: number | null) => boolean;
};

export function createUpdateReconciler(dependencies: UpdateReconcilerDependencies): {
  start: () => void;
  stop: () => void;
  kick: () => void;
} {
  const { dir, isListening } = dependencies;

  let watch: DirectoryWatch | null = null;
  let wake: NodeJS.Timeout | null = null;
  /** True while a pass is in flight. A pass awaits a CLI probe and a git commit; a second one starting
   *  underneath would read a job the first is midway through writing. */
  let busy = false;
  /** An event or a wake arrived while a pass was in flight: one more pass is owed when it ends. */
  let passOwed = false;
  let lastPassThrew = false;
  let started = false;

  /** Opens the watch on `job.json` and sets the wake. Idempotent: `start()`, `kick()` and a failed
   *  boot's rollback all come through here. */
  function arm(): void {
    if (watch === null) {
      watch = watchDirectory({
        dir,
        classify: (_kind, name) => (name === JOB_FILE ? true : null),
        onInterest: requestPass,
        // A re-armed watch was blind for a while: whatever the file says now is unseen.
        onRearm: requestPass,
        logError: (message) => console.error(`[claude-updates] ${message}`),
      });
    }
    setWake();
  }

  function disarm(): void {
    watch?.close();
    watch = null;
    clearWake();
  }

  function clearWake(): void {
    if (wake === null) return;
    clearTimeout(wake);
    wake = null;
  }

  /** The one timer a settled pass leaves: the deadline the job's state names, or none. */
  function setWake(): void {
    clearWake();
    const delayMs = nextWakeMs(readJob(dir), {
      now: Date.now(),
      pid: process.pid,
      holdsRunnerExit: dependencies.holdsRunnerExit,
      lastPassThrew,
    });
    if (delayMs === null) return;
    wake = setTimeout(() => {
      wake = null;
      requestPass();
    }, delayMs);
    // Unref'd, like the check's timers: a job must never be the reason this process stays alive.
    wake.unref();
  }

  /** Ends the job: the state, the clock, the file — and, the job closed, a fresh check and nothing
   *  armed. Called only by a pass that just decided the job's end. */
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
   *  ends, and how the reconciler is armed again when a failed boot leaves a rollback to watch. */
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
      // panel should not wait for the next check to see them. Only `finish()` used to ask, so this is
      // the one memory the reconciler keeps — the disarm above is what makes it once per arming.
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

  /** Asks for a pass. Nothing runs before this API is listening — a pass only finishes a job by
   *  serving — and a pass already in flight owns the file: what it missed is owed one more pass. */
  function requestPass(): void {
    if (!started || !isListening()) return;
    if (busy) {
      passOwed = true;
      return;
    }
    busy = true;
    void pass()
      .then(
        () => {
          lastPassThrew = false;
        },
        (error: unknown) => {
          lastPassThrew = true;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[claude-updates] the reconciler could not act on the job: ${message}`);
        },
      )
      .finally(() => {
        busy = false;
        settle();
      });
  }

  /** After a pass: nothing when it disarmed (the job ended, or `stop()`), the owed pass when one is
   *  owed, else the wake the job now names. */
  function settle(): void {
    if (watch === null) {
      passOwed = false;
      return;
    }
    if (passOwed) {
      passOwed = false;
      requestPass();
      return;
    }
    setWake();
  }

  /** Arms and passes at once — for an unfinished job only, so a finished one read here is not taken
   *  for an end the runner just reached and checked for a second time. */
  function armForUnfinishedJob(): void {
    const job = readJob(dir);
    if (job === null || isTerminal(job.state)) return;
    arm();
    requestPass();
  }

  return {
    /** Registers the supervisor's failure line — it can arrive at any moment after a request — and
     *  arms the reconciler if, and only if, there is a job to reconcile. */
    start(): void {
      if (started) return;
      started = true;
      dependencies.onRebootFailed(states.rebootFailed);
      armForUnfinishedJob();
    },
    /** Off for good: no more passes, and no answer to a reboot this process no longer owes. */
    stop(): void {
      started = false;
      passOwed = false;
      disarm();
    },
    /** An action just wrote a job, or a runner this process spawned exited: make sure a pass is
     *  coming. Before `start()` this does nothing — the module arms the reconciler as part of taking
     *  over the port. */
    kick(): void {
      if (!started) return;
      armForUnfinishedJob();
    },
  };
}
