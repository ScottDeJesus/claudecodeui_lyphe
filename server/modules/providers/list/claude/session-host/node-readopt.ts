/**
 * A node's hosts come back when its warden is heard: the boot re-adoption (`readopt.ts`) for hosts
 * that live in a co-located warden's tmux server instead of this machine's keepalive.
 *
 * WHEN. Never at the boot step itself — on a plain boot that runs before the server listens, and the
 * wardens redial only once the gateway does. The trigger is `nodeSessions.onLinkUp`, which tells of
 * every link, a warden restarting under a live API and an API restarting under live wardens alike;
 * `replay` covers the nodes already linked when this subscribes, which is a handover's takeover.
 * What runs on a co-located node's link is the boot pipeline, on the node's own answer: list its
 * hosts, keep the newest per app session (`retireOlderHosts`), wind down the idle ones left on an
 * older build (`retireStaleIdleHosts`), and hand each keeper back (`readoptHost`).
 *
 * WHAT IT SKIPS. A host a live facade is waiting for (`waitingHostIds`): its turn lost the link and
 * re-attaches to its host by itself on the same link-up, at the exact seq its SDK last read — a second
 * adoption would race it for the one host, and `fromSeq: "acked"` would replay what that SDK has.
 * Taken twice, before the list and after, because the facade's own re-attach lands while the list is
 * in flight and a host it already re-attached to is still not one to adopt.
 *
 * A MESSAGE IN THE WINDOW. Between a node's link-up and the registration of its runs this process holds
 * neither a run nor a facade for the node's live sessions, so a message that starts a turn then would
 * spawn a fresh host beside the live one and orphan it. Two refusals close it (`gateFreshNodeHosts`,
 * `node-transport.ts`): a fresh host on the node is refused with a sentence while its pass runs, and
 * for a session whose live host the pass could not register because a turn already held the session
 * (the message was ahead of the pass) until that turn ends — which it does, refused — and the host is
 * then re-adopted, on the run registry's own completion event. The person sends again.
 *
 * ONLY THE CLAIM HOLDER. `watchNodeLinks` is called by `readoptKeepaliveSessions` after it took the
 * claim, and by nothing else: a scratch probe server that never holds it must not retire the
 * operator's chats (measured 2026-09-15).
 *
 * THE RUNNING-SESSIONS HOLD. `whenNodeSessionsReadopted` is the other half of MAN-690 (D-11): a
 * browser that subscribes into a registry that has not re-adopted yet reads a live session as idle,
 * and the node's sessions are re-adopted only when its warden has linked. It resolves once every
 * co-located node last heard in the ten minutes before this boot has linked and been listed and
 * adopted. A node that was never heard before the boot, or is not on this machine, is not waited for;
 * a node that does not come back leaves it pending, and `server/index.ts` bounds its wait.
 *
 * consumer: readopt.ts (the claim holder's boot), and server/index.ts through the providers barrel
 */

