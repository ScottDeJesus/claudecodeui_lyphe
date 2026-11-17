import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { SessionPanelKind, SessionPanelVersionHead } from '@/shared/types';

const KINDS: readonly SessionPanelKind[] = ['diagram', 'picture', 'page', 'widget'];

/** Whether a value read off the wire is one version's head. */
function isHead(value: unknown): value is SessionPanelVersionHead {
  if (typeof value !== 'object' || value === null) return false;
  const head = value as Record<string, unknown>;
  return typeof head.id === 'number'
    && typeof head.version === 'number'
    && typeof head.title === 'string'
    && typeof head.createdAt === 'string'
    && KINDS.includes(head.kind as SessionPanelKind);
}

/** One chat's last good reading, tagged with the chat it was read for. */
type Reading = { sessionId: string; versions: SessionPanelVersionHead[] };

/**
 * The versions of what one chat has put on its panel, oldest first: one read, kept current.
 *
 * A FRAME IS A HINT, NOT A PICTURE, as it is for the chat's follow-ups (`useFollowups`): `session_panel_changed` names the chat it
 * moved, and the answer to one for THIS chat (or to `websocket_reconnected`) is "read the list again". The subscription is made
 * before the first read, so a frame that lands between the two starts its own read. Reads overlap, so each takes a ticket and an
 * answer older than one already applied is dropped.
 *
 * `sessionId` is the chat's APP session id, or null while no chat has a panel to read, when nothing is read and nothing is
 * subscribed. A read that fails keeps the last good list; a chat never read answers null, which a panel draws as nothing.
 *
 * Used by `SessionPanelProvider`, once for the chat on screen.
 */
export function useSessionPanelVersions(sessionId: string | null): SessionPanelVersionHead[] | null {
  const { subscribe } = useWebSocket();

  // The last good reading and the chat it was read for. Essential: it is the only copy of the list between reads, and the tag
  // is what keeps one chat's panel from drawing under another chat after a switch.
  const [reading, setReading] = useState<Reading | null>(null);

  // The chat the subscription serves, so an answer that lands after a switch is recognised and dropped.
  const sessionRef = useRef<string | null>(null);
  // The newest read that left, and the newest ticket whose answer was applied.
  const newestReadRef = useRef(0);
  const newestAppliedRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (sessionId === null) return;
    const ticket = ++newestReadRef.current;
    let answer: SessionPanelVersionHead[] | null = null;
    try {
      const response = await api.sessionPanel.list(sessionId);
      if (response.ok) {
        const body = (await response.json()) as { data?: unknown };
        if (Array.isArray(body.data)) answer = body.data.filter(isHead);
      }
    } catch {
      // This app's own network, or a body that is not JSON: the same "no answer" a refusal leaves behind.
    }
    if (sessionRef.current !== sessionId || answer === null || ticket < newestAppliedRef.current) return;
    newestAppliedRef.current = ticket;
    setReading({ sessionId, versions: answer });
  }, [sessionId]);

  useEffect(() => {
    sessionRef.current = sessionId;
    if (sessionId === null) return undefined;
    const unsubscribe = subscribe((event) => {
      const namesThisChat = event.kind === 'session_panel_changed' && event.appSessionId === sessionId;
      if (namesThisChat || event.kind === 'websocket_reconnected') void refresh();
    });
    void refresh();
    return () => {
      unsubscribe();
      sessionRef.current = null;
    };
  }, [sessionId, refresh, subscribe]);

  return reading !== null && reading.sessionId === sessionId ? reading.versions : null;
}
