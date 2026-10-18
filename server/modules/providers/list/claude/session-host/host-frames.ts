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

/**
 * The bits a re-adoption knows about a host's meta, and the calls its journal shows finished that the meta still names.
 * `turnCompleteSent`, `heldForBackgroundWork` and `deferredTools` are the host's own, as its listing read them;
 * `releasedCalls` are the finished calls the listing already left out of `deferredTools`.
 */
export type HostRelease = {
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  deferredTools: string[];
  releasedCalls?: string[];
};

/**
 * Tells a re-attached host which background calls its journal shows finished, so its meta stops naming them. The host is
 * the one writer of its meta, so a call the journal shows finished stays in the file until it is told: every boot would
 * read it, release it and say so again. `ack: false` changes the bits and moves no cursor, and the frame rides behind the
 * `hello` on the same pipe, so a replayed `result`'s own note still lands after it. Nothing is sent when nothing was released.
 *
 * Written ONCE for both transports: a chat's host answers to the same note wherever it runs, and a node's chat is as
 * stuck by a mark nobody released as a local one.
 *
 * consumer: spawner.ts (`placeInHost`, after the `hello`), node-transport.ts (`placeInNodeHost`, after the facade attaches)
 */
export function writeReleaseBack(facade: Facade, hostId: string, reattach: HostRelease, node: string | null = null): void {
  const released = reattach.releasedCalls ?? [];
  if (released.length === 0) return;
  facade.note({
    turnCompleteSent: reattach.turnCompleteSent,
    heldForBackgroundWork: reattach.heldForBackgroundWork,
    deferredTools: reattach.deferredTools,
    ack: false
  });
  const where = node === null ? '' : ` on node ${node}`;
  console.log(`[keepalive] host ${hostId}${where}: wrote the release of ${released.length} finished background call(s) back to its meta`);
}

/** `env` is held by the host in memory only — it never reaches the meta or the journal. */
export function plainEnv(env: SpawnOptions['env']): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') copy[key] = value;
  }
  return copy;
}
