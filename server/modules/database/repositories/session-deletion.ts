/**
 * Who hears that chat rows were deleted from the `sessions` table.
 *
 * WHY IT EXISTS. State kept elsewhere can name a chat (Kaylee's focus, `companion_state.focus_json`) and has no way to
 * learn that the chat is gone: the row is deleted by the sidebar's delete (`sessionsService.deleteSessionById`), by the
 * synchronizer when a transcript vanished from disk, and by a project's delete, and the three meet only at this table. So
 * the table's own doors announce it, here, and a module that holds such state subscribes (`companion/feeds/deleted-chat-feed.ts`).
 * A leaf module with no imports: `sessions.db.ts` announces through it and nothing under `modules/` imports back into the database.
 *
 * A row removed by the duplicate merge (`assignProviderSessionId`: the watcher's row folded into the app row) is NOT announced:
 * the chat lives on under the app row's id, which is the one other state names.
 *
 * Synchronous, after the delete has happened; a listener that throws is logged and never stops the others or the delete.
 */

type SessionsDeletedListener = (sessionIds: string[]) => void;

const listeners = new Set<SessionsDeletedListener>();

/** Subscribes to deleted chat ids; returns the unsubscribe. Consumed by `modules/companion/feeds/deleted-chat-feed.ts`, through the database barrel. */
export function onSessionsDeleted(listener: SessionsDeletedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every subscriber that these chat rows are gone. Consumed by `sessions.db.ts`' two doors (`deleteSessionById`, `deleteSessionsByProjectPath`). */
export function announceSessionsDeleted(sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  for (const listener of listeners) {
    try {
      listener(sessionIds);
    } catch (error) {
      console.error('[Sessions] a listener of deleted chats failed:', error);
    }
  }
}

type SessionArchiveListener = (sessionId: string, isArchived: boolean) => void;

const archiveListeners = new Set<SessionArchiveListener>();

/**
 * Subscribes to a chat being archived or restored (`isArchived` true or false): the row stays, but a list of his chats gains or
 * loses it. The sidebar's archive and restore write the flag and broadcast nothing, so the station's hint hears it here. Returns
 * the unsubscribe. Consumed by `modules/companion/station/station-hint.ts`, through the database barrel.
 */
export function onSessionArchiveChanged(listener: SessionArchiveListener): () => void {
  archiveListeners.add(listener);
  return () => {
    archiveListeners.delete(listener);
  };
}

/** Tells every subscriber that this chat row was archived or restored. Consumed by `sessions.db.ts`' `updateSessionIsArchived`; synchronous, after the write, and a listener that throws is logged and stops no other. */
export function announceSessionArchiveChanged(sessionId: string, isArchived: boolean): void {
  for (const listener of archiveListeners) {
    try {
      listener(sessionId, isArchived);
    } catch (error) {
      console.error('[Sessions] a listener of archived chats failed:', error);
    }
  }
}
