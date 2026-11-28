import {
  cerberusRedAlertsDb,
  getCerberusConnection,
  notificationChannelEndpointsDb,
} from '@/modules/database/index.js';
import {
  createNotificationEvent,
  notifyUserIfEnabled,
  type CerberusRedItem,
  type CerberusRedMeta,
} from '@/modules/notifications/index.js';
import type { CerberusOverview } from '@/shared/cerberus-types.js';
import { createDeadlineTimer, type DeadlineTimer } from '@/shared/deadline-timer.js';

import { onHintSent } from './cerberus-broadcast.js';
import { pushDiagnosisOf } from './red-watch-diagnosis.js';
import { planRedWatch, type RedWatchPlan } from './red-watch-plan.js';
import { tellTickets } from './red-watch-tickets.js';
import { wardenLinks } from './warden-links.js';

/**
 * The red watch: a check that stays failing or denied for an hour wakes the operator's phone.
 *
 * A plan reads the overview (the same one the tab reads, so the watch and the screen cannot
 * disagree about what is red), asks `planRedWatch` what moved, records it in `cerberus_red_alerts`, and hands
 * ONE event per recipient to the notification orchestrator — never one per check, so nine checks that cross
 * the hour together are one push, not nine. The orchestrator gates it by the user's `events.error` preference
 * and the ntfy channel publishes it (priority and tags by code, `ntfy-channel.service.ts`); this file never
 * talks to ntfy.
 *
 * WHEN IT PLANS: on every hint Cerberus sends (`onHintSent`: a result, a link up or down, a mute), at most one plan per
 * turn of the event loop however many arrive, and at the plan's own `nextAt` (`red-watch-plan.ts`), the nearest instant
 * the clock alone changes what it decides, armed on one deadline timer (`shared/deadline-timer.ts`). Nothing runs
 * between, and the line `[red-watch] next plan at <iso>` (or `nothing to wait for`) says what it waits for.
 *
 * WHO IS PAGED: every user with an enabled ntfy endpoint. With none, the tick still records its incidents —
 * the table is the truth about what is red and since when — and says so in one log line instead of a push.
 *
 * THE TABLE KEEPS A RESTART FROM PAGING AGAIN. This repo restarts the API on every save under `server/`, and
 * a fresh process knows nothing; what it reads from `cerberus_red_alerts` is which incidents were already
 * pushed and when. The incident is recorded BEFORE its push is handed over, in one transaction: a process that
 * dies between the two costs one missed page, where the other order would cost a double page on every restart.
 *
 * A PAGE CARRIES ITS TROUBLE'S FINISHED DIAGNOSIS. After the incident's transaction and before the event is handed
 * over, each newly red and each reminded check is looked up (`red-watch-diagnosis.ts`): the newest `done`
 * diagnosis since the red began, whoever asked for it, becomes the page's Likely cause and Proposed fix
 * (`cerberus-red-copy.service.ts`). The page keeps its own clock and never waits on a diagnosis: a red whose trouble
 * has none yet, one still running or one that failed pages on time without a cause, no second push follows
 * when a diagnosis finishes, and the next reminder carries it — a trouble already paged included. A lookup that
 * throws pages without it. Recoveries carry none.
 *
 * A RED CHECK IS ALSO A TICKET. Right after the transaction and the diagnosis lookup, before the pages-halted return so a
 * halted phone never halts a ticket, `tellTickets` (`red-watch-tickets.ts`) files each opened and each reminded check on
 * the house's bug line (`dispatcher bug file`, keyed `check:<node>/<key>`) and clears the ticket of each recovered one
 * (`bug cleared`). It runs in the background, is never awaited and never throws into the tick; a silent close files nothing.
 *
 * The event's code and priority follow the strongest group in the tick: any new red → `cerberus.red` (urgent),
 * only reminders → `cerberus.red.reminder`, only recoveries → `cerberus.recovered`. A mixed tick is one
 * `cerberus.red` whose body lists all three groups (`cerberus-red-copy.service.ts`).
 *
 * Started by the module's `soleDuties()`, never by a process that merely booted: a second API process would
 * page the same incident from its own memory. A convenience of a running server, never a reason for a process
 * to stay up (`unref`); a plan that throws is logged and tried again `RETRY_AFTER_THROW_MS` later, or at the next hint.
 *
 * Consumers: `cerberus.module.ts` (`startRedWatch` from `soleDuties`, `stopRedWatch` from `stop`).
 */

/** The first plan's wait after start (`startRedWatch`): the listeners attach and the wardens reconnect inside it. */
const FIRST_PLAN_AFTER_MS = 60_000;

/** After a plan threw, the next try, unless a hint comes first. */
const RETRY_AFTER_THROW_MS = 60_000;

