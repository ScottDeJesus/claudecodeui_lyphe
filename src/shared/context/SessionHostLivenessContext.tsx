import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';

/** `undefined` outside the provider so the hook can refuse; `null` inside it until the first snapshot lands. */
const SessionHostLivenessContext = createContext<ReadonlySet<string> | null | undefined>(undefined);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * Keeps the set of chats that have a live session host (a tmux session the chat's CLI runs in), from
 * the `session_host_liveness` frames the server pushes over the one socket. App mounts it directly
 * under `WebSocketProvider`, ABOVE the auth gate, for one reason: the server sends the snapshot once,
 * as the socket connects, and a provider that mounted later than the connection would miss it and
 * stand on "unknown" until the next reconnect. Mounted here it has subscribed before the socket exists.
 *
 * NOTHING POLLS. The snapshot replaces the set; a `live` frame adds its chats and an `asleep` frame
 * takes its chats out. A socket that drops keeps the last set — the hosts live on while the page is
 * disconnected — and the next connection's snapshot corrects whatever changed in the gap.
 */
export function SessionHostLivenessProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  // The chats with a live host, or null before this page has heard the server's snapshot. Essential
  // state: the server pushes only CHANGES after the snapshot, so the set has to be kept here. Null is
  // "unknown", which a reader treats as "grey nothing" rather than "everything is asleep".
  const [liveSessionIds, setLiveSessionIds] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => subscribe((event) => {
    if (event.kind !== 'session_host_liveness') return;
    const ids = Array.isArray(event.sessionIds) ? event.sessionIds.filter(isNonEmptyString) : [];

    if (event.change === 'snapshot') {
      setLiveSessionIds(new Set(ids));
      return;
    }
    if (event.change !== 'live' && event.change !== 'asleep') return;

    setLiveSessionIds((previous) => {
      // A change before any snapshot cannot be placed in a set that does not exist yet. The server holds
      // the snapshot until its hosts are re-adopted, so a change can land first; the snapshot is built
      // after it and already holds it.
      if (previous === null) return previous;
      const next = new Set(previous);
      for (const id of ids) {
        if (event.change === 'live') next.add(id);
        else next.delete(id);
      }
      // Adding can only grow the set and deleting only shrink it, so an equal size means nothing
      // changed: the same set is kept, and a repeated frame re-renders nothing.
      return next.size === previous.size ? previous : next;
    });
  }), [subscribe]);

  return (
    <SessionHostLivenessContext.Provider value={liveSessionIds}>
      {children}
    </SessionHostLivenessContext.Provider>
  );
}

/**
 * The chats whose CLI has a live session host, or null while the server has not said yet. A chat NOT
 * in the set is asleep — its next message starts a fresh host — but only a Claude chat can ever be in
 * it, so a reader must check the chat's provider before reading absence as asleep. Read by the simple
 * chat list (sidebar module) to gray a row; pushed on change, never polled.
 */
export function useSessionHostLiveSet(): ReadonlySet<string> | null {
  const liveSessionIds = useContext(SessionHostLivenessContext);
  if (liveSessionIds === undefined) {
    throw new Error('useSessionHostLiveSet must be used within SessionHostLivenessProvider');
  }
  return liveSessionIds;
}
