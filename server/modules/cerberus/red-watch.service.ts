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

import { planRedWatch, type RedWatchPlan } from './red-watch-plan.js';
import { wardenLinks } from './warden-links.js';

/**
 * The red watch: a check that stays failing or denied for an hour wakes the operator's phone.
 *
 * Every 60 seconds the tick reads the overview (the same one the tab reads, so the watch and the screen cannot
 * disagree about what is red), asks `planRedWatch` what moved, records it in `cerberus_red_alerts`, and hands
 * ONE event per recipient to the notification orchestrator — never one per check, so nine checks that cross
 * the hour together are one push, not nine. The orchestrator gates it by the user's `events.error` preference
 * and the ntfy channel publishes it (priority and tags by code, `ntfy-channel.service.ts`); this file never
 * talks to ntfy.
 *
 * WHO IS PAGED: every user with an enabled ntfy endpoint. With none, the tick still records its incidents —
 * the table is the truth about what is red and since when — and says so in one log line instead of a push.
 *
 * THE TABLE KEEPS A RESTART FROM PAGING AGAIN. This repo restarts the API on every save under `server/`, and
 * a fresh process knows nothing; what it reads from `cerberus_red_alerts` is which incidents were already
 * pushed and when. The incident is recorded BEFORE its push is handed over, in one transaction: a process that
 * dies between the two costs one missed page, where the other order would cost a double page on every restart.
 *
 * The event's code and priority follow the strongest group in the tick: any new red → `cerberus.red` (urgent),
 * only reminders → `cerberus.red.reminder`, only recoveries → `cerberus.recovered`. A mixed tick is one
 * `cerberus.red` whose body lists all three groups (`cerberus-red-copy.service.ts`).
 *
 * Started by the module's `soleDuties()`, never by a process that merely booted: a second API process would
 * page the same incident from its own memory. A convenience of a running server, never a reason for a process
 * to stay up (`unref`), and a tick that throws loses that tick only.
 *
 * Consumers: `cerberus.module.ts` (`startRedWatch` from `soleDuties`, `stopRedWatch` from `stop`).
 */

/** One tick a minute; an hour's threshold does not need a finer clock, and a quiet tick costs one overview read. */
const TICK_INTERVAL_MS = 60_000;

/** The ntfy channel's name in `notification_channel_endpoints`. */
const NTFY_CHANNEL = 'ntfy';

let tickTimer: NodeJS.Timeout | null = null;

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
 * One tick over `overview`: record what moved, push it, log the one line. Quiet when nothing moved.
 * Exported as the tick itself, so the same function the timer runs can be handed a fleet.
 */
export function tickRedWatch(overview: CerberusOverview): void {
  const now = overview.now;
  const plan = planRedWatch({
    overview,
    open: cerberusRedAlertsDb.listOpen(),
    lastClosed: (node, key) => cerberusRedAlertsDb.lastClosed(node, key),
    clockOffsetMs: (node) => wardenLinks.clockOffsetMs(node),
  });
  if (plan.opens.length + plan.reminders.length + plan.recoveries.length + plan.closes.length === 0) return;

  const applied = applyPlan(plan, now);
  const moved = applied.opened.length + applied.reminded.length + applied.recovered.length;
  const counts = `opened ${applied.opened.length}, reminded ${applied.reminded.length}, recovered ${applied.recovered.length}`;
  const closed = applied.closedSilently > 0 ? `, closed ${applied.closedSilently} silently` : '';
  if (moved === 0) {
    if (applied.closedSilently > 0) console.log(`[red-watch] ${counts}${closed} → nothing to push`);
    return;
  }

  const userIds = notificationChannelEndpointsDb.getUserIdsWithEnabledEndpoint(NTFY_CHANNEL);
  if (userIds.length === 0) {
    console.log(`[red-watch] ${counts}${closed} → no enabled ntfy endpoint, nobody paged`);
    return;
  }
  pushToUsers(applied, userIds, now);
  console.log(`[red-watch] ${counts}${closed} → pushed to ${userIds.length} user${userIds.length === 1 ? '' : 's'}`);
}

function tick(overview: () => CerberusOverview): void {
  try {
    tickRedWatch(overview());
  } catch (error) {
    console.error(`[red-watch] a tick did nothing: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Starts the watch: the first tick one interval from now, then one a minute. `overview` is read at each tick. A
 * second call while running does nothing.
 *
 * NO TICK AT THE MOMENT OF ARMING, unlike the self-checks. The duties arm before the server has finished
 * starting: the notification history and the companion's alert feed attach to the orchestrator in the `listen`
 * callback, after `cerberus.start()`, and an event raised before they attach is heard by neither (measured on
 * the first page: pushed, and absent from the history). A boot also reads the fleet from the store before the
 * wardens have reconnected; a minute later it has heard them. A process that lives under a minute pages nothing,
 * which costs nothing: the incidents are in the table, and the next process to live a minute reads them there.
 */
export function startRedWatch(overview: () => CerberusOverview): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => tick(overview), TICK_INTERVAL_MS);
  // A convenience of a running server, never a reason for a process to stay up.
  tickTimer.unref();
}

/** Stops the ticks. The incidents are in the store and the next process reads them there. */
export function stopRedWatch(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
