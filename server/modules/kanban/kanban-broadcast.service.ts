import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { KanbanBoardEvent } from '@/shared/types.js';

/**
 * Puts one board frame on every open gateway socket.
 *
 * Its ONLY caller is `writeKanban` in `kanban-write.service.ts`, and the frame it is handed is
 * always read AFTER the write committed — never before, and never from inside the transaction.
 *
 * The fan-out copies `session-upsert-broadcast.service.ts`: `JSON.stringify` once for the whole
 * set rather than once per socket, then a walk of `connectedClients` sending to each client whose
 * `readyState` is `WS_OPEN_STATE`. A socket that is closing is skipped by that check; one that
 * throws mid-send is caught PER CLIENT, because a dead socket is that client's problem and must
 * not cost every client after it in the set their frame.
 *
 * No per-user or per-project filtering: there is none anywhere else in this server's broadcasts,
 * and this frame adds none.
 */
export function broadcastKanbanEvent(frame: KanbanBoardEvent): void {
  const message = JSON.stringify(frame);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[Kanban] could not send a ${frame.event.kind} frame to a client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
