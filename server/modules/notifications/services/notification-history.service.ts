import { notificationHistoryDb, type NotificationHistoryRow } from '@/modules/database/index.js';
import type { NotificationEvent } from '@/shared/types.js';

import { onNotification } from './notification-listeners.service.js';
import { spendFreeWording } from './notification-spend-free.service.js';

/**
 * WHAT THE HOUSE TOLD HIM, KEPT. Alerts had no history anywhere: the orchestrator pushes and forgets, the Inbox holds what
 * waits and not what was said, and Kaylee's own alert rows exist only while Live is on and a page is open. This service is
 * the memory: it subscribes to the orchestrator's listener seam (`onNotification`), which hears EVERY event the orchestrator
 * is handed, normalized, BEFORE any push preference or dedupe, and writes one row for each. So the history rides the
 * orchestrator's own call — nothing polls — and it holds what a push gate would have dropped: a kind that is OFF for pushes
 * (a background task landing), an event the push dedupe swallowed, the usage family. It is the house's record; what a reader
 * shows of it is the reader's choice (`list_alerts` never lists the usage family).
 *
 * THE WORDING KEPT HAS EVERY FIGURE TAKEN OUT (`spendFreeWording`): a finished feature's cost, a budget stop's figure, an
 * `api.error`'s usage reason and the usage or spend words in a failure's or a pause's own text are never stored, so no reader
 * of this table can put a cost in front of her (ruling 1).
 *
 * AN ASK TOLD AGAIN IS ONE ROW. Every server boot re-raises the asks still open (each boot is a new push, and the dev server
 * restarts on every save), so the same Accept or permission reaches the seam dozens of times. An event of kind `action_required`
 * that repeats one the account already holds — same code, chat, plan, title and body — replaces it: the row moves to the front
 * with the time it was told last, and the week's rows are not spent on repeats. Every other kind is kept as it happens: a chat that
 * finishes twice finished twice.
 *
 * WHAT IS KEPT, AND FOR HOW LONG. Every row of the last seven days, whole, and past that age the newest 300 (`notificationHistoryDb.record`
 * prunes a row only when it is both older than the week and past the newest 300). 300 rows were once the whole bound and held about three
 * days and a half of one account, mostly `run.stopped` and `permission.required`, while the station's strip promises a week of landings.
 *
 * A KIND KEPT AND NEVER PUSHED. An event of kind `record` (the dispatcher's `dispatcher.feature_finished`, a feature of an epic finishing)
 * reaches this seam like any other and is kept like any other; the orchestrator returns before every push gate, so it is told to no
 * channel. The history is where it lives, and the station's strip is what reads it.
 *
 * A write that fails is one journal line and never costs the push, which is why the write is deferred one turn of the event
 * loop (`setImmediate`): the seam runs listeners to completion BEFORE the orchestrator builds and sends the push, and a write
 * that waits on another connection's lock (SQLite's busy wait is 5 s) would hold the push back that long. The listener seam
 * guards each listener, and the deferred write also catches its own fault so the line says which event it was and nothing else is lost.
 *
 * THE HISTORY HAS A SEAM OF ITS OWN (`onHistoryKept`): after a row is stored, inside the same deferred write, every listener
 * hears it, with the row as stored (its id included). So a reader that wants the rows AS THEY ARE KEPT (the station's strip of
 * what landed) rides this write and does not poll the table or hear the orchestrator a second time, where it would be free to
 * disagree with what the history holds (a repeat ask replaced, the wording with its figures taken out). Each listener runs in
 * its own guard, so a listener's fault costs only itself.
 *
 * Consumers: `server/index.ts` (starts it after `listen`, calls its unsubscribe on shutdown) and the companion module's
 * alert reads and station landed read and feed (`listNotificationHistory`, `listNotificationHistorySince`, `onHistoryKept`).
 */

/** What hears a kept row: the account it belongs to and the row exactly as stored. */
type HistoryKeptListener = (userId: number, row: NotificationHistoryRow) => void;

const keptListeners = new Set<HistoryKeptListener>();

/**
 * Hears every row the history keeps, after it is stored, with its id. Answers the unsubscribe, which is idempotent. A listener
 * is called synchronously inside the deferred write and should return quickly; its throw or rejected promise is logged and
 * costs the other listeners nothing. Consumed by the companion module's station feed.
 */
