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

/**
 * The held hosts this server has asked to wind down (`noteHostRetiring`). An entry is only ever made for a host in `hostsByChat`, and
 * leaves with that host's end, so the set cannot outlive the hosts it names.
 */
const retiringHosts = new Set<string>();

/**
 * Records that this server is winding `hostId` down on purpose — a retirement the server chose (the idle-host version sweep after
 * a Claude CLI update), not a chat going to sleep. Called by `retireStaleIdleHosts` just before it retires a host, which is the one
 * door the install sweep, the boot's version test and a node's link-up all use; the host's end then reaches the listeners with
 * `retiredByServer` set. A host this process does not hold is ignored: nothing here hears its end, so there is nothing to mark.
 *
 * consumer: idle-version-sweep.ts (`retireStaleIdleHosts`)
 */
export function noteHostRetiring(hostId: string): void {
  for (const held of hostsByChat.values()) {
    if (held.has(hostId)) {
      retiringHosts.add(hostId);
      return;
    }
  }
}

/**
 * How a host ended: the exit `code` and the `signal` its CLI's `exit` frame reported (each null when the other is the answer; both
 * null for a socket lost with no `exit` frame, which reads as `SIGHUP`), and whether THIS server was the one that ended it
 * (`retiredByServer`: it asked the host to wind down through `noteHostRetiring`, as the install sweep does). A retirement over a
 * second socket makes the host end the API's own socket, so it reads as a lost socket and the code and signal alone cannot tell it
 * from a connection that dropped — which is why the server's own act is carried as a fact. Nothing here judges which end is a
 * sleep: a listener reads the facts (`session-auto-close.service.ts`).
 */
export type HostEnd = { code: number | null; signal: NodeJS.Signals | null; retiredByServer: boolean };

/** What a liveness listener is told: the chats, which way it went (`live` or `asleep`), and — for `asleep` only — how the last host ended. */
type HostLivenessListener = (sessionIds: string[], change: 'live' | 'asleep', end: HostEnd | null) => void;

/** Called with the chats of every `live` or `asleep` change that is broadcast; never for the snapshot. */
const livenessListeners = new Set<HostLivenessListener>();

/**
 * Subscribes to chats gaining or losing their last host — the same moments the pushed `live` and `asleep` frames go
 * out, and not the snapshot a connecting socket is sent; returns the unsubscribe. A listener that throws is logged and
 * the rest still hear it.
 *
 * consumer: the companion module's station hint, and the providers module's sleep-time auto-close, through the providers barrel
 */
export function onHostLivenessChanged(listener: HostLivenessListener): () => void {
  livenessListeners.add(listener);
  return () => {
    livenessListeners.delete(listener);
  };
}

/** Puts one frame on every open gateway socket; a socket that throws costs only itself its frame. `end` is how the last host ended, for an `asleep` push. */
function broadcastLiveness(event: SessionHostLivenessEvent & { change: 'live' | 'asleep' }, end: HostEnd | null = null): void {
  for (const listener of livenessListeners) {
    try {
      listener([...event.sessionIds], event.change, end);
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

function hostEnded(appSessionId: string, hostId: string, exit: Pick<HostEnd, 'code' | 'signal'>): void {
  const retiredByServer = retiringHosts.delete(hostId);
  const held = hostsByChat.get(appSessionId);
  if (!held || !held.delete(hostId) || held.size > 0) return;
  hostsByChat.delete(appSessionId);
  // D-10: a facade that settles while the API exits was detached, not ended; the successor snapshots.
  if (!isApiExiting()) {
    broadcastLiveness({ kind: 'session_host_liveness', change: 'asleep', sessionIds: [appSessionId], at: Date.now() }, { ...exit, retiredByServer });
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
  facade.once('exit', (code, signal) => hostEnded(appSessionId, hostId, { code, signal }));
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
