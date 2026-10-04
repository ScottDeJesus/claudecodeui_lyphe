import type { DispatcherAsk } from '@/shared/types.js';

/**
 * How an ask is NAMED — the one thing every process serving this lane must agree on, because an
 * answer names an ask and the process that hears it is not always the one that raised it. The dev
 * server hands over on nearly every save and sometimes restarts outright, and a tap made while the
 * socket was down waits on the push it arrived in and lands on the successor's book (measured
 * 2026-09-28 18:59:54: a Queue carrying the id its predecessor minted, dropped as an unknown request).
 *
 * THE NAME IS DERIVED FROM THE STORE'S OWN RECORD OF THE ASK and from nothing a process holds: the
 * `asked` event — its id and its stamp — and for an Accept the lock token, the census he was shown. The
 * same ask is therefore the same name in every process, before and after a handover, and a name
 * that no open ask derives is an ask that is no longer current (re-cut: a new `asked` event; answered
 * or closed: no ask at all). It is the ask's identity wherever one is needed — the phone's push and its
 * buttons, the card's door, the lane's bell and this lane's own book all key on it.
 *
 * THE STAMP IS IN THE NAME BECAUSE THE ID ALONE IS NOT AN ASK'S IDENTITY OVER TIME. `events.id` is an
 * `INTEGER PRIMARY KEY` without `AUTOINCREMENT` (`hooks/dispatcher/store.py`), so once `dispatcher
 * drop` frees the tail a re-loaded plan is born under the very same ids: the same plan file asked
 * again reads the same token and the same id, and its prompt would be taken for the first life's —
 * no buzz on the phone (the push memory keys on the name), no bell in the tab, whose ask that name
 * already is. Second-grained, like every stamp of the store.
 *
 * NEVER THE PLAN'S NAME, for an Accept: an arc's lock is carried on every plan it names, each printing
 * its own name as `ask.plan`, so which plan a process reads the ask from depends on the order it reads
 * them in. The token and the event id are the ask, and read the same wherever it is read.
 */

/** Every key of the lane starts here; a provider runtime's approvals never do. */
const LANE_PREFIX = 'dispatcher:';

/** A key of this lane's own asks: a lock's or a questions round's, and nothing else's. */
const ASK_KEY = /^dispatcher:(?:lock|questions):/;

/** The `asked` event as a key carries it: `<id>-<stamp in whole epoch seconds>`, which an unreadable stamp reads as 0. */
function askedSegment(ask: DispatcherAsk): string {
  return `${ask.asked.id}-${Math.floor(Date.parse(ask.asked.at) / 1000) || 0}`;
}

/**
 * The ask's own name — this file's head says why it is what it asks, and why it outlives a restart.
 * Used by `dispatcher-asks.service.ts`, which keys its book, the push, the phone's buttons and the
 * card's door on it.
 */
export function keyOf(ask: DispatcherAsk): string {
  return ask.kind === 'accept'
    ? `${LANE_PREFIX}lock:${ask.token}:${askedSegment(ask)}`
    : `${LANE_PREFIX}questions:${ask.plan}:${askedSegment(ask)}`;
}

/**
 * Whether a key names one of THIS lane's asks — the test that says "this is mine to answer" for a key
 * no book here holds. A runtime's approvals never match, so the Claude gateways still hear their own
 * keys first-come. Used by `dispatcher-asks.service.ts`, whose gateway claims a matching key and
 * settles it from the store.
 */
export function isAskKey(key: string): boolean {
  return ASK_KEY.test(key);
}
