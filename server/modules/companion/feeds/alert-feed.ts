import { onNotification } from '@/modules/notifications/index.js';
import { isUserConnected } from '@/modules/websocket/index.js';
import type { NotificationEvent } from '@/shared/types.js';

import { readCompanionSettings } from '../companion-settings.js';
import type { CompanionService } from '../companion.service.js';
import type { CompanionAlertKind } from '../session/companion-envelopes.js';

import { buildAlertBlock, type CompanionAlert } from './alert-block.js';

/**
 * What she hears unasked. While Live is on she speaks from the house's notifications (ruling 13), through the
 * orchestrator's listener seam (`onNotification`), which hears an event BEFORE the push preference and dedupe:
 * an inline fix landing is a `run.background_completed`, a kind that is OFF for pushes by default, and behind
 * that gate she would never hear it. Each event the seam hands over is dropped unless ALL of these hold:
 *   1. its code is an alert code (`ALERT_KIND_BY_CODE`, the one map);
 *   2. his Live is on;
 *   3. a page of his is connected — with no page, speaking would spend her turns on an empty room;
 *   4. it is not a repeat, by this feed's own twenty-second dedupe keyed `<user>:<event key>`, never the push's.
 * The checks run cheapest first and the dedupe LAST, so an event dropped for another reason does not use up its slot.
 *
 * The survivors of one account gather for three seconds into one message (`pushAlerts` takes them together, so
 * several alerts landing at once are one turn of hers, "three things landed", not three). The window opens
 * with the first survivor and is a one-shot timer, not a poll; Live is read again when it closes, so a switch turned
 * off in the meantime is honored. Each alert is built as the window closes, one at a time inside its own guard.
 * Her process is started when the window OPENS (`service.warm`): measured on the live CLI, a message that wakes her
 * reaches her about a second later than one that finds her up, and the alert is owed to her within four seconds of the event.
 *
 * A window builds at most 20 alerts; the rest are one sentence saying how many, so a flood cannot stall the server.
 * The same listener tells the focus feed (`service.runFailed`) when a chat's run fails, whatever the gates decide, so
 * that run's `complete` is not told as "finished" a moment after the `failed` alert.
 * Nothing here polls, and unsubscribing (`stop()`) closes every open window unsent.
 *
 * Consumer: `companion.module.ts`, which starts it and unsubscribes it on `stop()`.
 */

/**
 * Notification code → the kind an `<alert>` carries. THE MAP, and the whole of the list: a code that is not here
 * is not an alert. Never `limit.*` (usage), `push.enabled`, `run.stopped`, nor the dispatcher's pause and relaunch
 * codes — ruling 17, never a word about usage or spend, and a stop is a stop, not news.
 * Consumed by this feed's own listener and by `eyes/alert-reads.ts`, whose `list_alerts` says a kept event's kind in the
 * same six words where its code has one here.
 */
export const ALERT_KIND_BY_CODE: ReadonlyMap<string, CompanionAlertKind> = new Map<string, CompanionAlertKind>([
  ['dispatcher.finished', 'feature finished'],
  ['dispatcher.epic_finished', 'feature finished'],
  ['run.background_completed', 'background work landed'],
  ['agent.notification', 'asking'],
  ['permission.required', 'permission'],
  ['run.failed', 'failed'],
  ['run.limit', 'failed'],
  ['api.error', 'failed'],
  ['login.expired', 'failed'],
  ['session.stuck', 'stuck'],
]);

/** How long the same event is a repeat for her: the push dedupe's own window, kept separately so neither can consume the other's slot. */
const DEDUPE_WINDOW_MS = 20_000;

/** How long survivors gather before they are pushed as one message. */
const GATHER_WINDOW_MS = 3_000;

/**
 * The most alerts one window builds and pushes: each costs about 12 ms of synchronous work (the chat's name, its
 * follow-ups, the panel's row) and the whole batch is one message of hers. A real burst is a handful; past this the
 * rest are named by a count, so a flood can neither stall the server for seconds nor hand her a 100 KB message.
 */
const ALERTS_PER_WINDOW_MAX = 20;

/** The survivors of one account waiting for their window to close, and the timer that closes it. */
type Gathering = { heard: Array<{ event: NotificationEvent; kind: CompanionAlertKind }>; timer: NodeJS.Timeout };

