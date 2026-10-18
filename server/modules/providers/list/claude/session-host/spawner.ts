/**
 * Arming the SDK's spawn seam: where a turn's CLI is put, and what happens when it cannot go
 * there.
 *
 * Four rules this file exists to keep:
 * - The note goes to the facade THIS call created, never through a map keyed by app session
 *   id (D-4/D-8). The provider's supersede path lets an old held CLI and a new one overlap on
 *   one session for seconds, and a session key would ack the wrong host's result.
 * - Falling back is only allowed BEFORE the first frame reaches the host. Past that point the
 *   host either has a CLI or has claimed one, and a second local spawn would put two CLIs on
 *   one session.
 * - Availability is asked per spawn, not once. The keepalive unit can be stopped between two
 *   turns, and the answer must be the truth at the moment the CLI is needed.
 * - A turn in a node's project is placed by that node's warden (`node-transport.ts`) or ended with
 *   the reason. It never falls back: that CLI runs on its node and nowhere else.
 *
 * consumer: index.ts
 */

import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';

import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

import type { CerberusHostFrame, CerberusNodeHostLastTurn } from '@/shared/cerberus-types.js';
import type { IdleCheck } from '@/shared/types.js';

import { attachLocalSpawn, createFacade, isApiExiting } from './facade.js';
import type { Facade, TurnBits } from './facade.js';
import { deliverHostFrame, hostTransport, plainEnv, writeReleaseBack } from './host-frames.js';
import { trackHostLiveness } from './host-liveness.js';
import { isKeepaliveServerUp, isTmuxSessionAlive, registry, removeHostJournal } from './hosts.js';
import { placeInNodeHost } from './node-transport.js';

const GATE_ENV = 'CLOUDCLI_SESSION_KEEPALIVE';
// D-13: a fresh host is exec'd by tmux and has to reach listen(); a re-attach is talking to a
// socket that already exists or does not.
const FRESH_CONNECT_TIMEOUT_MS = 5_000;
const REATTACH_CONNECT_TIMEOUT_MS = 2_000;

export type KeepaliveHandle = { note(bits: TurnBits): void };
export type KeepaliveReattach = {
  hostId: string;
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  /** The launch profile the host recorded at spawn (chat-process.ts); null from an older host. */
  profile: Record<string, unknown> | null;
  /**
   * The CLI version that host's own process announced at init, read from its journal by
   * re-adoption (host-registry.js, `lastReportedCliVersion`); null when its journal holds no such line.
   * It rides beside the profile rather than inside it because the two are recorded by different
   * hands: the meta is what the API launched the CLI with, the journal is what the CLI said.
   */
  cliVersion: string | null;
  /** The tool-call ids whose work was still outstanding when the meta was last written, less those the host's journal shows finished. */
  deferredTools: string[];
  /** The calls that list left out because the journal shows them finished; the meta still names them until the host is told. */
  releasedCalls?: string[];
  /** The CLI's own background tasks the host's journal shows running: the process's task set starts from them, not empty. Null when a node's warden lists none (`compaction/node-task-ledger.ts`). */
  liveTasks?: string[] | null;
  /** The meta's record of the idle compaction check for the host's last turn end; the process carries it forward. */
  idleCheck?: IdleCheck | null;
  /**
   * The last finished turn of a host on a NODE, as its warden read it off the host's journal. A local host's is read
   * from this machine's own journal at re-adoption (`claude-compaction-restore.ts`); a node's journal is the warden's,
   * which this server is never handed the path of, so the warden's listing carries it. Absent for a local host, and
   * null from a warden that does not list it.
   */
  lastTurn?: CerberusNodeHostLastTurn | null;
  /** The node whose warden holds the host, or null for a host on this machine's own keepalive. */
  node: string | null;
};

type SpawnContext = {
  appSessionId: string;
  userId: string | number | null;
  reattach: KeepaliveReattach | null;
  /** Written into the host meta at spawn, so a re-adoption knows what the CLI was launched with. */
  profile: Record<string, unknown> | null;
};

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

