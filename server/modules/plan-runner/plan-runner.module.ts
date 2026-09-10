import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RunnerStateEvent, RunnerVerb } from '@/shared/types.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

import { createPlanRunnerRouter } from './plan-runner.routes.js';
import { snapshotRuns } from './runner-state.service.js';
import { runRunnerVerb } from './runner-verb.service.js';
import { createRunnerWatcher } from './runner-watcher.service.js';

/**
 * Where the plan runner keeps its runs, unless the operator moved it. The env name is the
 * runner's OWN (`scripts/runner_statusline.py:98-118` reads the same one), so pointing a probe
 * at a hermetic tree moves the bar and this lane together rather than splitting them.
 */
const DEFAULT_STATE_DIR = '~/.claude/state/runner';

/** The runner's entry point, unless the operator moved it. */
const DEFAULT_BIN = '~/.claude/scripts/plan-runner';

/**
 * How old a heartbeat may be before a run reads as stale, in seconds. The number is the
 * statusline's own (`runner_statusline.py:25`), so the terminal bar and this lane never disagree
 * about which runs are moving.
 */
const STALE_AFTER_S = 900;

/**
 * How long an ended run stays in the tab after its receipt, so the operator sees it finish and
 * dismisses it themselves (2026-09-09). Past this it is omitted whether dismissed or not — the
 * state root holds dozens of old receipts and the tab is not an archive.
 */
const ENDED_KEEP_S = 24 * 60 * 60;

/**
 * How often the state directory is read. A few dozen `stat` calls, most of which answer from the
 * cache without a decode; fast enough that a stage change reaches the tab while the reader is
 * still looking at the previous one, and slow enough to be free.
 */
const POLL_MS = 2000;

/**
 * Wall-clock ceiling for one relayed verb. `resume` re-reads the plan, takes the lock and
 * detaches a daemon before its own process exits, which is seconds rather than milliseconds.
 */
const VERB_TIMEOUT_MS = 20000;

/** `~` at the front becomes this user's home. Anywhere else it is an ordinary character. */
function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

/**
 * The directory holding the Claude CLI, or `null`.
 *
 * A resumed run spawns souls that look the CLI up on their own `PATH`, and the server's `PATH` is
 * whatever its unit was given — on this host, without it. Asked through the module that answers
 * "which file does a run spawn" rather than through a second resolution rule of our own, because
 * two rules drift. A relative answer (a bare `claude` found on someone else's `PATH`) names no
 * directory, so it is `null` rather than a guess.
 */
function resolveClaudeBinDir(): string | null {
  const binaryPath = resolveClaudeCodeExecutablePath();
  return binaryPath && path.isAbsolute(binaryPath) ? path.dirname(binaryPath) : null;
}

export type PlanRunnerModule = {
  router: Router;
  start(): void;
  stop(): void;
};

/**
 * Builds the plan-runner lane for the server entrypoint: the poll, the frame, and the two verbs.
 *
 * The composition root is the only place here that reads the environment, names a path, spawns
 * anything or touches a socket. Everything under it takes what it needs as an argument, which is
 * what lets the whole classification be proven against a fixture run directory with no runner
 * process in existence.
 *
 * The frame goes out over `connectedClients` — every open `/ws` socket — and not over the raw
 * `wss.clients` set, which would also deliver it to `/shell`, `/plugin-ws` and
 * `/desktop-notifications`, where it would be parsed and dropped, and on `/plugin-ws` handed to
 * third-party plugin frontends that have no business seeing it (`taskmaster.routes.ts:30-50`).
 */
export function createPlanRunnerModule(): PlanRunnerModule {
  const stateDir = expandHome(process.env.PLAN_RUNNER_STATE_DIR || DEFAULT_STATE_DIR);
  const bin = expandHome(process.env.PLAN_RUNNER_BIN || DEFAULT_BIN);
  const claudeBinDir = resolveClaudeBinDir();

  const broadcast = (frame: RunnerStateEvent): void => {
    const message = JSON.stringify(frame);
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(message);
    });
  };

  /**
   * The lane's one door to the journal, and the one thing that bounds its volume.
   *
   * Everything under this root polls every two seconds, so a fault that persists is a fault that
   * repeats — a broken state directory would otherwise write thousands of identical lines and
   * bury everything else in the journal. Said once per distinct message, for the life of the
   * process. This server has no logger; a module that must say something takes a closure from
   * its composition root (`system.module.ts:57-58`) rather than reaching for one.
   */
  const said = new Set<string>();
  const logErrorOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    console.error(message);
  };

  const watcher = createRunnerWatcher({
    // Epoch SECONDS: every timestamp the runner writes comes from Python's `time.time()`, and a
    // millisecond clock compared against one of them makes every run on the host read live.
    snapshot: () =>
      snapshotRuns(
        stateDir,
        Date.now() / 1000,
        STALE_AFTER_S,
        (dir, message) => logErrorOnce(`[PlanRunner] could not read run directory ${dir}: ${message}`),
        ENDED_KEEP_S,
      ),
    broadcast,
    pollMs: POLL_MS,
    logError: logErrorOnce,
  });

  const router = createPlanRunnerRouter({
    current: () => watcher.current(),
    runVerb: (verb: RunnerVerb, runId: string) =>
      runRunnerVerb(verb, runId, { bin, timeoutMs: VERB_TIMEOUT_MS, claudeBinDir }),
  });

  return {
    router,
    start: () => watcher.start(),
    stop: () => watcher.stop(),
  };
}
