/**
 * Arming the SDK's spawn seam: where a turn's CLI is put, and what happens when it cannot go
 * there.
 *
 * Three rules this file exists to keep:
 * - The note goes to the facade THIS call created, never through a map keyed by app session
 *   id (D-4/D-8). The provider's supersede path lets an old held CLI and a new one overlap on
 *   one session for seconds, and a session key would ack the wrong host's result.
 * - Falling back is only allowed BEFORE the first frame reaches the host. Past that point the
 *   host either has a CLI or has claimed one, and a second local spawn would put two CLIs on
 *   one session.
 * - Availability is asked per spawn, not once. The keepalive unit can be stopped between two
 *   turns, and the answer must be the truth at the moment the CLI is needed.
 *
 * consumer: index.ts
 */

import net from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

import { attachLocalSpawn, createFacade, isApiExiting } from './facade.js';
import type { Facade, HostTransport, TurnBits } from './facade.js';
import {
  hostSocketPath,
  isKeepaliveServerUp,
  isTmuxSessionAlive,
  removeHostJournal,
  sessionsDir,
  tmuxCommand
} from './hosts.js';

const GATE_ENV = 'CLOUDCLI_SESSION_KEEPALIVE';
// D-13: a fresh host is exec'd by tmux and has to reach listen(); a re-attach is talking to a
// socket that already exists or does not.
const FRESH_CONNECT_TIMEOUT_MS = 5_000;
const REATTACH_CONNECT_TIMEOUT_MS = 2_000;
const CONNECT_RETRY_MS = 50;

const HOST_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'host.js');

export type KeepaliveHandle = { note(bits: TurnBits): void };
export type KeepaliveReattach = {
  hostId: string;
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
};

type SpawnContext = { appSessionId: string; userId: string | number | null; reattach: KeepaliveReattach | null };

// D-7: read once per boot, default ON. Flipping this default is the whole feature's reversal.
let gateOpen: boolean | null = null;
let unavailableLogged = false;

/** The D-7 gate alone, with no session to bind it to. consumer: readopt.ts (the boot step) */
export function keepaliveEnabled(): boolean {
  if (gateOpen !== null) return gateOpen;
  const raw = process.env[GATE_ENV];
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  gateOpen = !(normalized === '0' || normalized === 'off' || normalized === 'false');
  if (!gateOpen) console.log(`[keepalive] disabled by ${GATE_ENV}=${raw}`);
  return gateOpen;
}

function logUnavailableOnce(reason: string): void {
  if (unavailableLogged) return;
  unavailableLogged = true;
  console.log(`[keepalive] unavailable (${reason}) — spawning in-process`);
}

/**
 * THE answer to "is the adapter armed for this turn?", asked by `armKeepaliveSpawn` and by
 * `keepaliveReadopt` so the two can never disagree. No app session id, no host to address.
 */
function armedFor(appSessionId: string | null | undefined): boolean {
  return keepaliveEnabled() && typeof appSessionId === 'string' && appSessionId !== '';
}

/**
 * The re-adoption inputs a turn should actually honour, or null. The provider reads its two
 * turn-state bits BEFORE the arming call (which needs `sdkOptions`, built later in the same
 * function), so it asks here instead and gets the identical answer — otherwise a re-adoption
 * carrying `turnCompleteSent: true` into a gate-OFF boot would pre-suppress the `complete` of
 * a turn with no host behind it. consumer: claude-runtime.provider.js
 */
export function keepaliveReadopt(
  reattach: KeepaliveReattach | null | undefined,
  appSessionId: string | null | undefined
): KeepaliveReattach | null {
  return reattach && armedFor(appSessionId) ? reattach : null;
}

/** Retries because the host is exec'd by tmux: ENOENT before the deadline means "not yet". */
function connectToHost(sockPath: string, timeoutMs: number): Promise<net.Socket> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = net.connect(sockPath);
      socket.once('connect', () => {
        socket.removeAllListeners('error');
        resolve(socket);
      });
      socket.once('error', (err: NodeJS.ErrnoException) => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`socket ${path.basename(sockPath)}: ${err.message}`));
          return;
        }
        setTimeout(attempt, CONNECT_RETRY_MS).unref();
      });
    };
    attempt();
  });
}

/** `env` is held by the host in memory only — it never reaches the meta or the journal. */
function plainEnv(env: SpawnOptions['env']): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') copy[key] = value;
  }
  return copy;
}