/** Wires the live socket to the facade and sends the frame that claims the host. */
function bindSocket(
  facade: Facade,
  socket: net.Socket,
  hostId: string,
  appSessionId: string,
  firstFrame: CerberusHostFrame
): void {
  socket.setNoDelay(true);
  // The chat has a live host from here until this facade settles (host-liveness.ts).
  trackHostLiveness(facade, appSessionId, hostId);

  const send = (frame: CerberusHostFrame): void => {
    if (socket.writable) socket.write(`${JSON.stringify(frame)}\n`);
  };

  const decoder = new StringDecoder('utf8');
  let buffer = '';

  // What a frame means is `deliverHostFrame`'s, shared with the node transport; what is owed when the
  // host says `exit` is this socket's own.
  const onFrame = (frame: CerberusHostFrame): void => {
    if (!deliverHostFrame(facade, frame, hostId)) return;
    // The host unlinks its own socket on the way out; the journal and the meta belong to
    // whoever was attached when the CLI ended, which is this process.
    removeHostJournal(hostId);
    socket.end();
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
          if (parsed && typeof parsed === 'object') onFrame(parsed as CerberusHostFrame);
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
  facade.attach(hostTransport(send));
}

async function placeInHost(facade: Facade, options: SpawnOptions, ctx: SpawnContext): Promise<void> {
  if (!isKeepaliveServerUp()) throw new Error('the keepalive tmux server is not running');

  const cwd = options.cwd || process.cwd();
  if (ctx.reattach) {
    const hostId = ctx.reattach.hostId;
    if (!isTmuxSessionAlive(hostId)) throw new Error(`host ${hostId} is no longer running`);
    const socket = await registry.connectToHost(hostId, REATTACH_CONNECT_TIMEOUT_MS);
    // D-3: "acked" is the host's own cursor — it replays any `result` this API never
    // confirmed handling, and nothing it already did.
    bindSocket(facade, socket, hostId, ctx.appSessionId, { t: 'hello', fromSeq: 'acked' });
    writeReleaseBack(facade, hostId, ctx.reattach);
    return;
  }

  // D-8: never the bare app session id — a supersede overlap puts two hosts on one session,
  // and `tmux new-session -s <name>` refuses a duplicate.
  const hostId = `${ctx.appSessionId}-${Date.now().toString(36)}`;
  registry.spawnHostSession(hostId, cwd);

  const socket = await registry.connectToHost(hostId, FRESH_CONNECT_TIMEOUT_MS);
  bindSocket(facade, socket, hostId, ctx.appSessionId, {
    t: 'spawn',
    command: options.command,
    args: options.args,
    cwd: options.cwd ?? null,
    env: plainEnv(options.env),
    appSessionId: ctx.appSessionId,
    userId: ctx.userId,
    profile: ctx.profile
  });
}

type ArmContext = {
  appSessionId: string | null;
  userId: string | number | null;
  reattach: KeepaliveReattach | null;
  profile?: Record<string, unknown> | null;
  /** The node whose warden must run this turn's CLI, or null/absent for this machine. */
  node?: string | null;
};

/** The handle a `result` is acked through: the facade the spawn function last created. */
const handleFor = (facadeOf: () => Facade | null): KeepaliveHandle => ({
  note: (bits: TurnBits) => facadeOf()?.note(bits)
});

/**
 * A node's turn: placed by the node's warden, or ended with the reason. The reason reaches the SDK as
 * the spawn error (as a CLI that failed to start does), then the turn ends as a killed process does.
 * The gate does not disarm it: with the gate off the spawn function still exists, and refuses.
 */
function armNodeSpawn(sdkOptions: Record<string, unknown>, node: string, ctx: ArmContext): KeepaliveHandle {
  let bound: Facade | null = null;

  sdkOptions.spawnClaudeCodeProcess = (options: SpawnOptions): SpawnedProcess => {
    const facade = createFacade();
    bound = facade;

    const appSessionId = ctx.appSessionId;
    let placing: Promise<void>;
    if (!keepaliveEnabled()) {
      const off = `Session keepalive is off on this server (${GATE_ENV}), and ${node}'s sessions only run hosted`;
      placing = Promise.reject(new Error(off));
    } else if (appSessionId === null) {
      placing = Promise.reject(new Error(`This turn has no session id to host, and ${node}'s sessions only run hosted`));
    } else {
      const { userId, reattach } = ctx;
      placing = placeInNodeHost(facade, options, { node, appSessionId, userId, reattach, profile: ctx.profile ?? null });
    }

    placing.catch((err: unknown) => {
      if (facade.settled) return;
      const reason = err instanceof Error ? err.message : String(err);
      // Always logged: this path ends a person's turn, so it is never silenced by a once-gate.
      console.warn(`[keepalive] node ${node}: ${reason} — ending the turn`);
      facade.emitError(new Error(reason));
      facade.settleExit(null, 'SIGTERM');
    });
    return facade;
  };

  return handleFor(() => bound);
}

/**
 * Sets `sdkOptions.spawnClaudeCodeProcess` and returns the handle bound to the facade that
 * spawn function creates, or null when the gate is off or there is no app session id — except a
 * turn with a `node`, always armed: placed on the node or refused, never left to the SDK's own spawn.
 *
 * A note before that facade exists is dropped: no `result` can precede a spawn.
 * consumer: claude-runtime.provider.js
 */
export function armKeepaliveSpawn(sdkOptions: Record<string, unknown>, ctx: ArmContext): KeepaliveHandle | null {
  if (ctx.node) return armNodeSpawn(sdkOptions, ctx.node, ctx);

  const appSessionId = ctx.appSessionId;
  if (appSessionId === null || !armedFor(appSessionId)) return null;

  let bound: Facade | null = null;
  const spawnContext: SpawnContext = {
    appSessionId,
    userId: ctx.userId,
    reattach: ctx.reattach,
    profile: ctx.profile ?? null
  };

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

  return handleFor(() => bound);
}
