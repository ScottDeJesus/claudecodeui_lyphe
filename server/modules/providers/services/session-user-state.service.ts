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
 * The user-chosen session attributes the sidebar owns: the icon and the pin.
 *
 * Each is a small write whose whole point is that other clients see it, so
 * the write broadcasts the updated session rather than returning silently.
 * Consumed by `session-user-state.routes.ts`, and `setPinnedById` by Kaylee's
 * `pin_session` through the providers barrel, so a pin from her and one from
 * the sidebar are the same write.
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
   * Pins or unpins a chat. A pinned chat sorts first in every list and is never closed by the
   * sleep-time auto-close; the pin is nothing else — it does not keep the chat awake or protect it
   * from a close he asks for.
   */
  setPinnedById(sessionId: string, pinned: boolean): { sessionId: string; pinned: boolean } {
    if (!sessionUserStateDb.setPinned(sessionId, pinned)) {
      throw sessionNotFound(sessionId);
    }

    broadcastSessionState(sessionId, 'session pin change');
    return { sessionId, pinned };
  },
};
