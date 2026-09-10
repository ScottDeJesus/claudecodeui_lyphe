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

/** How long a failed disposal's message stays on its row before the row goes quiet again. */
const REMOVE_FAILED_DISPLAY_MS = 4_000;

/**
 * What a row's menu asked for. Archiving hides a chat and keeps its transcript; deleting takes
 * the transcript off disk, which is why only one of the two is worth stopping to confirm.
 */
export type SimpleChatDisposal = 'archive' | 'delete';

/**
 * Owns both disposals — idle, stop-then-dispose, the 15s fallback and the failure message — so
 * SidebarSimpleList and its rows stay presentational.
 *
 * The two differ only in the flag handed to the API and in what has to be confirmed first.
 * Archive confirms nothing when the chat is idle, and asks to stop it when it is running.
 * Delete always confirms, in ONE dialog that says whether a stop comes with it — asking twice
 * for one destructive act reads as a bug, and asking only about the stop would take a yes about
 * interrupting a run as a yes about erasing it.
 */
export function useSimpleChatRemove(input: { onArchived: (sessionId: string) => void }): {
  pendingStop: RecentConversationListItem | null;
  pendingDelete: RecentConversationListItem | null;
  failedSessionId: string | null;
  remove: (row: RecentConversationListItem, disposal: SimpleChatDisposal) => void;
  confirmStop: () => void;
  cancelStop: () => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
} {
  const { onArchived } = input;
  const busySessionIds = useBusySessionIdSet();
  const { sendMessage } = useWebSocket();

  // The row the stop-confirmation dialog is open for; null when it is closed.
  const [pendingStop, setPendingStop] = useState<RecentConversationListItem | null>(null);
  // The row the delete-confirmation dialog is open for; null when it is closed.
  const [pendingDelete, setPendingDelete] = useState<RecentConversationListItem | null>(null);
  // The session a chat.abort was just sent for, waiting on the busy set to drop it — carrying
  // the disposal it was stopped FOR, so the wait cannot finish as the wrong one.
  const [awaiting, setAwaiting] = useState<{ id: string; disposal: SimpleChatDisposal } | null>(null);
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

  const dispose = useCallback(async (sessionId: string, disposal: SimpleChatDisposal) => {
    try {
      const response = await api.deleteSession(sessionId, disposal === 'delete');
      if (response.ok) {
        onArchived(sessionId);
        return;
      }
      console.error('[SidebarSimpleList] Failed to %s session:', disposal, response.status);
      setFailedSessionId(sessionId);
    } catch (error) {
      console.error('[SidebarSimpleList] Error running %s on session:', disposal, error);
      setFailedSessionId(sessionId);
    }
  }, [onArchived]);

  // Clears the row's failure message on its own schedule, independent of any disposal above.
  useEffect(() => {
    if (!failedSessionId) return undefined;
    const timer = setTimeout(() => setFailedSessionId(null), REMOVE_FAILED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [failedSessionId]);

  const remove = useCallback((row: RecentConversationListItem, disposal: SimpleChatDisposal) => {
    // Deleting is off disk and cannot be undone, so it always stops to ask — running or not.
    if (disposal === 'delete') {
      setPendingDelete(row);
      return;
    }
    if (!busySessionIds.has(row.sessionId)) {
      void dispose(row.sessionId, 'archive');
      return;
    }
    setPendingStop(row);
  }, [dispose, busySessionIds]);

  /** Sends the abort and waits for the busy set to drop the id, then finishes the disposal. */
  const stopThenDispose = useCallback((sessionId: string, disposal: SimpleChatDisposal) => {
    sendMessage({ type: 'chat.abort', sessionId });
    setAwaiting({ id: sessionId, disposal });

    clearFallback();
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      setAwaiting(null);
      void dispose(sessionId, disposal);
    }, STOP_TIMEOUT_MS);
  }, [clearFallback, dispose, sendMessage]);

  const confirmStop = useCallback(() => {
    if (!pendingStop) return;
    const sessionId = pendingStop.sessionId;
    setPendingStop(null);
    stopThenDispose(sessionId, 'archive');
  }, [pendingStop, stopThenDispose]);

  const cancelStop = useCallback(() => setPendingStop(null), []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const sessionId = pendingDelete.sessionId;
    setPendingDelete(null);
    // The one dialog already said a running chat gets stopped first, so this needs no second yes.
    if (busySessionIds.has(sessionId)) {
      stopThenDispose(sessionId, 'delete');
      return;
    }
    void dispose(sessionId, 'delete');
  }, [busySessionIds, dispose, pendingDelete, stopThenDispose]);

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  // The busy set is the client's computed running model — chat_subscribed/complete frames plus
  // a GET /sessions/running re-sync every 5s — so reacting to it dropping the id is the whole
  // wait: no polling timer, no ref loop. This IS the "external system" the lint rule below asks
  // an effect to be reserved for: the busy set lives outside React, and archiving is a side
  // effect (a fetch), not a value this component could derive during render.
  useEffect(() => {
    if (!awaiting || busySessionIds.has(awaiting.id)) return;
    const { id, disposal } = awaiting;
    // oxlint-disable-next-line react/set-state-in-effect
    setAwaiting(null);
    clearFallback();
    void dispose(id, disposal);
  }, [awaiting, busySessionIds, dispose, clearFallback]);

  return {
    pendingStop,
    pendingDelete,
    failedSessionId,
    remove,
    confirmStop,
    cancelStop,
    confirmDelete,
    cancelDelete,
  };
}
