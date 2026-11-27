import { useEffect } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';

/** Injected by the socket on a reconnect: a new socket starts with no watches, so it is asked again. */
const RECONNECTED_KIND = 'websocket_reconnected';

/**
 * How many mounted views of this tab want each lane and key. The server holds one watch per socket
 * and key, so two views of the same key (a chat's pinned row and a card drawer's step) share it, and
 * only the last one to leave sends `watch.stop`; otherwise closing one would leave the other unwatched.
 */
const holdersByWatch = new Map<string, number>();

/** One entry per lane and key; the separator cannot occur in a lane name. */
function watchIdOf(lane: string, key: string | null): string {
  return key === null ? `${lane}\n` : `${lane}\n:${key}`;
}

/**
 * Watches one key of a server lane (`server/modules/websocket/services/lane-watch.service.ts`) while
 * `wanted`: sends `{ type: 'watch.start', lane, key }` when it starts wanting and again on every
 * `websocket_reconnected`, and `{ type: 'watch.stop', lane, key }` when the last view of this tab
 * wanting that key stops wanting it, changes key or unmounts. The lane's frames are heard through
 * `useServerFrame`; this hook only says what is being looked at.
 */
export function useLaneWatch(lane: string, key: string | null, wanted: boolean): void {
  const { sendMessage, subscribe } = useWebSocket();

  useEffect(() => {
    if (!wanted) return undefined;
    const watchId = watchIdOf(lane, key);
    const start = (): void => sendMessage({ type: 'watch.start', lane, key });
    const holders = holdersByWatch.get(watchId) ?? 0;
    holdersByWatch.set(watchId, holders + 1);
    if (holders === 0) start();
    // Every holder re-sends on a reconnect: the server takes a repeated start as the same watch.
    const unsubscribe = subscribe((event) => {
      if (event.kind === RECONNECTED_KIND) start();
    });
    return () => {
      unsubscribe();
      const left = (holdersByWatch.get(watchId) ?? 1) - 1;
      if (left > 0) {
        holdersByWatch.set(watchId, left);
        return;
      }
      holdersByWatch.delete(watchId);
      sendMessage({ type: 'watch.stop', lane, key });
    };
  }, [lane, key, wanted, sendMessage, subscribe]);
}
