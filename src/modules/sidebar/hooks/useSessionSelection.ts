import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

import { api } from '@/shared/api';
import type { ActiveSidebarRename, PendingSidebarDeletion, SidebarSessionSelection } from '@/shared/types';

type UseSessionSelectionArgs = {
  pendingDeletion: PendingSidebarDeletion | null;
  setPendingDeletion: Dispatch<SetStateAction<PendingSidebarDeletion | null>>;
  setActiveRename: Dispatch<SetStateAction<ActiveSidebarRename | null>>;
  /** Sessions with a run in flight; the same set the rows read, so a row and the bulk delete agree on "running". */
  activeSessions: ReadonlySet<string>;
  onSessionDelete?: (sessionId: string) => void;
  fetchArchivedSessions: () => Promise<void>;
  t: TFunction;
};

/**
 * Used by useSidebarController for a project's "Select" mode: tick several sessions, then close
 * or permanently delete them from one confirmation.
 *
 * Reuses the per-session DELETE endpoint (`api.deleteSession`), so there is no API change; a
 * failed row does not hide the rows that did go, and it comes back ticked for a retry.
 */
export function useSessionSelection({
  pendingDeletion,
  setPendingDeletion,
  setActiveRename,
  activeSessions,
  onSessionDelete,
  fetchArchivedSessions,
  t,
}: UseSessionSelectionArgs) {
  // The one session list currently in bulk-selection mode, with the rows ticked
  // in it. It lives in the controller's hook rather than in the list component because the
  // delete it feeds runs from here, and because holding a single selection is what
  // keeps a bulk delete from spanning two projects. See SidebarSessionSelection.
  const [sessionSelection, setSessionSelection] = useState<SidebarSessionSelection | null>(null);
  // The ids a bulk delete has sent and not yet heard back about. A ref, not
  // state: nothing renders from it, it only stops a second confirmation of the
  // same rows (still on screen until the first settles) from sending them again.
  const sessionIdsBeingDeletedRef = useRef<Set<string>>(new Set());

  const setProjectSessionSelection = useCallback((selection: SidebarSessionSelection) => {
    setSessionSelection(selection);
    // Selecting replaces the row's controls, so an open rename would be left
    // hanging behind the checkboxes with no way to save it.
    setActiveRename(null);
  }, [setActiveRename]);

  const toggleSessionSelected = useCallback((projectId: string, sessionId: string) => {
    setSessionSelection((previous) => {
      // A row of another project starts that project's selection from scratch;
      // one selection at a time is what keeps a bulk delete inside one list.
      const sessionIds = new Set(previous?.projectId === projectId ? previous.sessionIds : []);
      if (!sessionIds.delete(sessionId)) {
        sessionIds.add(sessionId);
      }
      return { projectId, sessionIds };
    });
  }, []);

  const cancelSessionSelection = useCallback(() => {
    setSessionSelection(null);
  }, []);

  // Takes the ids instead of reading `sessionSelection`, so it stays referentially
  // stable: it is handed to every memoized project row, and re-creating it on each
  // tick of the selection would re-render all of them.
  const showDeleteSelectedSessionsConfirmation = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }

    setPendingDeletion({ kind: 'sessions', sessionIds });
  }, [setPendingDeletion]);

  const confirmDeleteSessions = useCallback(async (hardDelete = false) => {
    if (pendingDeletion?.kind !== 'sessions') {
      return;
    }

    const selectionProjectId = sessionSelection?.projectId ?? null;
    setPendingDeletion(null);
    // Leaving selection mode as soon as the dialog is accepted takes the
    // "Delete N sessions" button away while the requests are out, so the same
    // rows cannot be confirmed twice.
    setSessionSelection(null);

    // The ids were resolved when the dialog opened, so they are checked again
    // now: a session that started a response since then is left alone (the rule
    // the rows apply), and one an earlier confirmation is still deleting is not
    // sent twice. Neither is a failure — nothing was attempted for them.
    const deletingIds = sessionIdsBeingDeletedRef.current;
    const sessionIds = pendingDeletion.sessionIds.filter(
      (sessionId) => !deletingIds.has(sessionId) && !activeSessions.has(sessionId),
    );
    if (sessionIds.length === 0) {
      return;
    }
    sessionIds.forEach((sessionId) => deletingIds.add(sessionId));

    // One request per id: the endpoint deletes a single session, and settling
    // them all means one failure does not hide the sessions that did go.
    const outcomes = await Promise.allSettled(
      sessionIds.map(async (sessionId) => {
        const response = await api.deleteSession(sessionId, hardDelete);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`status ${response.status}: ${errorText}`);
        }
        return sessionId;
      }),
    );
    sessionIds.forEach((sessionId) => deletingIds.delete(sessionId));

    const deletedSessionIds: string[] = [];
    const failedSessionIds: string[] = [];
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        deletedSessionIds.push(outcome.value);
      } else {
        failedSessionIds.push(sessionIds[index]);
        console.error('[Sidebar] Failed to delete session:', {
          sessionId: sessionIds[index],
          error: outcome.reason,
        });
      }
    });

    if (deletedSessionIds.length > 0) {
      deletedSessionIds.forEach((sessionId) => onSessionDelete?.(sessionId));
      await fetchArchivedSessions();
    }

    if (failedSessionIds.length > 0) {
      // The rows that could not be deleted come back ticked, ready to retry —
      // unless another selection was started while the requests were out.
      if (selectionProjectId) {
        setSessionSelection(
          (current) => current ?? { projectId: selectionProjectId, sessionIds: new Set(failedSessionIds) },
        );
      }
      alert(
        t('messages.deleteSessionsPartialFailure', {
          count: failedSessionIds.length,
          total: sessionIds.length,
        }),
      );
    }
  }, [activeSessions, fetchArchivedSessions, onSessionDelete, pendingDeletion, sessionSelection, setPendingDeletion, t]);

  return {
    sessionSelection,
    setProjectSessionSelection,
    toggleSessionSelected,
    cancelSessionSelection,
    showDeleteSelectedSessionsConfirmation,
    confirmDeleteSessions,
  };
}