export function onHistoryKept(listener: HistoryKeptListener): () => void {
  keptListeners.add(listener);
  return () => {
    keptListeners.delete(listener);
  };
}

/** The ONE guard around a kept-row listener: a fault is logged with which row it was and costs no one else anything. */
function reportKeptListenerFault(row: NotificationHistoryRow, error: unknown): void {
  console.error(`[Notifications] a history listener failed on ${row.code} (row ${row.id}, account ${row.user_id})`, error);
}

/**
 * Hands one stored row to every listener, each in its own guard (an `async` listener's rejection is as much its own fault as a throw)
 * and each with a row of its own: a listener that writes to the row it was handed changes only its own copy, never what the next hears.
 */
function announceKept(row: NotificationHistoryRow): void {
  // A copy of the set, so a listener that unsubscribes while it runs changes the NEXT announcement, not this one.
  for (const listener of [...keptListeners]) {
    try {
      const outcome: unknown = listener(row.user_id, { ...row });
      if (outcome instanceof Promise) outcome.catch((error: unknown) => reportKeptListenerFault(row, error));
    } catch (error) {
      reportKeptListenerFault(row, error);
    }
  }
}

/** The account an event belongs to as the whole number the history keys on; `null` for an id that is not one (the table's key is a number). */
function accountIdOf(userId: string | number): number | null {
  const id = typeof userId === 'number' ? userId : Number(userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The plan an event names: its `meta.plan` when that is a string (the dispatcher's asks carry one), else, for one of the
 * dispatcher's own codes, its `meta.sessionName` — an ending, a pause or a relaunch names the card it is about there (the
 * plan's name, or the epic's for an epic ending) and carries no `plan` and no chat. Else `null`.
 */
function planOf(event: NotificationEvent): string | null {
  const { plan, sessionName } = event.meta;
  if (typeof plan === 'string' && plan !== '') return plan;
  if (event.code.startsWith('dispatcher.') && typeof sessionName === 'string' && sessionName !== '') return sessionName;
  return null;
}

/**
 * Starts the history: one row per event the orchestrator is handed, written as it is heard. Answers the unsubscribe, which is
 * idempotent. Consumed by `server/index.ts`, once, after the server is listening.
 */
export function startNotificationHistory(): () => void {
  return onNotification((userId, event) => {
    const accountId = accountIdOf(userId);
    if (accountId === null) return;
    // The moment it was heard, taken now: the write below runs a turn later and the stamp is when the house told him.
    const at = new Date().toISOString();
    setImmediate(() => {
      try {
        const { title, body } = spendFreeWording(event);
        const kept = { at, code: event.code, kind: event.kind, severity: event.severity, title, body, session_id: event.sessionId, plan: planOf(event) };
        const id = notificationHistoryDb.record(accountId, kept, { replaceRepeat: event.kind === 'action_required' });
        announceKept({ id, user_id: accountId, ...kept });
      } catch (error) {
        console.error(`[Notifications] the history could not keep ${event.code} for account ${accountId} (session ${event.sessionId ?? 'none'})`, error);
      }
    });
  });
}

/**
 * The account's newest `limit` kept events, newest first, as stored (a `limit` past 300 is 300: the newest 300 are the most any read of
 * "the latest" wants, and the repository holds the read to them). Consumed by the companion module's `list_alerts`, which filters out
 * the usage family and words the rest.
 */
export function listNotificationHistory(userId: number, limit: number): NotificationHistoryRow[] {
  return notificationHistoryDb.list(userId, limit);
}

/**
 * EVERY kept event of the account at or after `sinceIso` (an ISO-8601 UTC stamp), newest first, as stored. The history keeps every row
 * of the last `NOTIFICATION_HISTORY_WINDOW_MS`, so a `sinceIso` inside that window is answered whole, however busy the house was.
 * Consumed by the companion module's station landed read (`stationLanded`), which draws the week's landings from it.
 */
export function listNotificationHistorySince(userId: number, sinceIso: string): NotificationHistoryRow[] {
  return notificationHistoryDb.listSince(userId, sinceIso);
}
