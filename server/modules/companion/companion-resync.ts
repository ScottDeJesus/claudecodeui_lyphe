import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { CompanionFrame } from '@/shared/companion-types.js';

/**
 * THE HINT THAT THE SERVER JUST TOOK OVER. A restart's successor serves its listener while its predecessor drains (`http-drain.ts`),
 * and a page that opens in that window lands on the successor, whose picture is the shared log as it stood at the read plus its own
 * (empty) session. What the predecessor goes on to say (her sentences, the turn's end) is sent to ITS sockets and never reaches that
 * page. The takeover (`companionService.resendUnanswered`, the moment the predecessor is gone) is the event that closes the gap:
 * it calls `announceCompanionResync` once, and a page that was already connected reads her picture again.
 *
 * A page that was on the predecessor reconnects and reads again on its own (`websocket_reconnected`); one that gets this frame as
 * well reads twice, which costs one request and changes nothing. Sent to every open socket and not one account's, the same fan-out as
 * `companion_memory` (`memory/memory-announce.ts`): serialised once, a socket that is not open skipped, each send in its own `try`.
 */

/** Put `{ kind: 'companion_resync' }` on every open gateway socket. Never throws: the takeover has already happened and a frame is only a notification. Consumed by `companion.service.ts`' `resendUnanswered`. */
export function announceCompanionResync(): void {
  const message = JSON.stringify({ kind: 'companion_resync' } satisfies CompanionFrame);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(`[Companion] could not send a companion_resync frame to a client: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