import { hintChanged, nodeSessions } from '@/modules/cerberus/index.js';
import { cerberusNodesDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { CerberusNodeHost } from '@/shared/cerberus-types.js';

import { installedCliVersionForLaunch } from '../installed-cli-version.js';

import { colocatedNodeIds } from './colocated-hosts.js';
import { isApiExiting } from './facade.js';
import { retireOlderHosts } from './hosts.js';
import { retireStaleIdleHosts } from './idle-version-sweep.js';
import { gateFreshNodeHosts, waitingHostIds } from './node-transport.js';
import { readoptHost } from './readopt-host.js';
import type { ReadoptableHost, ReadoptDeps } from './readopt-host.js';

/** How far before this boot a node may last have been heard and still be one this boot waits for. */
const HEARD_BEFORE_BOOT_MS = 10 * 60_000;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The newest link-up each node has had; an older pipeline still running when a newer one starts yields to it. */
const newestRunByNode = new Map<string, number>();
let runCounter = 0;
/** Nodes with a pass between its link-up and the registration of its runs, with that pass's run number. */
const passingByNode = new Map<string, number>();
/** Sessions whose live host waits for the turn now running on them to end, and the node that holds the host. */
const waitingSessions = new Map<string, { node: string; stop: () => void }>();

/** The nodes the hold waits for, and the ones whose hosts have been handed back so far. */
const awaited = new Set<string>();
const readopted = new Set<string>();
let released = false;
let watching = false;
let resolveWhenReadopted: () => void = () => {};
const whenReadopted = new Promise<void>((resolve) => {
  resolveWhenReadopted = resolve;
});

function releaseIfComplete(): void {
  if ([...awaited].every((node) => readopted.has(node))) resolveWhenReadopted();
}

/**
 * Resolves once every co-located node heard in the ten minutes before this boot has linked and had
 * its hosts re-adopted — at once when this process took no claim, or no node is waited for.
 *
 * consumer: server/index.ts (the running-sessions hold), through the providers barrel
 */
export function whenNodeSessionsReadopted(): Promise<void> {
  return whenReadopted;
}

/**
 * This process will re-adopt no node's hosts — it holds no claim, or the keepalive gate is off — so
 * there is nothing for the hold to wait for.
 *
 * consumer: readopt.ts
 */
export function releaseNodeReadoptionWait(): void {
  released = true;
  resolveWhenReadopted();
}

/**
 * The co-located nodes heard in the window before this process began. Their last stamp is the
 * warden's own heartbeat, written at most once a minute, so a node heard until the restart reads up
 * to about a minute old and falls well inside it.
 */
function nodesHeardBeforeBoot(): string[] {
  const bootAt = Date.now() - process.uptime() * 1000;
  const heardRecently = new Set(
    cerberusNodesDb
      .list()
      .filter((node) => node.last_heartbeat_at !== null && node.last_heartbeat_at >= bootAt - HEARD_BEFORE_BOOT_MS)
      .map((node) => node.id)
  );
  return colocatedNodeIds().filter((node) => heardRecently.has(node));
}

/** Why a FRESH host for `appSessionId` on `node` is refused now, as a sentence — or null. See "A MESSAGE IN THE WINDOW". */
function freshHostRefusal(node: string, appSessionId: string): string | null {
  const standing = passingByNode.has(node) || waitingSessions.get(appSessionId)?.node === node;
  return standing ? `${node}'s sessions are being re-adopted — send the message again in a moment` : null;
}

/**
 * A live host whose session a turn already holds cannot be registered now: re-adopts it the moment that
 * turn's terminal `complete` is recorded, and says so. A newer pass of the node drops the wait, since it
 * lists afresh and decides again.
 */
function adoptWhenSessionIdle(node: string, host: ReadoptableHost, deps: ReadoptDeps): void {
  const session = host.appSessionId;
  waitingSessions.get(session)?.stop();
  console.log(`[keepalive] node ${node}: host ${host.hostId} waits for the turn running on session ${session} to end, then is re-adopted`);
  const unsubscribe = chatRunRegistry.onRunCompleted((endedSession) => {
    if (endedSession !== session) return;
    stop();
    if (!isApiExiting()) readoptHost(host, deps, node);
  });
  const stop = (): void => {
    unsubscribe();
    if (waitingSessions.get(session)?.stop === stop) waitingSessions.delete(session);
  };
  waitingSessions.set(session, { node, stop });
}

/**
 * The boot pipeline on one co-located node's answer. Returns how many hosts it handed back, or null
 * when the node could not say what it holds — a later link-up retries, and the hold keeps waiting.
 */
async function readoptNode(node: string, deps: ReadoptDeps, run: number): Promise<number | null> {
  // Before the first await: a facade's own re-attach is on this very link-up and must not be adopted twice.
  const waitingBefore = waitingHostIds();
  let listed: CerberusNodeHost[];
  try {
    listed = await nodeSessions.listHosts(node);
  } catch (error) {
    console.warn(`[keepalive] node ${node}: could not list its hosts (${errorText(error)}) — nothing re-adopted until its link comes up again`);
    return null;
  }

  const retire = (hostId: string): void => {
    nodeSessions.retireHost(node, hostId);
  };
  const keepers = retireOlderHosts(listed, retire);
  const fresh = retireStaleIdleHosts(keepers, await installedCliVersionForLaunch(), retire);
  // A link that came up again while this one waited on the version: the newer run lists afresh and adopts what is there now.
  if (newestRunByNode.get(node) !== run) return null;
  // The process began to exit while this pass waited (D-10): a host adopted now would be attached at `"acked"` by
  // a process that will not handle what that replays. Its successor adopts it.
  if (isApiExiting()) return null;

  const waitingAfter = waitingHostIds();
  let adopted = 0;
  for (const host of fresh) {
    if (waitingBefore.has(host.hostId) || waitingAfter.has(host.hostId)) continue;
    if (chatRunRegistry.isProcessing(host.appSessionId)) {
      adoptWhenSessionIdle(node, host, deps);
      continue;
    }
    if (readoptHost(host, deps, node)) adopted += 1;
  }
  return adopted;
}

async function onNodeLinkUp(node: string, deps: ReadoptDeps): Promise<void> {
  // A remote node's CLIs are not on this machine and its projects are not assignable: nothing here is its to adopt.
  if (!nodeSessions.isColocated(node) || isApiExiting()) return;
  runCounter += 1;
  const run = runCounter;
  newestRunByNode.set(node, run);
  passingByNode.set(node, run);
  for (const waiting of [...waitingSessions.values()]) if (waiting.node === node) waiting.stop();
  let adopted: number | null;
  try {
    adopted = await readoptNode(node, deps, run);
  } finally {
    // A newer pass owns the flag now; only the pass that set it clears it.
    if (passingByNode.get(node) === run) passingByNode.delete(node);
  }
  if (adopted === null) return;
  console.log(`[keepalive] node ${node}: re-adopted ${adopted} host(s)`);
  // The list the pipeline asked for is the node card's session count; the link's own change was announced before it.
  hintChanged({ nodes: [node] });
  readopted.add(node);
  releaseIfComplete();
}

/**
 * Subscribes the re-adoption to every node's link. Once per process, and only by the process that
 * holds the keepalive claim. consumer: readopt.ts
 */
export function watchNodeLinks(deps: ReadoptDeps): void {
  if (watching || released) return;
  watching = true;
  try {
    for (const node of nodesHeardBeforeBoot()) awaited.add(node);
  } catch (error) {
    // The Cerberus store is what says which nodes were heard; without it nothing is waited for, but the links are still watched.
    console.warn(`[keepalive] could not read which nodes were heard before this boot (${errorText(error)}) — the running-sessions read waits for none`);
  }
  releaseIfComplete();
  try {
    nodeSessions.onLinkUp((node) => onNodeLinkUp(node, deps), { replay: true });
    gateFreshNodeHosts(freshHostRefusal);
  } catch (error) {
    // A relay that cannot arm (a frame type another plan holds) costs the node hosts their re-adoption and nothing
    // else: this runs inside the boot step, ahead of the local re-adoption, which must never be lost to it.
    console.error(`[keepalive] could not watch the nodes' links (${errorText(error)}) — this boot re-adopts no node's hosts`);
    releaseNodeReadoptionWait();
  }
}