/** Wires the live socket to the facade and sends the frame that claims the host. */
function bindSocket(
  facade: Facade,
  socket: net.Socket,
  hostId: string,
  firstFrame: Record<string, unknown>
): void {
  socket.setNoDelay(true);

  const send = (frame: Record<string, unknown>): void => {
    if (socket.writable) socket.write(`${JSON.stringify(frame)}\n`);
  };

  const transport: HostTransport = {
    write: (chunk) => send({ t: 'stdin', b64: chunk.toString('base64') }),
    endInput: () => send({ t: 'end_input' }),
    kill: (signal) => send({ t: 'kill', signal: signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM' }),
    note: (bits) =>
      send({
        t: 'note',
        turnCompleteSent: bits.turnCompleteSent,
        heldForBackgroundWork: bits.heldForBackgroundWork
      })
  };

  const decoder = new StringDecoder('utf8');
  let buffer = '';

  const onFrame = (frame: Record<string, unknown>): void => {
    switch (frame.t) {
      case 'out':
        if (typeof frame.line === 'string') facade.pushLine(frame.line);
        return;
      case 'exit':
        // The host unlinks its own socket on the way out; the journal and the meta belong to
        // whoever was attached when the CLI ended, which is this process.
        removeHostJournal(hostId);
        facade.settleExit(
          typeof frame.code === 'number' ? frame.code : null,
          typeof frame.signal === 'string' ? (frame.signal as NodeJS.Signals) : null
        );
        socket.end();
        return;
      case 'err':
        console.warn(`[keepalive] host ${hostId} refused a frame: ${String(frame.message)}`);
        return;
      default:
        // `live` (replay finished) and anything a newer host learns to say.
        return;
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let cut = buffer.indexOf('\n');
    while (cut !== -1) {
      const raw = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      if (raw.trim() !== '') {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') onFrame(parsed as Record<string, unknown>);
        } catch (err) {
          console.warn(
            `[keepalive] host ${hostId} sent an unparseable frame: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      cut = buffer.indexOf('\n');
    }
  });

  // A host that vanishes mid-turn is reported by 'close'; 'error' only needs absorbing.
  socket.on('error', () => {});
  socket.on('close', () => {
    // No exit frame means this API lost the socket, not that the CLI died. While the API is
    // going down that is precisely the intended outcome — the host keeps the turn — so the
    // SDK is told nothing at all (D-10).
    if (facade.settled || isApiExiting()) return;
    facade.settleExit(null, 'SIGHUP');
  });

  send(firstFrame);
  facade.attach(transport);
}

async function placeInHost(facade: Facade, options: SpawnOptions, ctx: SpawnContext): Promise<void> {
  if (!isKeepaliveServerUp()) throw new Error('the keepalive tmux server is not running');

  const cwd = options.cwd || process.cwd();
  if (ctx.reattach) {
    const hostId = ctx.reattach.hostId;
    if (!isTmuxSessionAlive(hostId)) throw new Error(`host ${hostId} is no longer running`);
    const socket = await connectToHost(hostSocketPath(hostId), REATTACH_CONNECT_TIMEOUT_MS);
    // D-3: "acked" is the host's own cursor — it replays any `result` this API never
    // confirmed handling, and nothing it already did.
    bindSocket(facade, socket, hostId, { t: 'hello', fromSeq: 'acked' });
    return;
  }

  // D-8: never the bare app session id — a supersede overlap puts two hosts on one session,
  // and `tmux new-session -s <name>` refuses a duplicate.
  const hostId = `${ctx.appSessionId}-${Date.now().toString(36)}`;
  const created = tmuxCommand([
    '-f',
    '/dev/null',
    'new-session',
    '-d',
    '-s',
    hostId,
    '-c',
    cwd,
    process.execPath,
    HOST_SCRIPT,
    hostId,
    sessionsDir
  ]);
  if (!created.ok) throw new Error(`tmux new-session failed: ${created.error}`);

  const socket = await connectToHost(hostSocketPath(hostId), FRESH_CONNECT_TIMEOUT_MS);
  bindSocket(facade, socket, hostId, {
    t: 'spawn',
    command: options.command,
    args: options.args,
    cwd: options.cwd ?? null,
    env: plainEnv(options.env),
    appSessionId: ctx.appSessionId,
    userId: ctx.userId
  });
}

/**
 * Sets `sdkOptions.spawnClaudeCodeProcess` and returns the handle bound to the facade that
 * spawn function creates, or null when the gate is off or there is no app session id.
 *
 * A note before that facade exists is dropped: no `result` can precede a spawn.
 * consumer: claude-runtime.provider.js
 */
export function armKeepaliveSpawn(
  sdkOptions: Record<string, unknown>,
  ctx: {
    appSessionId: string | null;
    userId: string | number | null;
    reattach: KeepaliveReattach | null;
  }
): KeepaliveHandle | null {
  const appSessionId = ctx.appSessionId;
  if (appSessionId === null || !armedFor(appSessionId)) return null;

  let bound: Facade | null = null;
  const spawnContext: SpawnContext = { appSessionId, userId: ctx.userId, reattach: ctx.reattach };

  sdkOptions.spawnClaudeCodeProcess = (options: SpawnOptions): SpawnedProcess => {
    const facade = createFacade();
    bound = facade;
    placeInHost(facade, options, spawnContext).catch((err: unknown) => {
      // Nothing has reached a host yet, so this turn can still be run the way it is run today.
      if (facade.attached || facade.settled) return;
      const reason = err instanceof Error ? err.message : String(err);
      // A re-adopted turn carries NO prompt (the provider empties it, and the held stream then
      // parks on an open stdin), so a local CLI would be asked nothing, never reach a `result`,
      // and leave the run `running` for ever. The host it existed to rejoin is gone: end the
      // turn and let dispatchRun's safety net complete the run. Always logged — unlike the
      // fallback below, this path strands a session, so it may never be silenced by a once-gate.
      if (spawnContext.reattach) {
        console.warn(`[keepalive] re-attach to host ${spawnContext.reattach.hostId} failed (${reason}) — ending the turn`);
        facade.settleExit(null, 'SIGHUP');
        return;
      }
      logUnavailableOnce(reason);
      attachLocalSpawn(facade, options);
    });
    return facade;
  };

  return {
    note(bits: TurnBits) {
      bound?.note(bits);
    }
  };
}
