import type { Router } from 'express';

import { appConfigDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RelayAnswer, RelayOrder } from '@/shared/relayed-press-types.js';
import type { DispatcherArc, DispatcherStateEvent, DispatcherVerb } from '@/shared/types.js';
import { sessionlessEnv } from '@/shared/child-env.js';
import type { DispatcherStoreWatch } from '@/shared/dispatcher-store-watch.service.js';
import { dispatcherBin } from '@/shared/dispatcher-command.js';

import { createDispatcherAnswerRouter } from './dispatcher-answer.routes.js';
import { readCardText, type DispatcherCardText } from './dispatcher-card-text.service.js';
import { createDispatcherEndingsNotifier } from './dispatcher-endings.service.js';
import type { DispatcherEnding } from './dispatcher-endings.service.js';
import { createDispatcherFollowups } from './dispatcher-followups.module.js';
import { createOffpeakClock } from './dispatcher-offpeak.service.js';
import { createDispatcherPrompts } from './dispatcher-prompts.module.js';
import { isLockOrder, relayAnswerOf, relayOrder, replyOfLockOrder } from './dispatcher-relay.service.js';
import { createDispatcherRouter } from './dispatcher.routes.js';
import { lanePictureOf, readDispatcherStore, type DispatcherPicture } from './dispatcher-state.service.js';
import { runDispatcherVerb } from './dispatcher-verb.service.js';
import { createDispatcherWatcher } from './dispatcher-watcher.service.js';

/**
 * The dispatcher lane: what plans this host holds, and the five words the operator may say to one
 * of them.
 *
 * The dispatcher is the plan store's OWN owner — a SQLite store under `~/.claude/state/dispatcher`,
 * a daemon that walks one phase at a time, and a command that answers `status --json` (`hooks/
 * dispatcher/`). NOTHING HERE WRITES ANY OF IT. The lane reads one document, relays verbs, and puts
 * the prompts a plan owes the operator up on the plan's card in the Roadmap tab's In flight face and in the Runs
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

/**
 * How long the lane goes without reading when nothing has poked it. The document is read when
 * something it is read from is WRITTEN (`dispatcher-store-watch.service.ts` pokes the lane); this is
 * the one clock left, and it exists for the state no write announces — a walker, a soul or the daemon
 * killed with nothing left to write (`report_stall` calls a walk ended only after a 60 s grace
 * of silence, and nothing writes when that grace runs out), the UTC hour a peak window ends at
 * (`route.peak_until`, `offpeak_at`), the pacer's projection drifting on its own clock.
 *
 * Sixty seconds because every one of those is a minute-scale fact — the shortest is that grace — and a
 * reading costs seconds of CPU (`status --json` walks every plan's chain record and asks systemd about
 * each one's armed hour): a shorter backstop would buy nothing a reader could see at the price of a
 * continuous load. It is measured from the last reading that settled, so a lane that is being poked
 * often never fires it.
 */
const BACKSTOP_MS = 60_000;

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

/** The `app_config` key holding the highest event id already KEPT as a record (`dispatcher.feature_finished`): a mark of its own beside the push one, for the reason `dispatcher-endings.service.ts` gives. */
const RECORDED_THROUGH_KEY = 'dispatcher_recorded_through';

/** The `app_config` key holding the highest record id of an EPIC's own log (`arc_events`) whose `no-run` alert was already announced: a mark of its own, because those ids are a sequence of their own and the push mark is a plan-event id (`dispatcher-arc-alerts.service.ts`). Its stamp rides beside it (`ARC_ALERT_STAMP_KEY`). */
const ARC_ALERT_THROUGH_KEY = 'dispatcher_arc_alert_through';

/** The `app_config` key holding the latest record stamp already announced, the other half of the epic alerts' mark: the store hands an id out again (`arc_events.id` has no AUTOINCREMENT) and a record that took one is told by its stamp. A key of its own, so the id key keeps the one meaning it always had and a mark stored as a bare id reads with no stamp. */
const ARC_ALERT_STAMP_KEY = 'dispatcher_arc_alert_through_at';

/** One of those marks as the whole number stored, or `null` when none was ever stored. */
function readStoredMark(key: string): number | null {
  const raw = appConfigDb.get(key);
  const mark = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(mark) ? mark : null;
}

