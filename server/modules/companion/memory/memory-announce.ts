import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { CompanionFrame } from '@/shared/companion-types.js';

/**
 * THE HINT THAT HER MEMORY CHANGED. Every write of her bank (`remember`, `forget` and `clearMemory`, `memory-verbs.ts`) runs inside
 * `onBank` in this process, and each one that changed the bank, or may have (a write the door did not answer is still being worked by
 * the door), calls `announceMemoryChanged` once; a refusal that changed nothing sends none. The frame carries nothing,
 * `{ kind: 'companion_memory' }`: a page that shows her memory reads it again through `GET /api/companion/memory/lines`. Nothing
 * else sends it and nothing polls for it, so a bank that changes behind this process's back (the docstore's own CLI, another
 * process) is not announced; the corner re-reads when it mounts and when the socket reconnects.
 *
 * TO EVERY OPEN SOCKET, NOT ONE ACCOUNT'S. Her bank is one package for both accounts, so a memory kept through one account moves the
 * corner on every page of the other too, and the frame is the house's `followups_changed` fan-out: serialised once, a socket that is
 * not open skipped, each send in its own `try` so one dead socket does not cost the rest their frame.
 */

/** Put `{ kind: 'companion_memory' }` on every open gateway socket. Never throws: the write it follows has already landed, and a frame is only a notification. Consumed by `memory-verbs.ts`, after a write that changed her bank. */
export function announceMemoryChanged(): void {
  const message = JSON.stringify({ kind: 'companion_memory' } satisfies CompanionFrame);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(`[Companion] could not send a companion_memory frame to a client: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
