/**
 * The hosts of FRESH node placements that were refused after their `spawn` went out, kept until the
 * node's re-adoption has listed the node without them.
 *
 * WHY. A refused fresh placement (`node-transport.ts`) leaves a host on the node that no turn is waiting
 * for: its CLI would run on, and the next link-up's re-adoption would list it, find its session row and
 * hand it back as a live run. Retiring it is one frame on the node's link, and the refusal that most
 * often meets a link that is gone is the link going away itself (`closed('link lost')`: a warden restart,
 * a tailnet blink) — the frame cannot go then. A link that REPLACED the lost one has the opposite
 * trouble: the retire goes out a moment before that link-up's own list, and a retired host stays on the
 * warden's list until its CLI has exited. So:
 *
 * - every refused fresh host is remembered by node, with whether its retire went out;
 * - one that could not go is sent at the node's next link-up, BEFORE the re-adoption asks that node for
 *   its list (`sendPendingRetires`), or by this file's own link-up listener in a process that runs no
 *   re-adoption (it holds no keepalive claim) — it retires only hosts this process itself spawned;
 * - the re-adoption reads its list WITHOUT these hosts (`withoutRefusedHosts`), whichever way the retire
 *   went, and a host is forgotten once a list no longer names it.
 *
 * Nothing here polls: it moves on a refusal and on a node's link coming up.
 *
 * consumer: node-transport.ts (a refusal), node-readopt.ts (a node's link-up pass)
 */

import { nodeSessions } from '@/modules/cerberus/index.js';
import type { CerberusNodeHost } from '@/shared/cerberus-types.js';

/** node → host id → whether `session.retire` for that host went out. */
const refused = new Map<string, Map<string, boolean>>();
let listening = false;

/** Sends what a node's link could not carry earlier; idempotent, so the re-adoption and the listener may both call it. */
export function sendPendingRetires(node: string): void {
  const hosts = refused.get(node);
  if (!hosts) return;
  for (const [hostId, sent] of hosts) {
    if (!sent && nodeSessions.retireHost(node, hostId)) hosts.set(hostId, true);
  }
}

/** The one listener that keeps a pending retire from waiting on a re-adoption this process does not run. */
function listenForLinkUp(): void {
  if (listening) return;
  listening = true;
  nodeSessions.onLinkUp((node) => sendPendingRetires(node));
}

/**
 * Asks `node` to retire a host whose fresh placement was refused, now when its link is usable and at its
 * next link-up when it is not. Answers whether the request went out now.
 */
export function retireRefusedHost(node: string, hostId: string): boolean {
  const sent = nodeSessions.isLinked(node) && nodeSessions.retireHost(node, hostId);
  const hosts = refused.get(node) ?? new Map<string, boolean>();
  hosts.set(hostId, sent);
  refused.set(node, hosts);
  if (!sent) {
    console.warn(`[keepalive] node ${node}: host ${hostId} could not be retired now (its link is down) — it is retired when the link comes back, before any host is re-adopted`);
    listenForLinkUp();
  }
  return sent;
}

/** `listed` without the refused hosts; a refused host the list does not name is forgotten. */
export function withoutRefusedHosts(node: string, listed: CerberusNodeHost[]): CerberusNodeHost[] {
  const hosts = refused.get(node);
  if (!hosts) return listed;
  const named = new Set(listed.map((host) => host.hostId));
  for (const hostId of [...hosts.keys()]) if (!named.has(hostId)) hosts.delete(hostId);
  const kept = listed.filter((host) => !hosts.has(host.hostId));
  if (hosts.size === 0) refused.delete(node);
  return kept;
}