/**
 * The orchestrator is JavaScript, so TypeScript reads `dedupeKey = null` as a parameter that accepts
 * only `null`. This alias states the contract it actually implements. `kind` is the one typed union of the
 * kinds an ending is handed as: `record` is kept and never pushed (a feature of an epic finishing), and
 * `sessionId` is the chat that asked for the work, `null` for an ending that names none.
 */
const buildEndingEvent = createNotificationEvent as (input: {
  provider: 'system';
  kind: 'stop' | 'error' | 'record';
  sessionId: string | null;
  code: DispatcherEnding['code'];
  meta: DispatcherEnding['meta'];
  severity: 'info' | 'warning';
  dedupeKey: string | null;
}) => object;

/**
 * The endings that are a warning and not a look: a phase the walk had left standing and took up again (`dispatcher.relaunched`), and a
 * piece of planning the house could not get a run behind, whose own sentence says what it tried (`dispatcher.no_run`). Both tell the
 * operator of something he may need to act on, so both are handed on as an `error` kind with the `warning` severity.
 */
const WARNING_CODES: ReadonlySet<DispatcherEnding['code']> = new Set(['dispatcher.relaunched', 'dispatcher.no_run']);

/**
 * The kind an ending is handed to the orchestrator as. A feature of an epic finishing is a `record` — the history keeps it, the
 * station's strip draws it, and no push preference or channel hears it — and a relaunch and a `no_run` are the two warnings (`error`).
 * Every other code is a look (`stop`).
 */
function kindOfEnding(ending: DispatcherEnding): 'stop' | 'error' | 'record' {
  if (ending.code === 'dispatcher.feature_finished') return 'record';
  return WARNING_CODES.has(ending.code) ? 'error' : 'stop';
}

/**
 * Tells every active user about one ending: one event per user, handed to the orchestrator, whose event switches and channels decide
 * what reaches each of them. A plan belongs to no login, so every active user is told, and the dedupe key carries the user because
 * the orchestrator's dedupe is process-wide: without it the second user's push reads as a repeat.
 *
 * Every code is a look except two warnings (`WARNING_CODES`): a plan or an epic that finished, or a plan that paused, is a state to read
 * at leisure, while a phase taken up again is the walk changing its mind about something the operator may already have given up on, and a
 * `no_run` is the house saying a piece of planning has no run behind it and that it could not mend that. What an
 * epic's features earn is decided before this point (`dispatcher-endings.service.ts`); this sends what it is handed. A landing
 * (`dispatcher.finished`, `dispatcher.epic_finished`, `dispatcher.feature_finished`) carries the chat that asked for the work as the
 * event's `sessionId`, so a tap on its push opens that chat — while the house still holds the chat: the plan's `session_app_id` is
 * its `session` handed back unchanged when no chat matches, and a tap on a chat that is gone would open nothing where the root opens
 * the app. A pause and a relaunch carry none and land on the root.
 *
 * One user's failure costs that user's push and nothing more, and is reported through `logError`: letting it throw would leave the
 * ending due, and its retry would push again to every user already told.
 *
 * Consumed by `createDispatcherModule`'s endings notifier below, and by `.verify/kaylee-feature-landed-direct.mjs`, which runs the
 * module's own function over a scratch copy of the database.
 */