/** The ntfy channel's name in `notification_channel_endpoints`. */
const NTFY_CHANNEL = 'ntfy';

/**
 * Pages are halted: on 2026-11-06 the operator asked for Cerberus notifications to stop reaching the phone. Every tick
 * still records its incidents, so the reminder and re-open clocks stay true; nothing is pushed. `false` pages again.
 */
const PAGES_HALTED = true;

/** The watch's one timer: armed for the first plan's minute, then at each plan's `nextAt`. Null while stopped. */
let deadline: DeadlineTimer | null = null;
let unsubscribe: (() => void) | null = null;
/** The plan asked for on this turn of the loop; every hint after it on the same turn rides it. */
let pendingPlan: NodeJS.Immediate | null = null;
/** False until the first plan's minute has passed: a hint before it waits for it. */
let settled = false;
/** What the last `next plan` line said, so the line is written when it changes, not at every plan. */
let lastSaidNextAt: number | null | undefined;

type RedWatchCode = 'cerberus.red' | 'cerberus.red.reminder' | 'cerberus.recovered';

/**
 * The orchestrator is JavaScript, so TypeScript reads its `dedupeKey = null` as a parameter that accepts only
 * `null`. This alias states the contract it actually implements for the red watch's events.
 */
const buildRedWatchEvent = createNotificationEvent as (input: {
  provider: 'cerberus';
  sessionId: null;
  kind: 'error';
  code: RedWatchCode;
  meta: CerberusRedMeta;
  severity: 'info' | 'warning' | 'error';
  requiresUserAction: boolean;
  // `string | null`, not `string`: the pair has to overlap `dedupeKey = null` for the cast to be allowed.
  dedupeKey: string | null;
}) => object;

/** The three groups a tick moved and the incidents it ended without a word. */
type AppliedTick = {
  opened: CerberusRedItem[];
  reminded: CerberusRedItem[];
  recovered: CerberusRedItem[];
  closedSilently: number;
};

/**
 * Writes a plan to the store in one transaction and answers what actually moved. An incident another process
 * already opened or closed is not counted: its push belongs to that process.
 */
function applyPlan(plan: RedWatchPlan, now: number): AppliedTick {
  const applied: AppliedTick = { opened: [], reminded: [], recovered: [], closedSilently: 0 };
  getCerberusConnection()
    .transaction(() => {
      for (const { item, redSince } of plan.opens) {
        if (cerberusRedAlertsDb.open(item.node, item.key, now, redSince)) applied.opened.push(item);
      }
      for (const { id, item } of plan.reminders) {
        cerberusRedAlertsDb.markReminded(id, now);
        applied.reminded.push(item);
      }
      for (const { id, item } of plan.recoveries) {
        if (cerberusRedAlertsDb.close(id, 'ok', now)) applied.recovered.push(item);
      }
      for (const { id, by } of plan.closes) {
        if (cerberusRedAlertsDb.close(id, by, now)) applied.closedSilently += 1;
      }
    })
    .immediate();
  return applied;
}

/** `item` with its trouble's finished diagnosis, or as it is when the trouble has none (or its lookup failed). */
function withDiagnosis(item: CerberusRedItem): CerberusRedItem {
  const diagnosis = pushDiagnosisOf(item.node, item.key);
  return diagnosis === undefined ? item : { ...item, diagnosis };
}

/** The event's code: the strongest group the tick moved. */
function codeOf(applied: AppliedTick): RedWatchCode {
  if (applied.opened.length > 0) return 'cerberus.red';
  return applied.reminded.length > 0 ? 'cerberus.red.reminder' : 'cerberus.recovered';
}

function pushToUsers(applied: AppliedTick, userIds: number[], now: number): void {
  const code = codeOf(applied);
  const meta: CerberusRedMeta = {
    count: applied.opened.length,
    items: applied.opened,
    reminders: applied.reminded,
    recovered: applied.recovered,
  };
  for (const userId of userIds) {
    notifyUserIfEnabled({
      userId,
      event: buildRedWatchEvent({
        provider: 'cerberus',
        sessionId: null,
        kind: 'error',
        code,
        meta,
        severity: code === 'cerberus.recovered' ? 'info' : code === 'cerberus.red' ? 'error' : 'warning',
        requiresUserAction: code === 'cerberus.red',
        // The orchestrator's 20-second dedupe is keyed on this alone, not on the user: it must differ per tick
        // (a quiet minute must not swallow the next page) and per recipient (the second user must not read as a repeat).
        dedupeKey: `cerberus:red-watch:${now}:${userId}`,
      }),
    });
  }
}

/**
 * One plan over `overview`: record what moved, push it, log the one line. Quiet when nothing moved. Answers the
 * plan's `nextAt`. Exported as the plan itself, so the same function the watch runs can be handed a fleet.
 */
