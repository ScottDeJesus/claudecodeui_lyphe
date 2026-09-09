import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { RecentConversationListItem } from '@/shared/types';

/**
 * Mirrors STOP_TIMEOUT_MS in `src/modules/chat/hooks/useRestartOnInstalledCli.ts` — same
 * guarantee (the only thing that ends a stop the gateway never answers), a different outcome
 * here: archive the chat anyway, rather than abandon a restart. Deliberately not hoisted to
 * `src/shared/constants.ts` — the two values happen to agree, not share a caller, and a shared
 * name would tempt a future change to one to drag the other along with it.
 */
const STOP_TIMEOUT_MS = 15_000;

/** How long a failed archive's message stays on its row before the row goes quiet again. */
const REMOVE_FAILED_DISPLAY_MS = 4_000;

/**
 * Owns the whole Remove flow — idle-archive, stop-then-archive, the 15s fallback and the
 * failure message — so SidebarSimpleList and its rows stay presentational.
 */
export function useSimpleChatRemove(input: { onArchived: (sessionId: string) => void }): {
  pendingStop: RecentConversationListItem | null;
  failedSessionId: string | null;
  remove: (row: RecentConversationListItem) => void;
  confirmStop: () => void;
  cancelStop: () => void;
} {
  const { onArchived } = input;
  const busySessionIds = useBusySessionIdSet();
  const { sendMessage } = useWebSocket();

  // The row the stop-confirmation dialog is open for; null when it is closed.
  const [pendingStop, setPendingStop] = useState<RecentConversationListItem | null>(null);
  // The session id a chat.abort was just sent for, waiting on the busy set to drop it.
  const [awaitingId, setAwaitingId] = useState<string | null>(null);
  // The id whose archive just failed; shown on its own row for REMOVE_FAILED_DISPLAY_MS.
  const [failedSessionId, setFailedSessionId] = useState<string | null>(null);

  // The 15s fallback armed by confirmStop; cleared on success (below) and on unmount (here).
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearFallback, [clearFallback]);

  const archive = useCallback(async (sessionId: string) => {
    try {
      const response = await api.deleteSession(sessionId, false);
      if (response.ok) {
        onArchived(sessionId);
        return;
      }
      console.error('[SidebarSimpleList] Failed to archive session:', response.status);
      setFailedSessionId(sessionId);
    } catch (error) {
      console.error('[SidebarSimpleList] Error archiving session:', error);
      setFailedSessionId(sessionId);
    }
  }, [onArchived]);

  // Clears the row's failure message on its own schedule, independent of any archive above.
  useEffect(() => {
    if (!failedSessionId) return undefined;
    const timer = setTimeout(() => setFailedSessionId(null), REMOVE_FAILED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [failedSessionId]);

  const remove = useCallback((row: RecentConversationListItem) => {
    if (!busySessionIds.has(row.sessionId)) {
      void archive(row.sessionId);
      return;
    }
    setPendingStop(row);
  }, [archive, busySessionIds]);

  const confirmStop = useCallback(() => {
    if (!pendingStop) return;
    const sessionId = pendingStop.sessionId;
    sendMessage({ type: 'chat.abort', sessionId });
    setAwaitingId(sessionId);
    setPendingStop(null);

    clearFallback();
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      setAwaitingId(null);
      void archive(sessionId);
    }, STOP_TIMEOUT_MS);
  }, [archive, clearFallback, pendingStop, sendMessage]);

  const cancelStop = useCallback(() => setPendingStop(null), []);

  // The busy set is the client's computed running model — chat_subscribed/complete frames plus
  // a GET /sessions/running re-sync every 5s — so reacting to it dropping the id is the whole
  // wait: no polling timer, no ref loop. This IS the "external system" the lint rule below asks
  // an effect to be reserved for: the busy set lives outside React, and archiving is a side
  // effect (a fetch), not a value this component could derive during render.
  useEffect(() => {
    if (!awaitingId || busySessionIds.has(awaitingId)) return;
    const sessionId = awaitingId;
    // oxlint-disable-next-line react/set-state-in-effect
    setAwaitingId(null);
    clearFallback();
    void archive(sessionId);
  }, [awaitingId, busySessionIds, archive, clearFallback]);

  return { pendingStop, failedSessionId, remove, confirmStop, cancelStop };
}
