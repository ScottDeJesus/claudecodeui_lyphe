import type { DispatcherAsk, DispatcherPlan } from '@/shared/types.js';

/**
 * How an ask is NAMED — the one thing every process serving this lane must agree on, because an
 * answer names an ask and the process that hears it is not always the one that raised it. The dev
 * server hands over on nearly every save and sometimes restarts outright, and a click made while the
 * socket was down waits in the tab's outbox and lands on the successor's first frame (measured
 * 2026-09-28 18:59:54: a Queue carrying the id its predecessor minted, dropped as an unknown request).
 *
 * BOTH NAMES ARE DERIVED FROM THE STORE'S OWN RECORD OF THE ASK and from nothing a process holds: the
 * id of the `asked` event, and for an Accept the lock token — the census he was shown. The same ask is
 * therefore the same two names in every process, before and after a handover, and a name that no
 * open ask derives is an ask that is no longer current (re-cut: a new `asked` event; answered or
 * closed: no ask at all).
 *
 * - The PROMPT KEY (`keyOf`) is the ask's identity: the phone's push and its buttons, the tab's bell
 *   and this lane's own book all key on it.
 * - The REQUEST ID (`requestIdOf`) is the same identity under the panel's prefix, so the key alone says
 *   which door pressed (`approved_by` reads `app:panel` or `app:phone`).
 *
 * NEVER THE PLAN'S NAME, for an Accept: an arc's lock is carried on every plan it names, each printing
 * its own name as `ask.plan`, so which plan a process reads the ask from depends on the order it reads
 * them in. The token and the event id are the ask, and read the same wherever it is read.
 */

/** Every key of the lane starts here; a provider runtime's approvals never do. */
const LANE_PREFIX = 'dispatcher:';

/** The panel's prefix — what turns a prompt key into a request id. */
const REQUEST_PREFIX = 'dispatcher:ask:';

/** A key of either name: a lock's or a questions round's, under the lane's prefix or the panel's. */
const ASK_KEY = /^dispatcher:(?:ask:)?(?:lock|questions):/;

/**
 * The ask's own name — this file's head says why it is what it asks, and why it outlives a restart.
 * Used by `dispatcher-asks.service.ts`, which keys its book, the push and the phone's buttons on it.
 */
export function keyOf(ask: DispatcherAsk): string {
  return ask.kind === 'accept'
    ? `${LANE_PREFIX}lock:${ask.token}:${ask.asked.id}`
    : `${LANE_PREFIX}questions:${ask.plan}:${ask.asked.id}`;
}

/** The same ask under the panel's name. Used by `dispatcher-asks.service.ts` for the frame's `requestId`. */
export function requestIdOf(ask: DispatcherAsk): string {
  return `${REQUEST_PREFIX}${keyOf(ask).slice(LANE_PREFIX.length)}`;
}

/**
 * Whether a key names one of THIS lane's asks, by either of its names — the test that says "this is
 * mine to answer" for a key no book here holds. A runtime's approvals never match, so the Claude
 * gateways still hear their own keys first-come.
 */
export function isAskKey(key: string): boolean {
  return ASK_KEY.test(key);
}

/** Which door a key came through: the panel's request id, or the phone's prompt key. */
export function doorOfKey(key: string): 'panel' | 'phone' {
  return key.startsWith(REQUEST_PREFIX) ? 'panel' : 'phone';
}

/**
 * The plan an answer's key was for, read off the store's log — the key ends in the id of the `asked`
 * event that raised it, and event ids come from one global sequence, so exactly one plan's log holds
 * it. `undefined` for a plan the store no longer holds. Used by `dispatcher-asks.service.ts` to tell
 * the right chat that an answer it sent named an ask no longer open.
 */
export function askedPlanOf(plans: readonly DispatcherPlan[], key: string): DispatcherPlan | undefined {
  const askedId = Number(key.slice(key.lastIndexOf(':') + 1));
  return plans.find((plan) => plan.events.some((event) => event.kind === 'asked' && event.id === askedId));
}