export function tickRedWatch(overview: CerberusOverview): number | null {
  const now = overview.now;
  const plan = planRedWatch({
    overview,
    open: cerberusRedAlertsDb.listOpen(),
    lastClosed: (node, key) => cerberusRedAlertsDb.lastClosed(node, key),
    clockOffsetMs: (node) => wardenLinks.clockOffsetMs(node),
  });
  if (plan.opens.length + plan.reminders.length + plan.recoveries.length + plan.closes.length === 0) return plan.nextAt;

  const applied = applyPlan(plan, now);
  // After the incident is recorded, never before it: the lookup reads the store and adds a cause, it never decides a page
  // or a ticket. Done here, before the halt, because a halted phone never halts a ticket.
  applied.opened = applied.opened.map(withDiagnosis);
  applied.reminded = applied.reminded.map(withDiagnosis);
  tellTickets(applied);
  const moved = applied.opened.length + applied.reminded.length + applied.recovered.length;
  const counts = `opened ${applied.opened.length}, reminded ${applied.reminded.length}, recovered ${applied.recovered.length}`;
  const closed = applied.closedSilently > 0 ? `, closed ${applied.closedSilently} silently` : '';
  if (moved === 0) {
    if (applied.closedSilently > 0) console.log(`[red-watch] ${counts}${closed} → nothing to push`);
    return plan.nextAt;
  }

  if (PAGES_HALTED) {
    console.log(`[red-watch] ${counts}${closed} → pages halted, nobody paged`);
    return plan.nextAt;
  }
  const userIds = notificationChannelEndpointsDb.getUserIdsWithEnabledEndpoint(NTFY_CHANNEL);
  if (userIds.length === 0) {
    console.log(`[red-watch] ${counts}${closed} → no enabled ntfy endpoint, nobody paged`);
    return plan.nextAt;
  }
  pushToUsers(applied, userIds, now);
  console.log(`[red-watch] ${counts}${closed} → pushed to ${userIds.length} user${userIds.length === 1 ? '' : 's'}`);
  return plan.nextAt;
}

/** One plan over the overview as it stands now, then the deadline armed at its `nextAt`. */
function runPlan(overview: () => CerberusOverview): void {
  pendingPlan = null;
  let nextAt: number | null;
  try {
    nextAt = tickRedWatch(overview());
  } catch (error) {
    console.error(`[red-watch] a plan did nothing: ${error instanceof Error ? error.message : String(error)}`);
    nextAt = Date.now() + RETRY_AFTER_THROW_MS;
  }
  deadline?.arm(nextAt);
  if (nextAt === lastSaidNextAt) return;
  lastSaidNextAt = nextAt;
  console.log(nextAt === null ? '[red-watch] nothing to wait for' : `[red-watch] next plan at ${new Date(nextAt).toISOString()}`);
}

/**
 * Starts the watch: it plans on every hint Cerberus sends, at most one plan per turn of the loop, and at each plan's
 * `nextAt`; its first plan runs a minute from now. `overview` is read at each plan. A second call while running does
 * nothing.
 *
 * NO TICK AT THE MOMENT OF ARMING, unlike the self-checks: a hint before the first minute waits for it. The duties arm
 * before the server has finished starting: the notification history and the companion's alert feed attach to the
 * orchestrator in the `listen` callback, after `cerberus.start()`, and an event raised before they attach is heard by
 * neither (measured on the first page: pushed, and absent from the history). A boot also reads the fleet from the store
 * before the wardens have reconnected; a minute later it has heard them. A process that lives under a minute pages
 * nothing, which costs nothing: the incidents are in the table, and the next process to live a minute reads them there.
 */
export function startRedWatch(overview: () => CerberusOverview): void {
  if (deadline) return;
  const requestPlan = (): void => {
    if (!settled || pendingPlan) return;
    // Not unref'd: an unref'd immediate waits for the loop's next wake instead of its next turn. It lives one turn.
    pendingPlan = setImmediate(() => runPlan(overview));
  };
  // The first firing is the settle minute's end; every later one is a plan's `nextAt`.
  deadline = createDeadlineTimer(() => {
    settled = true;
    requestPlan();
  });
  deadline.arm(Date.now() + FIRST_PLAN_AFTER_MS);
  unsubscribe = onHintSent(requestPlan);
}

/** Stops the watch: no more hints heard, its timer and its pending plan gone. The incidents are in the store. */
export function stopRedWatch(): void {
  unsubscribe?.();
  unsubscribe = null;
  deadline?.clear();
  deadline = null;
  if (pendingPlan) clearImmediate(pendingPlan);
  pendingPlan = null;
  settled = false;
  lastSaidNextAt = undefined;
}
