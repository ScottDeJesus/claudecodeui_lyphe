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
 * The two user-chosen session attributes the sidebar owns: the icon, and the
 * session's place in the simple list's manual order.
 *
 * Both are small writes whose whole point is that other clients see them, so
 * each one broadcasts the updated session rather than returning silently.
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

  /**
   * Moves one session to the top of the simple list, or directly below the
   * session named in `afterSessionId`.
   */
  moveInSimpleListById(
    sessionId: string,
    afterSessionId: string | null,
  ): { sessionId: string; afterSessionId: string | null } {
    if (!sessionUserStateDb.moveInSimpleList(sessionId, afterSessionId)) {
      throw sessionNotFound(sessionId);
    }

    broadcastSessionState(sessionId, 'simple list move');
    return { sessionId, afterSessionId };
  },
};
