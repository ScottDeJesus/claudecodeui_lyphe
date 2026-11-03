import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { SessionArchiveChangedEvent } from '@/shared/types.js';

/**
 * Tells every open page that chats were closed or reopened, so a sidebar updates live instead of
 * on its next unrelated refresh. A close writes `isArchived`, and `session_upserted` never goes out
 * for an archived row (`buildSessionUpsertedEvent` answers null for one), so without this frame a
 * chat closed in another tab, by the sleep-time auto-close or by Kaylee stayed on screen.
 *
 * One `JSON.stringify` for the whole set, then a walk of `connectedClients`; a socket that throws
 * costs only itself its frame. Consumed by `sessions.service.ts` (close, reopen) and
 * `session-auto-close.service.ts`, through the websocket barrel.
 */
export function broadcastSessionArchiveChanged(sessionIds: string[], isArchived: boolean): void {
  if (sessionIds.length === 0) return;

  const frame: SessionArchiveChangedEvent = { kind: 'session_archive_changed', sessionIds, isArchived, at: Date.now() };
  const message = JSON.stringify(frame);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[SessionArchive] could not send a session_archive_changed frame to a client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
