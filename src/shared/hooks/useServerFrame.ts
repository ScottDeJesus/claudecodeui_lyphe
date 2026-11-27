import { useEffect, useRef } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ServerEvent } from '@/shared/types';

/** Injected by the socket on a reconnect: frames were missed while it was down, so every rider reads once. */
const RECONNECTED_KIND = 'websocket_reconnected';

/** Joins kinds into one dependency value: a caller's new array of the same kinds must not resubscribe. */
const KIND_SEPARATOR = '\n';

/**
 * Calls `onFrame` for every server frame whose kind is in `kinds`, and for `websocket_reconnected`,
 * for the life of the component.
 *
 * `onFrame` is held in a ref, so a new closure on every render never resubscribes; the subscription
 * changes only when the set of kinds does.
 */
export function useServerFrame(kinds: readonly string[], onFrame: (event: ServerEvent) => void): void {
  const { subscribe } = useWebSocket();
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  const kindsKey = kinds.join(KIND_SEPARATOR);
  useEffect(() => {
    const wanted = new Set(kindsKey.split(KIND_SEPARATOR));
    return subscribe((event) => {
      if (event.kind === undefined) return;
      if (event.kind === RECONNECTED_KIND || wanted.has(event.kind)) onFrameRef.current(event);
    });
  }, [subscribe, kindsKey]);
}
