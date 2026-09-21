import path from 'node:path';

import type { Router } from 'express';

import { appConfigDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RunnerRunSnapshot, RunnerStateEvent, RunnerVerb } from '@/shared/types.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { expandHome } from '@/shared/utils.js';

import { createPlanRunnerRouter } from './plan-runner.routes.js';
import { sweepPlanArchive } from './plan-archive.service.js';
import { createRunnerEndingsNotifier } from './runner-endings.service.js';
import type { RunnerEnding } from './runner-endings.service.js';
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

/** The `app_config` key holding the newest `ended_at` already announced — durable on purpose, see `runner-endings.service.ts`. */
const ANNOUNCED_THROUGH_KEY = 'plan_runner_announced_through';

/**
 * How long the plans-archive sweep waits after construction before its first pass, in milliseconds.
 *
 * A settle window of ~2 min, for its own reason: a boot still warming must not race the first
 * sweep, and this server restarts far more often than once a day — so the pass AFTER THE SETTLE is
 * what reliably runs, and a daily timer measured from boot would be reset by the next restart
 * before it ever fired.
 */
const ARCHIVE_SETTLE_MS = 120_000;

/** How often the sweep runs once that first pass has happened (24 h). */
const ARCHIVE_INTERVAL_MS = 86_400_000;

/**
 * The orchestrator is JavaScript, so TypeScript reads `dedupeKey = null` as a parameter that
 * accepts only `null`. This alias states the contract it actually implements, the same way
 * `run-stall-watchdog.service.ts` does.
 */
const buildEndingEvent = createNotificationEvent as (input: {
  provider: 'system';
  kind: 'stop' | 'error';
  code: RunnerEnding['code'];
  meta: RunnerEnding['meta'];
  severity: 'info' | 'warning';
  dedupeKey: string | null;
}) => object;

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

/** What the entrypoint hands this lane: the one reading that lives outside it. */
export type PlanRunnerDependencies = {
  /**
   * The plan paths a card's plan or build lease is holding right now, asked afresh on EVERY pass —
   * never captured here, so a lease taken after this module was built still stops the sweep.
   *
   * The board answers this from its own barrel and `server/index.ts` joins the two; nothing under
   * this module imports the board, which is what keeps the sweep's one reach into board rows in the
   * composition root where the join belongs.
   */
  heldPlanPaths: () => string[];
};

/**
 * The ONE place a run's launching session becomes an app id.
 *
 * `run.json` records the Claude transcript uuid whose turn launched the run, and no browser ever
 * learns a provider id — translation belongs on this side of the wire, and it belongs in exactly
 * one place so the lanes cannot drift. BOTH readers pass through here: `GET /runs` (through
 * `current()`) and the `runner_state` broadcast (through the same snapshot callback), so no path
 * can ship the raw uuid by going around it. A run that names no launching session stays `null` —
 * "no chat launched this" is an answer, and `resolveAppSessionId` is never asked about it.
 */
function resolveLaunchingSessions(runs: RunnerRunSnapshot[]): RunnerRunSnapshot[] {
  return runs.map((run) => ({
    ...run,
    launched_by_session:
      run.launched_by_session === null ? null : sessionsDb.resolveAppSessionId(run.launched_by_session),
  }));
}

/**
 * Builds the plan-runner lane for the server entrypoint: the poll, the frame, the two verbs, and
 * the notification each ending earns.
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
 *
 * This construction is also where the plans-archive sweep is ARMED — its settle timer starts here,
 * so the module it belongs to is the module that owns its cadence (`runArchivePass` below). It is
 * read-only work on the plans corpus and it speaks to no socket, so it costs the lane nothing.
 */
