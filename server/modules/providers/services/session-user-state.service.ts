import { sessionUserStateDb } from '@/modules/database/index.js';
import { broadcastSessionUpserted } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

/** One write that changes how the sidebar renders a session, so everyone is told about it. */
function broadcastSessionState(sessionId: string, context: string): void {
  void broadcastSessionUpserted(sessionId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SessionUserState] Failed to broadcast ${context}`, { sessionId, error: message });
  });
}

/** The session does not exist — the 404 every write below answers with, in `sessions.service.ts`'s shape. */
function sessionNotFound(sessionId: string): AppError {
  return new AppError(`Session "${sessionId}" was not found.`, {
    code: 'SESSION_NOT_FOUND',
    statusCode: 404,
  });
}

/**
 * The one user-chosen session attribute the sidebar owns: the icon.
 *
 * It is a small write whose whole point is that other clients see it, so the
 * write broadcasts the updated session rather than returning silently.
 * Consumed by `session-user-state.routes.ts`.
 */
export const sessionUserStateService = {
  /** Records a chat's chosen icon, or clears it back to the default. */
  setIconById(sessionId: string, icon: string | null): { sessionId: string; icon: string | null } {
    if (!sessionUserStateDb.setIcon(sessionId, icon)) {
      throw sessionNotFound(sessionId);
    }

    broadcastSessionState(sessionId, 'session icon change');
    return { sessionId, icon };
  },
};
