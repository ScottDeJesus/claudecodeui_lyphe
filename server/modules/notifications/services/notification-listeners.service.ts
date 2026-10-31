import type { NotificationEvent } from '@/shared/types.js';

/**
 * Who else hears a notification besides the push channels. The orchestrator announces every event it is
 * handed HERE, right after the session is normalized and BEFORE the push preference and the push dedupe,
 * for two reasons that are the whole point of a listener seam rather than a fourth channel:
 *   - a listener's business is not a push's. A kind that is OFF for pushes by default (`background`, an inline
 *     fix landing) would never reach a listener placed behind that gate;
 *   - a listener must not share the push dedupe, or it could consume a push's slot, or the push its own.
 * So a listener hears each event once per call, repeats included, and does its own deduping.
 *
 * Each listener runs on its own inside a guard: one that throws (or whose promise rejects) is logged and the next
 * still hears the event — and the push that follows is never lost to a listener's fault. A listener is called
 * synchronously and should return quickly; anything slow is its to start and not wait on. Nothing here polls: a
 * listener is called by the orchestrator's own call, and by nothing else.
 */

/** What a listener is: handed the account the event belongs to and the event, read-only. Consumed by `onNotification`'s callers. */
export type NotificationListener = (userId: string | number, event: NotificationEvent) => void;

const listeners = new Set<NotificationListener>();

/**
 * Hears every event the orchestrator is handed, normalized, before any push preference or dedupe. Returns the
 * unsubscribe, which is idempotent. Consumed by the companion module's alert feed and station hint, and by this module's
 * notification history (`notification-history.service.ts`, which keeps a row for every event it hears).
 */
export function onNotification(listener: NotificationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The ONE guard around a listener's call: a throw or a rejection is logged with what the event was and costs no one else anything. */
function reportListenerFault(event: NotificationEvent, error: unknown): void {
  console.error(`[Notifications] a listener failed on ${event.code} (session ${event.sessionId ?? 'none'})`, error);
}

/**
 * Hands `event` to every listener, each caught on its own. Consumed by the notification orchestrator's
 * `notifyUserIfEnabled`, which calls it once per event, before its own gates.
 */
export function announceToListeners(userId: string | number, event: NotificationEvent): void {
  // A copy, so a listener that unsubscribes (or subscribes another) while it runs changes the NEXT announcement, not this one.
  for (const listener of [...listeners]) {
    try {
      const outcome: unknown = listener(userId, event);
      // A listener written `async` returns a promise the type does not show; its rejection is as much its own fault as a throw.
      if (outcome instanceof Promise) outcome.catch((error: unknown) => reportListenerFault(event, error));
    } catch (error) {
      reportListenerFault(event, error);
    }
  }
}