export function createPlanRunnerModule({ heldPlanPaths }: PlanRunnerDependencies): PlanRunnerModule {
  const stateDir = expandHome(process.env.PLAN_RUNNER_STATE_DIR || DEFAULT_STATE_DIR);
  const bin = expandHome(process.env.PLAN_RUNNER_BIN || DEFAULT_BIN);
  const claudeBinDir = resolveClaudeBinDir();

  /** The daily sweep's interval, created once from the settle callback and cleared by `stop()`. */
  let archiveTimer: NodeJS.Timeout | null = null;

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

  const endings = createRunnerEndingsNotifier({
    readMark: () => {
      const raw = appConfigDb.get(ANNOUNCED_THROUGH_KEY);
      const mark = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(mark) ? mark : null;
    },
    writeMark: (endedAt) => appConfigDb.set(ANNOUNCED_THROUGH_KEY, String(endedAt)),
    // A run belongs to no login, so every active user is told and each user's own event switches
    // and channels decide what reaches them. The dedupe key carries the user because the
    // orchestrator's dedupe is process-wide: without it the second user's push reads as a repeat.
    announce: (ending) => {
      const finished = ending.code === 'runner.finished';
      for (const userId of userDb.getActiveUserIds()) {
        // One user's failure costs that user's push and nothing more. Letting it throw would leave
        // the ending due, and its retry would push again to every user already told.
        try {
          notifyUserIfEnabled({
            userId,
            event: buildEndingEvent({
              provider: 'system',
              kind: finished ? 'stop' : 'error',
              code: ending.code,
              meta: ending.meta,
              severity: finished ? 'info' : 'warning',
              dedupeKey: `runner:${userId}:${ending.key}`,
            }),
          });
        } catch (error) {
          logErrorOnce(`[PlanRunner] could not announce an ending to user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  });

  const watcher = createRunnerWatcher({
    // Epoch SECONDS: every timestamp the runner writes comes from Python's `time.time()`, and a
    // millisecond clock compared against one of them makes every run on the host read live.
    // Every run leaves here with its launching session already an app id (`resolveLaunchingSessions`),
    // because this callback is what both the REST read and the broadcast are given.
    snapshot: () =>
      resolveLaunchingSessions(
        snapshotRuns(
          stateDir,
          Date.now() / 1000,
          STALE_AFTER_S,
          (dir, message) => logErrorOnce(`[PlanRunner] could not read run directory ${dir}: ${message}`),
          ENDED_KEEP_S,
        ),
      ),
    // Endings are read off the same picture the tabs receive, and only when it changed — which an
    // ending always is. A failure to announce never costs the tabs their frame.
    broadcast: (frame) => {
      try {
        endings.observe(frame.runs, frame.at / 1000);
      } catch (error) {
        logErrorOnce(`[PlanRunner] could not announce an ending: ${error instanceof Error ? error.message : String(error)}`);
      }
      broadcast(frame);
    },
    pollMs: POLL_MS,
    logError: logErrorOnce,
  });

  const router = createPlanRunnerRouter({
    current: () => watcher.current(),
    runVerb: (verb: RunnerVerb, runId: string) =>
      runRunnerVerb(verb, runId, { bin, timeoutMs: VERB_TIMEOUT_MS, claudeBinDir }),
  });

  /**
   * ONE pass of the plans-archive sweep. Never throws.
   *
   * The four clauses and the move live in `plan-archive.service.ts`; this only hands it the moment,
   * the verdict that a pass may write, and the plan paths the board's leases hold as of now. A fault
   * is logged once and swallowed — a sweep that ended the interval would silently stop archiving
   * for the life of the process, and one bad day costs nothing but a day's worth of moved files.
   */
  const runArchivePass = (): void => {
    try {
      const sweep = sweepPlanArchive(Date.now(), true, new Set(heldPlanPaths()));
      console.log(
        `[PlanRunner] plans-archive swept — ${sweep.moved.length} finished plan(s) moved, ` +
          `${Object.keys(sweep.held).length} left in place`
      );
    } catch (error) {
      logErrorOnce(
        `[PlanRunner] plans-archive sweep failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  // Settle, then daily. The settle is what actually fires on a server that restarts often, and the
  // interval is the backstop under one that lives long; both are unref'd, so neither keeps the
  // process alive, and the interval is created ONCE per construction, from the settle callback.
  const settleTimer = setTimeout(() => {
    runArchivePass();
    archiveTimer = setInterval(runArchivePass, ARCHIVE_INTERVAL_MS);
    archiveTimer.unref();
  }, ARCHIVE_SETTLE_MS);
  settleTimer.unref();

  return {
    router,
    start: () => watcher.start(),
    stop: () => {
      watcher.stop();
      clearTimeout(settleTimer);
      if (archiveTimer !== null) clearInterval(archiveTimer);
    },
  };
}
