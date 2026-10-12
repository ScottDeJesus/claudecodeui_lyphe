/**
 * What a host's frames mean to a turn, and what a turn's client frames look like to a host — written
 * ONCE, because two transports carry them. The unix socket of this machine's own keepalive
 * (`bindSocket` in spawner.ts) and the channel a node's warden relays (`node-transport.ts`) speak the
 * same NDJSON protocol (MANUAL: "The socket protocol"); if each kept its own reading of it they would
 * drift, and a drift here is a turn that ends differently depending on where its CLI happens to live.
 *
 * What stays with a transport is what only it can do: the unix socket removes the host's journal and
 * closes itself when the CLI has exited; the node channel leaves both to the warden, which was the
 * attached client there.
 *
 * consumer: spawner.ts, node-transport.ts
 */

import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk';

import type { CerberusHostFrame } from '@/shared/cerberus-types.js';

import type { Facade, HostTransport } from './facade.js';

/**
 * Hands one host frame to the turn's facade. Answers true when it was the host's `exit` — the
 * facade is settled and the host has said its last, so whatever the transport owes at that moment
 * (the journal, the socket) is now due.
 *
 * consumer: spawner.ts (`bindSocket`), node-transport.ts
 */
export function deliverHostFrame(facade: Facade, frame: CerberusHostFrame, hostId: string): boolean {
  switch (frame.t) {
    case 'out':
      if (typeof frame.line === 'string') facade.pushLine(frame.line);
      return false;
    case 'exit':
      // A CLI that could not be started has no exit code worth reporting; the host sends Node's own
      // message instead. Told to the SDK first, as `attachLocalSpawn` does, so the turn fails with
      // the cause rather than with a bare "exited". A host from before this field sends none.
      if (typeof frame.error === 'string' && frame.error !== '') facade.emitError(new Error(frame.error));
      facade.settleExit(
        typeof frame.code === 'number' ? frame.code : null,
        typeof frame.signal === 'string' ? (frame.signal as NodeJS.Signals) : null
      );
      return true;
    case 'err':
      console.warn(`[keepalive] host ${hostId} refused a frame: ${String(frame.message)}`);
      return false;
    default:
      // `live` (replay finished) and anything a newer host learns to say.
      return false;
  }
}

/**
 * The facade's transport over any pipe that can put one frame toward the host. `send` is the
 * transport's own write; what it does with a frame it cannot carry — drop it, hold it for a
 * re-open — is that transport's rule, not this mapping's.
 *
 * consumer: spawner.ts (`bindSocket`), node-transport.ts
 */
export function hostTransport(send: (frame: CerberusHostFrame) => void): HostTransport {
  return {
    write: (chunk) => send({ t: 'stdin', b64: chunk.toString('base64') }),
    endInput: () => send({ t: 'end_input' }),
    kill: (signal) => send({ t: 'kill', signal: signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM' }),
    note: (bits) =>
      send({
        t: 'note',
        turnCompleteSent: bits.turnCompleteSent,
        heldForBackgroundWork: bits.heldForBackgroundWork,
        ...(Array.isArray(bits.deferredTools) ? { deferredTools: bits.deferredTools } : {}),
        // Absent when the caller does not speak of it; a host from before the field ignores the key.
        ...(bits.idleCheck !== undefined ? { idleCheck: bits.idleCheck } : {}),
        // A host from before these fields ignores them and retires nothing anyway (no result is
        // outstanding when a message joins), so the frame stays readable by every host.
        ...(bits.ack === false ? { ack: false } : {})
      })
  };
}

/** `env` is held by the host in memory only — it never reaches the meta or the journal. */
export function plainEnv(env: SpawnOptions['env']): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') copy[key] = value;
  }
  return copy;
}
