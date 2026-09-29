/**
 * The Claude updates module: the report at `/api/claude-updates`, the check behind it, the two
 * actions in front of the pipeline, and the reconciler that finishes a job somebody else started.
 *
 * The composition root, and the only file here that names a directory or a module outside this one.
 * It exists as a module rather than a mount because two of its parts are ARMED rather than called:
 * the check starts after `listen` (its first tick writes a file and asks the registry), and the
 * reconciler starts when this process is the one serving and can actually finish a job. The
 * entrypoint has to be able to name both, so both are things it hands back.
 *
 * `appRoot`, `supervised`, `isListening`, `requestReboot` and `onRebootFailed` are handed in rather
 * than read here: the entrypoint is where the repository root is resolved once
 * (`findApplicationRoot`), where `server.listening` is a fact only it holds, and where
 * `supervised-boot.ts` is already the one voice on whether this process can hand itself over.
 */

import { execFile } from 'node:child_process';

import type { Router } from 'express';

import { readInstalledCliVersion } from '@/modules/cli-version/index.js';
import type { ClaudeUpdateJob } from '@/shared/claude-update-types.js';

import { createClaudeUpdatesRouter } from './claude-updates.routes.js';
import { LOADED_SDK_VERSION } from './packages.js';
import { createUpdateActions } from './update-actions.service.js';
import { createUpdateCheckService } from './update-check.service.js';
import type { GitResult } from './update-git.js';
import { claudeUpdatesDir, readJob, readLogTail, spawnUpdateRunner } from './update-job.js';
import { createUpdateReconciler } from './update-reconciler.js';

/** How many lines of `job.log` a report carries. Enough to see the npm a job ended on, short enough
 *  to ride in every answer. */
const LOG_TAIL_LINES = 40;

export function createClaudeUpdatesModule(dependencies: {
  appRoot: string;
  /** This API can hand itself over (`supervised-boot`'s `supervised`). */
  supervised: boolean;
  /** Whether this process is serving yet — `() => server.listening` at the entrypoint. */
  isListening: () => boolean;
  /** Asks the supervisor to boot this server's code again and hand the port over. */
  requestReboot: (reason: string) => boolean;
  /** Registers the listener the supervisor's answer to a failed reboot lands on. */
  onRebootFailed: (listener: (detail: string) => void) => void;
}): {
  router: Router;
  start: () => void;
  stop: () => void;
  startReconciler: () => void;
} {
  const dir = claudeUpdatesDir();
  const { appRoot, supervised, isListening, requestReboot, onRebootFailed } = dependencies;

  const check = createUpdateCheckService({
    dir,
    appRoot,
    // The cli-version module's own reading, through its barrel: one cache for the whole server, so
    // this report and the chat runtime's decision to retire an old process never disagree.
    readInstalledCli: readInstalledCliVersion,
  });

  /**
   * Runs one git command in the repository root and answers its verdict — never rejecting.
   *
   * Both callers ask a yes/no question ("did this exit 0?", "what did it refuse with?"), so a git
   * that refused is an ANSWER here, not an exception: the code rides back with the words, and only a
   * git that could not start at all answers with a null code.
   */
  function runGit(argv: string[]): Promise<GitResult> {
    return new Promise((resolve) => {
      execFile('git', argv, { cwd: appRoot }, (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
          stdout,
          stderr,
        });
      });
    });
  }

  const spawnRunner = (mode: 'install' | 'rollback'): number => spawnUpdateRunner(appRoot, dir, mode);
  /** What the reconciler asks for when it ends a job: the check's own entry, which never rejects. */
  const runCheck = (): void => void check.checkNow();

  const reconciler = createUpdateReconciler({
    dir,
    appRoot,
    isListening,
    readInstalledCli: readInstalledCliVersion,
    // What THIS process imported, read once as the packages module was evaluated at boot.
    loadedSdkVersion: LOADED_SDK_VERSION,
    requestReboot,
    onRebootFailed,
    spawnRunner,
    runCheck,
    runGit,
  });

  const actions = createUpdateActions({
    dir,
    check,
    reconciler,
    spawnRunner,
    runGit,
    requestReboot,
    supervised,
    readInstalledCli: readInstalledCliVersion,
  });

  /**
   * The job as a report carries it: the file, plus the tail of the log beside it.
   *
   * The tail is read here and never stored — `job.json` keeps `logTail` empty, because a job file
   * that grew with the log it sits beside would be rewritten whole on every step.
   */
  function currentJob(): ClaudeUpdateJob | null {
    const job = readJob(dir);
    return job === null ? null : { ...job, logTail: readLogTail(dir, LOG_TAIL_LINES) };
  }

  return {
    router: createClaudeUpdatesRouter({
      report: () => check.report(currentJob(), supervised),
      checkNow: () => check.checkNow(),
      applyUpdate: actions.applyUpdate,
      restartServer: actions.restartServer,
    }),
    start: () => check.start(),
    // The reconciler stops with the check: a shutdown owes nothing to a job the runner is holding,
    // and the process that comes next reads the same file and picks it up.
    stop: () => {
      check.stop();
      reconciler.stop();
    },
    startReconciler: () => reconciler.start(),
  };
}
