import type { Router } from 'express';

import { appConfigDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { createOffpeakClock } from '@/modules/plan-runner/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { DispatcherStateEvent, DispatcherVerb } from '@/shared/types.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { expandHome } from '@/shared/utils.js';

import { createDispatcherEndingsNotifier } from './dispatcher-endings.service.js';
import type { DispatcherEnding } from './dispatcher-endings.service.js';
import { createDispatcherRouter } from './dispatcher.routes.js';
import { readDispatcherState } from './dispatcher-state.service.js';
import { runDispatcherVerb } from './dispatcher-verb.service.js';
import { createDispatcherWatcher } from './dispatcher-watcher.service.js';

/**
 * The v3 dispatcher lane: what plans this host holds, and the five words the operator may say to one
 * of them.
 *
 * The dispatcher is the plan store's OWN owner — a SQLite store under `~/.claude/state/dispatcher`,
 * a daemon that walks one phase at a time, and a command that answers `status --json` (`hooks/
 * dispatcher/`). NOTHING HERE WRITES ANY OF IT. The lane reads one document and relays verbs; the
 * dispatcher decides what each verb means and prints its own refusal when it will not act. That
 * division is the whole design, and it is the reason no route in this module can put this server's
 * words into the store.
 *
 * The composition root is the only place here that reads the environment, names a binary, spawns a
 * process or touches a socket. Everything under it takes what it needs as an argument, which is what
 * lets the document's classification be proven against a fixture body with no dispatcher in
 * existence.
 */

/** The dispatcher's entry point, unless the operator moved it. */
const DEFAULT_BIN = '~/.claude/scripts/dispatcher';

/**
 * The `PATH` a verb runs with when this process has none of its own.
 *
 * The dispatcher's verbs wake a daemon and arm calendar units, so they look up `systemctl --user` and
 * `systemd-run --user` on `PATH` — and this server's unit may have been handed none at all. The same
 * three directories every login shell falls back to, stated rather than left empty so a lookup can
 * succeed instead of failing in a way that reads like the dispatcher's fault.
 */
const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

/**
 * How often the document is read. One subprocess per tick over a store of a few dozen plans is tens
 * of milliseconds; fast enough that a phase changing state reaches the tab while the reader is still
 * looking at the previous one, and long enough that a walk in progress costs this host nothing.
 */
const POLL_MS = 2000;

/**
 * Wall-clock ceiling for one relayed verb. The verbs act on the store and may kick the daemon before
 * their process exits — seconds rather than milliseconds, and the same number the run lane's verbs
 * are given.
 */
const VERB_TIMEOUT_MS = 20000;

/** The `app_config` key holding the highest event id already announced — durable on purpose, see `dispatcher-endings.service.ts`. */
const ANNOUNCED_THROUGH_KEY = 'dispatcher_announced_through';

/**
 * The orchestrator is JavaScript, so TypeScript reads `dedupeKey = null` as a parameter that accepts
 * only `null`. This alias states the contract it actually implements, the same way
 * `plan-runner.module.ts` does.
 */
const buildEndingEvent = createNotificationEvent as (input: {
  provider: 'system';
  kind: 'stop' | 'error';
  code: DispatcherEnding['code'];
  meta: DispatcherEnding['meta'];
  severity: 'info' | 'warning';
  dedupeKey: string | null;
}) => object;

export type DispatcherModule = {
  router: Router;
  start(): void;
  stop(): void;
};

export function createDispatcherModule(): DispatcherModule {
  const bin = expandHome(process.env.DISPATCHER_BIN || DEFAULT_BIN);
  const env = userFacingEnv({ PATH: process.env.PATH ?? DEFAULT_PATH });

  /** Every frame this module's sockets carry. */
  const broadcast = (frame: DispatcherStateEvent): void => {
    const message = JSON.stringify(frame);
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(message);
    });
  };

  /**
   * The lane's one door to the journal, and the one thing that bounds its volume.
   *
   * A read that fails every two seconds is a read that fails thousands of times an hour, and a body
   * this build cannot parse would bury the journal in copies of one line. Said once per distinct
   * message, for the life of the process. This server has no logger; a module that must say
   * something takes a closure from its composition root (`system.module.ts:57-58`) rather than
   * reaching for one.
   */
  const said = new Set<string>();
  const logErrorOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    console.error(message);
  };

  const endings = createDispatcherEndingsNotifier({
    readMark: () => {
      const raw = appConfigDb.get(ANNOUNCED_THROUGH_KEY);
      const mark = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(mark) ? mark : null;
    },
    writeMark: (eventId) => appConfigDb.set(ANNOUNCED_THROUGH_KEY, String(eventId)),
    // A plan belongs to no login, so every active user is told and each user's own event switches
    // and channels decide what reaches them. The dedupe key carries the user because the
    // orchestrator's dedupe is process-wide: without it the second user's push reads as a repeat.
    announce: (ending) => {
      // Two codes are a look, one is a warning: a plan that finished or paused is a state to read at
      // leisure, while a phase taken up again is the walk changing its mind about something the
      // operator may already have given up on (`dispatcher-endings.service.ts`).
      const relaunched = ending.code === 'dispatcher.relaunched';
      for (const userId of userDb.getActiveUserIds()) {
        // One user's failure costs that user's push and nothing more. Letting it throw would leave
        // the ending due, and its retry would push again to every user already told.
        try {
          notifyUserIfEnabled({
            userId,
            event: buildEndingEvent({
              provider: 'system',
              kind: relaunched ? 'error' : 'stop',
              code: ending.code,
              meta: ending.meta,
              severity: relaunched ? 'warning' : 'info',
              dedupeKey: `dispatcher:${userId}:${ending.key}`,
            }),
          });
        } catch (error) {
          logErrorOnce(`[Dispatcher] could not announce an ending to user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  });

  const watcher = createDispatcherWatcher({
    // One subprocess, and the promise support in `polled-lane.service.ts` is what a tick does with
    // it: a tick that arrives while this read is still out is SKIPPED rather than queued, and a
    // read that throws (a different build's document, a store mid-move) leaves the last good picture
    // on the tab with one line in the journal.
    snapshot: () => readDispatcherState({ bin, timeoutMs: VERB_TIMEOUT_MS, env }),
    // Endings are read off the same picture the tabs receive, and only when it changed — which an
    // ending always is. A failure to announce never costs the tabs their frame.
    broadcast: (frame) => {
      try {
        endings.observe(frame.plans);
      } catch (error) {
        logErrorOnce(`[Dispatcher] could not announce an ending: ${error instanceof Error ? error.message : String(error)}`);
      }
      broadcast(frame);
    },
    pollMs: POLL_MS,
    logError: logErrorOnce,
  });

  const router = createDispatcherRouter({
    current: () => watcher.current(),
    runVerb: (verb: DispatcherVerb, plan: string, verbArgs?: readonly string[]) =>
      runDispatcherVerb(verb, plan, { bin, timeoutMs: VERB_TIMEOUT_MS, env }, verbArgs),
    // The dispatcher's own `offpeak` verb prints the runner's line byte for byte, so the card's
    // `Start at …` button reads one clock whichever lane it belongs to.
    offpeak: createOffpeakClock({ bin, timeoutMs: VERB_TIMEOUT_MS }),
  });

  return {
    router,
    start: () => watcher.start(),
    stop: () => watcher.stop(),
  };
}