/** The account an event belongs to as the whole number the companion keys on; `null` for an id that is not one. */
function accountIdOf(userId: string | number): number | null {
  const id = typeof userId === 'number' ? userId : Number(userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The event's identity for the dedupe: the key its raiser gave it, else provider, kind, code and chat, as the push dedupe composes it. */
function eventKeyOf(event: NotificationEvent): string {
  return event.dedupeKey || `${event.provider}:${event.kind || 'info'}:${event.code || 'generic'}:${event.sessionId || 'none'}`;
}

/**
 * Starts listening; answers the unsubscribe. Consumed by `companion.module.ts`. `service.alert` is where
 * the gathered alerts are logged on her panel and pushed to her.
 */
export function startAlertFeed(service: CompanionService): () => void {
  // Event key → when it was heard. Pruned as it is read, so it holds only the last twenty seconds: no timer sweeps it.
  const heardAt = new Map<string, number>();
  const gathering = new Map<number, Gathering>();

  function isRepeat(accountId: number, event: NotificationEvent): boolean {
    const now = Date.now();
    for (const [key, at] of heardAt) {
      if (now - at > DEDUPE_WINDOW_MS) heardAt.delete(key);
    }
    const key = `${accountId}:${eventKeyOf(event)}`;
    if (heardAt.has(key)) return true;
    heardAt.set(key, now);
    return false;
  }

  function closeWindow(accountId: number): void {
    const gathered = gathering.get(accountId);
    gathering.delete(accountId);
    if (gathered === undefined) return;
    try {
      // He may have switched Live off while the window was open.
      if (!readCompanionSettings(accountId).live) return;
      const alerts: CompanionAlert[] = [];
      for (const { event, kind } of gathered.heard.slice(0, ALERTS_PER_WINDOW_MAX)) {
        try {
          alerts.push(buildAlertBlock(accountId, event, kind));
        } catch (error) {
          console.error(`[Companion] account ${accountId}: the alert for ${event.code} (session ${event.sessionId ?? 'none'}) could not be built`, error);
        }
      }
      const unbuilt = gathered.heard.length - ALERTS_PER_WINDOW_MAX;
      if (unbuilt > 0) {
        const sentence = `${unbuilt} more alerts came in during the same three seconds and are not listed here; list_sessions shows where each chat stands.`;
        alerts.push({ envelope: sentence, line: sentence });
      }
      service.alert(accountId, alerts);
    } catch (error) {
      console.error(`[Companion] account ${accountId}: ${gathered.heard.length} gathered alert(s) did not reach her`, error);
    }
  }

  const unsubscribe = onNotification((userId, event) => {
    const kind = ALERT_KIND_BY_CODE.get(event.code);
    // A failure is marked for the focus feed whatever the gates below decide: the run that failed is about to
    // `complete`, and a run she was never told failed is still not a finished one (`service.runFailed`).
    if (kind === 'failed' && event.sessionId) service.runFailed(event.sessionId);
    const accountId = accountIdOf(userId);
    if (kind === undefined || accountId === null) return;
    try {
      if (!readCompanionSettings(accountId).live) return;
      if (!isUserConnected(accountId)) return;
      if (isRepeat(accountId, event)) return;
    } catch (error) {
      console.error(`[Companion] account ${accountId}: could not judge whether ${event.code} is hers to say`, error);
      return;
    }

    const open = gathering.get(accountId);
    if (open !== undefined) {
      open.heard.push({ event, kind });
      return;
    }
    // Unref'd: a pending window never keeps a stopping server alive.
    const timer = setTimeout(() => closeWindow(accountId), GATHER_WINDOW_MS);
    timer.unref();
    gathering.set(accountId, { heard: [{ event, kind }], timer });
    // Her process starts while the window is open, so a message that wakes her does not also wait for the CLI to come up.
    try {
      service.warm(accountId);
    } catch (error) {
      console.error(`[Companion] account ${accountId}: her process could not be started ahead of the alert`, error);
    }
  });

  return () => {
    unsubscribe();
    for (const { timer } of gathering.values()) clearTimeout(timer);
    gathering.clear();
  };
}
