import { cerberusCatalogDb } from '@/modules/database/index.js';
import type { CerberusCatalogSet } from '@/shared/cerberus-types.js';

/**
 * Whether a node's warden has acked a catalog that holds a fix, and the wait for it to.
 *
 * A `run.start` names the version the warden acked, so a fix written a moment ago cannot be run until
 * the warden has answered the `catalog.set` that carries it — and the same holds for any set published
 * after the one it last acked, which it is about to hold. `ackedVersionCovering` is the question ("is the
 * newest set acked, and does it hold this id?" — by id alone: whether its command is still the entry's
 * is the warden's refusal to make, not a reason to wait); `waitForCoveringAck` is the wait, which ends
 * on the EVENT that can answer it — `catalog.service.ts` calling `notifyCatalogAcked` after it stamps
 * an ack — or at the deadline it was given, never by polling.
 *
 * Consumers: `runs.service.ts` (`waitForCoveringAck`, `ackedVersionCovering`), `catalog.service.ts`
 * (`notifyCatalogAcked`, after each ack it stamps).
 */

type CoveringWaiter = {
  node: string;
  id: string;
  resolve: (version: number | null) => void;
  deadline: NodeJS.Timeout;
};

const waiters = new Set<CoveringWaiter>();

/**
 * The version of the node's NEWEST set when the warden has acked it and it holds `id` — as an entry, or
 * as a diagnosis's one-off: the warden keeps both in one table by id, so a run names either the same way
 * — else null. The newest, not the newest acked: while a set that came after the acked one is in flight
 * the warden is about to hold it, and a `run.start` naming the older version would reach it behind that
 * `catalog.set` and be refused ("not the one this warden acked"). So a set written a moment ago holds
 * every press until its ack.
 */
export function ackedVersionCovering(node: string, id: string): number | null {
  const newest = cerberusCatalogDb.latestSet(node);
  if (!newest || newest.acked_at === null) return null;
  try {
    const entries = JSON.parse(newest.entries) as CerberusCatalogSet['entries'];
    const oneOffs = JSON.parse(newest.one_offs) as CerberusCatalogSet['oneOffs'];
    return entries.some((entry) => entry.id === id) || oneOffs.some((oneOff) => oneOff.id === id) ? newest.version : null;
  } catch (error) {
    // An unreadable set must not wedge a run behind a thrown parse: it covers nothing.
    console.error(`[Cerberus] version ${newest.version} of node ${node}'s catalog has a list this center cannot read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Answers the version of the newest set once it is acked and holds `id` — now, if it is, else as soon as
 * an ack brings it — or null when `timeoutMs` passes first.
 */
export function waitForCoveringAck(node: string, id: string, timeoutMs: number): Promise<number | null> {
  const already = ackedVersionCovering(node, id);
  if (already !== null) return Promise.resolve(already);

  return new Promise((resolve) => {
    const waiter: CoveringWaiter = {
      node,
      id,
      resolve,
      deadline: setTimeout(() => {
        waiters.delete(waiter);
        resolve(null);
      }, timeoutMs),
    };
    // The wait is a convenience of a running server: a process asked to exit does not hold for it.
    waiter.deadline.unref();
    waiters.add(waiter);
  });
}

/** Tells the waiters of `node` that an ack was stamped: each whose fix the acked set now holds is answered. */
export function notifyCatalogAcked(node: string): void {
  for (const waiter of [...waiters]) {
    if (waiter.node !== node) continue;
    const version = ackedVersionCovering(node, waiter.id);
    if (version === null) continue;
    clearTimeout(waiter.deadline);
    waiters.delete(waiter);
    waiter.resolve(version);
  }
}
