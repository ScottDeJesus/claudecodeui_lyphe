/**
 * The page's memory of why its session ended — kept in localStorage because a sign-out is exactly
 * the moment nothing else survives: the server never sees a sign-out that no request carried, and
 * the auth context that could report it has just been emptied.
 *
 * The next authenticated load hands these records to the server's journal, so a sign-out that came
 * "out of nowhere" has a line with its trigger, its request and the shape of the token involved.
 * Best effort by design: a full or blocked localStorage loses a trace, never a session.
 */
import type { AuthTraceEvent } from '@/shared/types';

const AUTH_TRACE_KEY = 'auth-trace';
const MAX_KEPT_EVENTS = 10;

/** Records read by AuthContext (to report) and written by authToken.ts (on every auth decision). */
export const peekAuthEvents = (): AuthTraceEvent[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(AUTH_TRACE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as AuthTraceEvent[]) : [];
  } catch {
    return [];
  }
};

// Two records are the same decision when everything but the moment matches.
const sameDecision = (a: AuthTraceEvent, b: AuthTraceEvent): boolean => (
  a.trigger === b.trigger && a.outcome === b.outcome && a.url === b.url && a.method === b.method
  && a.status === b.status && a.authError === b.authError && a.sent === b.sent && a.stored === b.stored
);

/**
 * Used by authToken.ts to append one decision; the oldest fall away past the cap.
 *
 * A repeat of the last decision only raises its `count`. A wiped session is followed by a burst of
 * refusals from every request the page still makes, and a ring that kept each one would push the
 * one record that matters — the decision that caused the wipe — out before anyone read it.
 */
export const recordAuthEvent = (event: AuthTraceEvent): void => {
  try {
    const events = peekAuthEvents();
    const last = events[events.length - 1];
    if (last && sameDecision(last, event)) {
      last.count = (last.count ?? 1) + 1;
    } else {
      events.push(event);
    }
    // Past the cap the oldest record that only says a page was spared or followed goes first: a
    // refused replay can arrive in numbers (one per revalidated URL), and none of them may push out
    // the sign-out they are the explanation for.
    while (events.length > MAX_KEPT_EVENTS) {
      const spared = events.findIndex((kept) => kept.outcome !== 'signed-out');
      events.splice(spared === -1 ? 0 : spared, 1);
    }
    localStorage.setItem(AUTH_TRACE_KEY, JSON.stringify(events));
  } catch {
    // Tracing must never be the reason a session breaks.
  }
};

/** Used by AuthContext after the server took a report: drops exactly the records it sent, keeping any written since. */
export const dropAuthEvents = (count: number): void => {
  try {
    const remaining = peekAuthEvents().slice(count);
    if (remaining.length === 0) {
      localStorage.removeItem(AUTH_TRACE_KEY);
    } else {
      localStorage.setItem(AUTH_TRACE_KEY, JSON.stringify(remaining));
    }
  } catch {
    // Same rule as recordAuthEvent.
  }
};