export function announceDispatcherEnding(ending: DispatcherEnding, logError: (message: string) => void): void {
  const chat = ending.sessionId !== null && sessionsDb.getSessionById(ending.sessionId) ? ending.sessionId : null;
  for (const userId of userDb.getActiveUserIds()) {
    try {
      notifyUserIfEnabled({
        userId,
        event: buildEndingEvent({
          provider: 'system',
          kind: kindOfEnding(ending),
          sessionId: chat,
          code: ending.code,
          meta: ending.meta,
          severity: WARNING_CODES.has(ending.code) ? 'warning' : 'info',
          dedupeKey: `dispatcher:${userId}:${ending.key}`,
        }),
      });
    } catch (error) {
      logError(`[Dispatcher] could not announce an ending to user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * What `createDispatcherModule` hands the server entrypoint: the router to mount, the lane's `start` (after `listen`)
 * and `stop` (at shutdown), and the readers only this instance holds, which the entrypoint passes on to the
 * companion's house (`CompanionHouse.dispatcher`, `.cardText`, `.askOpen`, `.relay`):
 *   - `picture()` is the lane's picture behind `whenLanded`, bounded exactly as the router's `current` is: `null`
 *     while this boot's first reading has not landed;
 *   - `cardText(name)` is `dispatcher show <name>`, run with the lane's own command and child environment;
 *   - `askOpen(promptKey)` is whether the book of the open prompts still holds one, read at once from memory: false the moment an
 *     answer is carried through any door or a picture shows the ask closed (`DispatcherAsks.isOpen`). The companion's alert feed asks
 *     it at the last moment before she would say an Accept;
 *   - `relay(order)` carries one act of Kaylee's on his word, spoken or typed, with kaylee--press's record of it: the answer to an
 *     open prompt goes through the book of the open asks as its third door (`kaylee`, beside the card and the phone), every
 *     other act is a dispatcher verb of its own run with `--relay` (`dispatcher-relay.service.ts`). The companion's house
 *     hands it to her `take_action` (`CompanionHouse.relay`). An act the dispatcher took pokes the lane, as the card's verbs do.
 */
export type DispatcherModule = {
  router: Router;
  start(): void;
  stop(): void;
  picture(): Promise<DispatcherPicture | null>;
  cardText(name: string): Promise<DispatcherCardText>;
  askOpen(promptKey: string): boolean;
  relay(order: RelayOrder): Promise<RelayAnswer>;
};

/** The chains of the phases running in this picture: the records `dispatcher-store-watch.service.ts` keeps watched. */
function runningChainIds(picture: DispatcherPicture): string[] {
  const ids: string[] = [];
  for (const plan of picture.plans) {
    for (const phase of plan.phases) {
      if (phase.status === 'running' && phase.chain_id) ids.push(phase.chain_id);
    }
  }
  return ids;
}

/** `storeWatch` is the one watch both dispatcher lanes share; the server entrypoint builds it and starts it before either lane. */
export function createDispatcherModule(storeWatch: DispatcherStoreWatch): DispatcherModule {
  const bin = dispatcherBin();
  // The lane's child environment: the server's own, minus the names that say whose Claude session a verb runs in.
  const env = sessionlessEnv();

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
   * A read that keeps failing keeps failing on every poke and every backstop, and a body
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
    readMark: () => readStoredMark(ANNOUNCED_THROUGH_KEY),
    writeMark: (eventId) => appConfigDb.set(ANNOUNCED_THROUGH_KEY, String(eventId)),
    readRecordMark: () => readStoredMark(RECORDED_THROUGH_KEY),
    writeRecordMark: (eventId) => appConfigDb.set(RECORDED_THROUGH_KEY, String(eventId)),
    readArcAlertMark: () => {
      const id = readStoredMark(ARC_ALERT_THROUGH_KEY);
      return id === null ? null : { id, at: appConfigDb.get(ARC_ALERT_STAMP_KEY) };
    },
    // The stamp first: a stop between the two writes leaves the stamp ahead of the id, which can only tell one alert twice and never swallow one.
    writeArcAlertMark: (mark) => {
      if (mark.at !== null) appConfigDb.set(ARC_ALERT_STAMP_KEY, mark.at);
      appConfigDb.set(ARC_ALERT_THROUGH_KEY, String(mark.id));
    },
    announce: (ending) => announceDispatcherEnding(ending, logErrorOnce),
  });

  /**
   * The epics of the STORE as the latest reading found them — every one, where the lane's picture keeps only those with a plan still on
   * it (`arcsOnLane`). The endings notifier reads the epics' own `no-run` alerts from it: the epic whose own design never started has no
   * plan at all, the lane drops it, and it is the one that alert is for. Set by `snapshot` and read by the `broadcast` that follows that
   * very reading (`polled-lane.service.ts` lands one reading at a time and broadcasts it before the next begins).
   */
  let storeArcs: DispatcherArc[] = [];

  const commands = { bin, timeoutMs: VERB_TIMEOUT_MS, env };
  const prompts = createDispatcherPrompts({ commands, log: logErrorOnce });

  const followups = createDispatcherFollowups(logErrorOnce);

  const watcher = createDispatcherWatcher({
    // One subprocess, and the promise support in `polled-lane.service.ts` is what a tick does with
    // it: a tick that arrives while this read is still out is SKIPPED rather than queued (a poke
    // that lands mid-read is remembered and answered by one more), and a
    // read that throws (a different build's document, a store mid-move) leaves the last good picture
    // on the tab with one line in the journal.
    snapshot: async () => {
      const store = await readDispatcherStore({ bin, timeoutMs: VERB_TIMEOUT_MS, env });
      // The follow-ups lane reads the store WHOLE, before the lane cuts its picture from it: the picture forgets a
      // plan a day after it ends, and a feature that finished while this server was down must still settle its items
      // however long ago (`dispatcher-followups.module.ts`). Settled before the frame exists, so the "feature finished"
      // alert `endings` raises next lists no item the completion closed and every gap the finish filed.
      followups.settle(store);
      const picture = lanePictureOf(store);
      storeArcs = store.arcs;
      // The running phases name the chain records the watch follows: a walk's progress is written there
      // and nowhere in the store until it ends.
      storeWatch.followChains(runningChainIds(picture));
      return picture;
    },
    // Endings are read off the same picture the tabs receive, and only when it changed — which an
    // ending always is. A failure to announce never costs the tabs their frame. The epics' own `no-run`
    // alerts are read from the store's epics (`storeArcs`), never the lane's cut of them; one still moves
    // the picture, because the epic's outing, which `planners` carries whole, reads the same sentence.
    broadcast: (frame) => {
      try {
        endings.observe(frame.plans, storeArcs);
      } catch (error) {
        logErrorOnce(`[Dispatcher] could not announce an ending: ${error instanceof Error ? error.message : String(error)}`);
      }
      // The prompts a plan owes the operator ride the same picture and the same rule, and never cost
      // the tabs their frame either (`dispatcher-prompts.module.ts` logs its own failures).
      prompts.observe(frame);
      broadcast(frame);
    },
    backstopMs: BACKSTOP_MS,
    logError: logErrorOnce,
  });

  const router = createDispatcherRouter({
    // A read waits, bounded, for this boot's first reading rather than being handed a picture nobody
    // has read; past the bound it is told so, and the landing's own frame fills the tab.
    current: () => watcher.whenLanded(FIRST_READ_WAIT_MS),
    // A verb the dispatcher took pokes the lane (`PolledLane.poke`, as the roadmap's writes do): the card, the Inbox and the
    // station's rail redraw on the picture that follows the press. The store watch pokes for the same commit a moment
    // later, so this is the press's own door: it does not wait on a watch having armed, nor on the watch's settle window.
    runVerb: async (verb: DispatcherVerb, plan: string, verbArgs?: readonly string[]) => {
      const result = await runDispatcherVerb(verb, plan, commands, verbArgs);
      if (result.ok) watcher.poke();
      return result;
    },
    // The dispatcher's own `offpeak` verb prints the hour, so the card's `Resume at …` button shows the
    // moment this box will really start a plan.
    offpeak: createOffpeakClock({ bin, timeoutMs: VERB_TIMEOUT_MS }),
  });
  // The card's own door, beside the verbs and the reads: `POST /api/dispatcher/answer`. Mounted on
  // the lane's router rather than written into it because it answers through the PROMPTS root, whose
  // book owns the ask, and because that router is at its size ceiling already.
  router.use(createDispatcherAnswerRouter({
    // An answer the dispatcher took pokes the lane for the same reason a verb does: an Accept answered from the card leaves the
    // card, the Inbox and the station's rail on the next picture, which the poke brings at once.
    answer: async (ask, decision) => {
      const reply = await prompts.answer(ask, decision);
      if (reply.outcome === 'took') watcher.poke();
      return reply;
    },
  }));

  let detach: (() => void) | null = null;

  return {
    router,
    start: () => {
      // Attached before the lane's first reading, so a write that lands during it is remembered as a poke.
      detach ??= storeWatch.attach('status', () => watcher.poke());
      watcher.start();
    },
    stop: () => {
      prompts.stop();
      detach?.();
      detach = null;
      watcher.stop();
    },
    picture: () => watcher.whenLanded(FIRST_READ_WAIT_MS),
    cardText: (name: string) => readCardText(name, commands),
    // Whether the book of open prompts still holds one — the companion's alert feed asks it at the last moment before she would say an Accept.
    askOpen: (promptKey: string) => prompts.askOpen(promptKey),
    relay: async (order: RelayOrder) => {
      const answer = await (isLockOrder(order)
        ? prompts.answerOnHisWord(order.ask, replyOfLockOrder(order), order.press).then(relayAnswerOf)
        : relayOrder(order, commands, (line) => console.log(line)));
      // His word, carried by Kaylee, is the third door beside the card's verbs and answers, and it pokes the lane for the same reason they do: the card, the
      // Inbox and the station's rail leave the Accept on the picture that follows his yes.
      if (answer.outcome === 'took') watcher.poke();
      return answer;
    },
  };
}
