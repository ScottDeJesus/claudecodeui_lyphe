/**
 * The hosts that run on THIS machine under a node's warden — the Claude work the house counts that
 * `listLiveHosts()` cannot see, because it reads this API's own keepalive and a co-located node's
 * hosts live in the warden's.
 *
 * A co-located node is a node on this machine (`nodeSessions.isColocated`): its CLIs are this
 * machine's `claude` processes, so an update that installs under them breaks the very conversations
 * the reading exists to protect. The claude-activity module reads them beside `listLiveHosts()`.
 *
 * Two rules this file exists to keep:
 * - THE LIST MOVES ON EVENTS, never on a clock. A cache that a timer refreshes is a poll that reads
 *   wrong between its ticks — in the one direction the activity reading may never be wrong in. The
 *   relay keeps every `sessions.listed`, so the cache is current after: a node's link-up
 *   (re-adoption, `node-readopt.ts`); a host placed on, ended on or retired from a node
 *   (`noteNodeHostsChanged`, told by `node-transport.ts` and by the re-adoption's own retirements) —
 *   which is also what keeps the node card's session count true; and the reading itself, which asks
 *   every linked co-located warden first (`refreshColocatedNodeHosts`).
 * - ONLY WHAT WAS JUST READ COUNTS. A co-located node whose link is down contributes nothing, so its
 *   CLIs show as "other Claude processes" in the activity reading and hold an install, exactly as a
 *   process nothing here knows about does: a list that was true a minute ago says nothing about now.
 *
 * consumer: claude-activity.service.ts, through the providers barrel
 */

import { hintChanged, nodeSessions } from '@/modules/cerberus/index.js';
import { cerberusNodesDb } from '@/modules/database/index.js';

import type { LiveHost } from './hosts.js';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Every enrolled node that runs on this machine, in enrollment order. consumer: node-readopt.ts */
export function colocatedNodeIds(): string[] {
  return cerberusNodesDb
    .list()
    .map((node) => node.id)
    .filter((id) => nodeSessions.isColocated(id));
}

/** How long a burst of placements and endings on one node settles before it is listed once. */
const HOSTS_CHANGED_SETTLE_MS = 1_500;
const settling = new Map<string, NodeJS.Timeout>();

/**
 * A host was placed on `node`, ended there or retired from it, so the hosts it holds have moved: lists them again once
 * the burst has settled (a turn that ends and the next that starts are one listing, not two) and
 * tells open Fleet screens to re-read, since the node card shows how many run there. A listing that
 * fails is logged; the next event, or the activity reading, lists again.
 *
 * consumer: node-transport.ts, when a fresh host answers, when a host's `exit` is delivered and when a
 * refused fresh placement retires its host; node-readopt.ts and readopt-host.ts, when a re-adoption
 * retires a host
 */
export function noteNodeHostsChanged(node: string): void {
  if (settling.has(node)) return;
  const timer = setTimeout(() => {
    settling.delete(node);
    nodeSessions.listHosts(node).then(
      () => hintChanged({ nodes: [node] }),
      (error: unknown) => console.warn(`[keepalive] node ${node}: could not list its hosts after a change (${errorText(error)})`)
    );
  }, HOSTS_CHANGED_SETTLE_MS);
  timer.unref();
  settling.set(node, timer);
}

/**
 * The hosts the linked co-located nodes last listed. A copy, as `lastListed` hands it: a caller may
 * reorder it freely. Throws only when the Cerberus store cannot be read, which the activity reading
 * turns into a reason of its own.
 *
 * consumer: claude-activity.service.ts (the conversation leg, beside `listLiveHosts()`)
 */
export function listColocatedNodeHosts(): LiveHost[] {
  return colocatedNodeIds()
    .filter((node) => nodeSessions.isLinked(node))
    .flatMap((node) => nodeSessions.lastListed(node));
}

/**
 * Asks every linked co-located warden for its hosts now, so the next `listColocatedNodeHosts()` is
 * current. Rejects with the node named when any of them cannot answer: the reading fails closed on
 * a source it could not read, and says which.
 *
 * consumer: claude-activity.service.ts, awaited at the head of the reading
 */
export async function refreshColocatedNodeHosts(): Promise<void> {
  const failures: string[] = [];
  let linked: string[] = [];
  try {
    linked = colocatedNodeIds().filter((node) => nodeSessions.isLinked(node));
  } catch (error) {
    failures.push(`the Cerberus store: ${errorText(error)}`);
  }
  const answers = await Promise.allSettled(linked.map((node) => nodeSessions.listHosts(node)));
  answers.forEach((answer, index) => {
    if (answer.status === 'rejected') failures.push(`${linked[index]}: ${errorText(answer.reason)}`);
  });
  if (failures.length > 0) throw new Error(`the sessions on a co-located node could not be listed (${failures.join('; ')})`);
}
