/**
 * Which chats have a live session host right now, and the push that tells every open page when one
 * gains or loses its last host. A chat with no host is ASLEEP: no CLI runs for it, and the next
 * message starts a fresh one.
 *
 * Rules this file exists to keep:
 * - The truth is what this process HOLDS. A host counts from the moment a transport is bound to it
 *   (`bindSocket` for this machine's keepalive, the first frame of a node's channel) until the facade
 *   that carries it settles. Every way a host ends — its CLI's `exit` frame (an idle close, a
 *   `kill-session`, a `kill-server` that SIGHUPs the host into winding its CLI down), a socket lost
 *   with no `exit`, a node channel that closes for good, a retirement over a second socket — reaches
 *   `settleExit`, so ONE listener on the facade covers them all and none of those paths is
 *   re-implemented here. The boot's re-adoption binds each surviving host the same way, so it defines
 *   the set after a restart with no code of its own.
 * - NOTHING POLLS. A change is pushed the instant the facade settles or a host binds; the only read of
 *   the whole set is the snapshot a socket is sent when it connects.
 * - A chat is live while ANY of its hosts is: a supersede overlap puts two on one chat for seconds,
 *   and the old one's end must not read as the chat falling asleep.
 * - While the API is exiting nothing is pushed on an end: it is a detach, not a host ending (D-10),
 *   and the successor's snapshot tells the pages. That snapshot is HELD by the gateway until the successor
 *   has re-adopted the hosts (a handover boot serves before its takeover), so it is never the empty one.
 *
 * The frame is `SessionHostLivenessEvent`; the fan-out copies `kanban-broadcast.service.ts`.
 *
 * consumer: spawner.ts (`bindSocket`), node-transport.ts (a node's first host frame), the providers barrel (the snapshot and
 * `onHostLivenessChanged`)
 */

import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { SessionHostLivenessEvent } from '@/shared/types.js';

import { isApiExiting } from './facade.js';
import type { Facade } from './facade.js';

/** The hosts this process holds, per chat (app session id). A chat is live while its set is non-empty. */
const hostsByChat = new Map<string, Set<string>>();

type HostLivenessListener = (sessionIds: string[]) => void;

/** Called with the chats of every `live` or `asleep` change that is broadcast; never for the snapshot. */
const livenessListeners = new Set<HostLivenessListener>();

/**
 * Subscribes to chats gaining or losing their last host — the same moments the pushed `live` and `asleep` frames go
 * out, and not the snapshot a connecting socket is sent; returns the unsubscribe. A listener that throws is logged and
 * the rest still hear it.
 *
 * consumer: the companion module's station hint, through the providers barrel
 */
export function onHostLivenessChanged(listener: HostLivenessListener): () => void {
  livenessListeners.add(listener);
  return () => {
    livenessListeners.delete(listener);
  };
}

/** Puts one frame on every open gateway socket; a socket that throws costs only itself its frame. */
function broadcastLiveness(event: SessionHostLivenessEvent): void {
  for (const listener of livenessListeners) {
    try {
      listener([...event.sessionIds]);
    } catch (error) {
      console.error(
        `[keepalive] a host-liveness listener failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const message = JSON.stringify(event);
  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;
    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[keepalive] could not send a session_host_liveness frame to a client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

function hostBound(appSessionId: string, hostId: string): void {
  const held = hostsByChat.get(appSessionId);
  if (held) {
    // The chat was already live (an overlapping host): nothing changes for a page.
    held.add(hostId);
    return;
  }
  hostsByChat.set(appSessionId, new Set([hostId]));
  broadcastLiveness({ kind: 'session_host_liveness', change: 'live', sessionIds: [appSessionId], at: Date.now() });
}

function hostEnded(appSessionId: string, hostId: string): void {
  const held = hostsByChat.get(appSessionId);
  if (!held || !held.delete(hostId) || held.size > 0) return;
  hostsByChat.delete(appSessionId);
  // D-10: a facade that settles while the API exits was detached, not ended; the successor snapshots.
  if (!isApiExiting()) {
    broadcastLiveness({ kind: 'session_host_liveness', change: 'asleep', sessionIds: [appSessionId], at: Date.now() });
  }
}

/**
 * Counts `hostId` as one of `appSessionId`'s hosts until `facade` settles, pushing `live` when it is
 * the chat's first and `asleep` when its end leaves the chat with none. Called once per bound host.
 *
 * A facade that has already settled is not counted: its host is not one a page could be talking to.
 *
 * consumer: spawner.ts (`bindSocket`), node-transport.ts (`onHostFrame`)
 */
export function trackHostLiveness(facade: Facade, appSessionId: string, hostId: string): void {
  if (facade.settled) return;
  hostBound(appSessionId, hostId);
  facade.once('exit', () => hostEnded(appSessionId, hostId));
}

/**
 * The frame a socket is sent when it connects: every chat with a live host, in one read of the map.
 * The chat gateway builds it at the moment it sends it — after the hosts are re-adopted — so a page that
 * applies the snapshot and then each change holds the same set this process does.
 *
 * consumer: the websocket module's chat gateway, through the providers barrel
 */
export function sessionHostLivenessSnapshot(): SessionHostLivenessEvent {
  return { kind: 'session_host_liveness', change: 'snapshot', sessionIds: [...hostsByChat.keys()], at: Date.now() };
}
