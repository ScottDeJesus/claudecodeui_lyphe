import type { Router } from 'express';

import { appConfigDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { DispatcherStateEvent, DispatcherVerb } from '@/shared/types.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { expandHome } from '@/shared/utils.js';

import { createDispatcherAnswerRouter } from './dispatcher-answer.routes.js';
import { createDispatcherEndingsNotifier } from './dispatcher-endings.service.js';
import type { DispatcherEnding } from './dispatcher-endings.service.js';
import { createOffpeakClock } from './dispatcher-offpeak.service.js';
import { createDispatcherPrompts } from './dispatcher-prompts.module.js';
import { createDispatcherRouter } from './dispatcher.routes.js';
import { readDispatcherState } from './dispatcher-state.service.js';
import { runDispatcherVerb } from './dispatcher-verb.service.js';
import { createDispatcherWatcher } from './dispatcher-watcher.service.js';

/**
 * The dispatcher lane: what plans this host holds, and the five words the operator may say to one
 * of them.
 *
 * The dispatcher is the plan store's OWN owner — a SQLite store under `~/.claude/state/dispatcher`,
 * a daemon that walks one phase at a time, and a command that answers `status --json` (`hooks/
 * dispatcher/`). NOTHING HERE WRITES ANY OF IT. The lane reads one document, relays verbs, and puts
 * the prompts a plan owes the operator up on the plan's card in the Runner tab and in the Runner
 * widget, and on his phone — the ask recorded by the dispatcher's own `ask` verb
 * (`dispatcher-raise.service.ts`), shown from the document's `asking` key
 * (`dispatcher-asks.service.ts`), and answered through its own `accept` and `tell`. The dispatcher
 * decides what each verb means and prints its own refusal when it will not act. That division is the
 * whole design, and it is the reason no route in this module can put this server's words into the
 * store.
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
 * their process exits — seconds rather than milliseconds.
 */
const VERB_TIMEOUT_MS = 20000;

/**
 * How long a read of the plan list waits for this boot's first `dispatcher status --json`.
 *
 * The read the lane starts at construction lands in tens of milliseconds on an ordinary host, so this
 * bound is only ever felt when the dispatcher's command is slow or wedged — and a reader is owed an
 * answer either way. Long enough that a first read on a loaded box is waited out rather than reported
 * missing; short enough that a page hung on a wedged binary is told "not read yet" while the tab is
 * still worth looking at, with the first landing's frame arriving on its own the moment it comes.
 */
const FIRST_READ_WAIT_MS = 5000;

/** The `app_config` key holding the highest event id already announced — durable on purpose, see `dispatcher-endings.service.ts`. */
const ANNOUNCED_THROUGH_KEY = 'dispatcher_announced_through';

/**
 * The orchestrator is JavaScript, so TypeScript reads `dedupeKey = null` as a parameter that accepts
 * only `null`. This alias states the contract it actually implements.
 */
const buildEndingEvent = createNotificationEvent as (input: {
  provider: 'system';
  kind: 'stop' | 'error';
  code: DispatcherEnding['code'];
  meta: DispatcherEnding['meta'];
  severity: 'info' | 'warning';
  dedupeKey: string | null;
}) => object;

/**
 * The lane's child environment: the server's own, minus the two names that say WHOSE SESSION a verb
 * runs in. This server is nobody's Claude session, whatever shell it was started from, and the
 * dispatcher reads those names as exactly that: `accept` refuses inside a Claude session (the
 * operator's press on a prompt this lane raised is his own, and must land), and `tell` writes the
 * session it finds onto the outing it queues, where a stray id would own the designer's next load.
 */
function laneEnv(): NodeJS.ProcessEnv {
  const env = userFacingEnv({ PATH: process.env.PATH ?? DEFAULT_PATH });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.DISPATCHER_SESSION;
  return env;
}

export type DispatcherModule = {
  router: Router;
  start(): void;
  stop(): void;
};

export function createDispatcherModule(): DispatcherModule {
  const bin = expandHome(process.env.DISPATCHER_BIN || DEFAULT_BIN);
  const env = laneEnv();

  /** Every frame this module's sockets carry: the lane's own picture, and nothing else. */
  const broadcast = (frame: object): void => {
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
      // Every code is a look except one warning: a plan or an epic that finished, or a plan that
      // paused, is a state to read at leisure, while a phase taken up again is the walk changing its
      // mind about something the operator may already have given up on. What an epic's features
      // earn is decided before this point (`dispatcher-endings.service.ts`); this sends what it is handed.
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

  const commands = { bin, timeoutMs: VERB_TIMEOUT_MS, env };
  const prompts = createDispatcherPrompts({ commands, log: logErrorOnce });

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
        endings.observe(frame.plans, frame.arcs);
      } catch (error) {
        logErrorOnce(`[Dispatcher] could not announce an ending: ${error instanceof Error ? error.message : String(error)}`);
      }
      // The prompts a plan owes the operator ride the same picture and the same rule, and never cost
      // the tabs their frame either (`dispatcher-prompts.module.ts` logs its own failures).
      prompts.observe(frame);
      broadcast(frame);
    },
    pollMs: POLL_MS,
    logError: logErrorOnce,
  });

  const router = createDispatcherRouter({
    // A read waits, bounded, for this boot's first reading rather than being handed a picture nobody
    // has read; past the bound it is told so, and the landing's own frame fills the tab.
    current: () => watcher.whenLanded(FIRST_READ_WAIT_MS),
    runVerb: (verb: DispatcherVerb, plan: string, verbArgs?: readonly string[]) =>
      runDispatcherVerb(verb, plan, commands, verbArgs),
    // The dispatcher's own `offpeak` verb prints the hour, so the card's `Start at …` button shows the
    // moment this box will really start a plan.
    offpeak: createOffpeakClock({ bin, timeoutMs: VERB_TIMEOUT_MS }),
  });
  // The card's own door, beside the verbs and the reads: `POST /api/dispatcher/answer`. Mounted on
  // the lane's router rather than written into it because it answers through the PROMPTS root, whose
  // book owns the ask, and because that router is at its size ceiling already.
  router.use(createDispatcherAnswerRouter({ answer: prompts.answer }));

  return {
    router,
    start: () => watcher.start(),
    stop: () => {
      prompts.stop();
      watcher.stop();
    },
  };
}
