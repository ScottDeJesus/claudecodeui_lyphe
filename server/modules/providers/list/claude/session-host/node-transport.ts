/**
 * The session host's second transport: a turn whose project is assigned to a node has its CLI
 * spawned by THAT node's warden, and the warden's channel stands where the unix socket stands for a
 * local turn. The frames are the same NDJSON, delivered by the same mapping (`host-frames.ts`).
 *
 * Rules this file exists to keep:
 * - NO FALLBACK. A node project's CLI runs on its node or the turn ends with the reason; this file
 *   never starts one locally, and the spawner never asks it to. Every refusal is a sentence a person
 *   can act on.
 * - A GRACE WAITS FOR A LINK, and only for one. The relay's `closed('link lost')` is a link blink —
 *   the warden restarted, the tailnet hiccuped — and the host kept the CLI, so the facade stays
 *   unsettled for 60 s and the channel is re-opened when the node's link is back. Any other `closed`
 *   is the warden speaking on a standing link (the open was refused, the host's socket ended with no
 *   `exit`): that loss is real and ends the turn at once, exactly as the unix socket's `close` does —
 *   and, unlike the unix socket, says WHY: the warden's sentence is the process's error, so the chat
 *   shows it instead of a bare SIGHUP.
 * - A BLINK RESUMES AT THE EXACT SEQ. This facade's SDK already read every `out` line up to the last
 *   one delivered, so the re-open says `hello { fromSeq: <that seq> }` — a number, which `"acked"`
 *   would overshoot by replaying lines the SDK has (MAN-686). The one facade that has read NOTHING is
 *   a re-adoption that has heard no `out` yet (only `live`): its cursor is still `"acked"`, because
 *   `0` would replay the host's whole journal into an SDK that consumed none of it, and put every
 *   retired `result` back among the host's unacked ones.
 * - CO-LOCATED AT EVERY PLACEMENT, fresh and re-attach alike. The CLI runs this machine's command with this
 *   machine's environment, in a folder that is a path on this machine's disk, so a node that is not on this
 *   machine (`nodeSessions.isColocated`: its last hello's machine id is not this one's) is refused with the way
 *   back, whatever it was when the project was assigned (`project-node.service.ts` checks only then). The same
 *   refusal is what keeps a node chat's transcript readable here: the CLI writes it under this machine's own
 *   `~/.claude/projects`, so the house's compaction (`server/modules/compaction/`) takes a node chat over exactly
 *   as it takes a local one, and reads its transcript from this disk.
 * - A FRESH PLACEMENT THAT IS REFUSED AFTER ITS `spawn` WENT OUT RETIRES ITS HOST. Detaching the channel leaves
 *   the CLI running, the person is told the turn failed, and the next link-up would re-adopt the orphan as a
 *   live run; so the host is asked to wind down and the node's count is listed again. When the refusal IS the
 *   link going away the retire cannot go: `refused-hosts.ts` keeps it for the node's next link-up and has the
 *   re-adoption leave that host alone. A refused re-attach keeps its host: it still belongs to a live session.
 * - NO FRESH HOST BESIDE ONE THE RE-ADOPTION HAS NOT HANDED BACK. A node's live host is re-adopted when
 *   its warden links, a moment after which a message can already start a turn here; a fresh spawn
 *   then would sit beside the live host, orphan it, and put two CLIs on one transcript. The
 *   re-adoption (`node-readopt.ts`) knows when that is, and a fresh turn it names is refused with a
 *   sentence; the person sends again.
 * - D-10 holds here too: while the API is exiting a closed channel is a detach and settles nothing,
 *   and the facade swallows `kill` and `end_input` itself.
 * - No frame is ever logged: a `spawn` frame carries the CLI's whole environment.
 *
 * consumer: spawner.ts
 */

import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk';

import { nodeSessions } from '@/modules/cerberus/index.js';
import type { CerberusHostFrame } from '@/shared/cerberus-types.js';

import { isApiExiting } from './facade.js';
import type { Facade } from './facade.js';
import { noteNodeHostsChanged } from './colocated-hosts.js';
import { deliverHostFrame, hostTransport, plainEnv, writeReleaseBack } from './host-frames.js';
import type { HostRelease } from './host-frames.js';
import { trackHostLiveness } from './host-liveness.js';
import { retireRefusedHost } from './refused-hosts.js';

/** A warden that has not said one word about a session this long after the open is not going to. */
const FIRST_FRAME_TIMEOUT_MS = 15_000;
/** How long a lost link may take to come back before the CLI is reported gone. */
const LINK_GRACE_MS = 60_000;
/** What the relay (`node-sessions.ts`) tells a channel whose link went away. */
const LINK_LOST = 'link lost';

/**
 * Where a turn goes and who it is for. `reattach` is the host a re-adoption rejoins, null for a
 * fresh turn: its id, and what the listing read of its meta, so the release of the calls its journal
 * shows finished is written back to it (`writeReleaseBack`).
 *
 * consumer: spawner.ts
 */
export type NodePlacement = {
  node: string;
  appSessionId: string;
  userId: string | number | null;
  reattach: ({ hostId: string } & HostRelease) | null;
  profile: Record<string, unknown> | null;
};

type Channel = NonNullable<ReturnType<typeof nodeSessions.openChannel>>;

/** The graces in progress, one per waiting facade, so one host is never counted twice. */
const graces = new Set<{ hostId: string }>();

/**
 * The hosts a grace is holding right now: a turn here has lost its link and will re-attach when the
 * node returns, so a re-adoption must not adopt the same host a second time.
 *
 * consumer: node-readopt.ts (the node re-adoption)
 */
export function waitingHostIds(): Set<string> {
  return new Set([...graces].map((grace) => grace.hostId));
}

/** The sentence that refuses a FRESH host for a session on a node, or null when none stands in the way. */
type FreshHostGate = (node: string, appSessionId: string) => string | null;
let freshHostGate: FreshHostGate = () => null;

/**
 * Lets the node re-adoption refuse a fresh host while it has not handed a node's live hosts back. Set
 * once by the process that holds the keepalive claim; a process without it has no gate.
 *
 * consumer: node-readopt.ts
 */
export function gateFreshNodeHosts(gate: FreshHostGate): void {
  freshHostGate = gate;
}

const notConnected = (node: string): Error =>
  new Error(`${node}'s warden is not connected — this project's sessions run on ${node}`);

/**
 * The sentence that refuses a placement on a node that is not on this machine, or null when it is. The
 * answer reads the node's stored machine id, which can fail with the store: that is a refusal too, since a
 * turn that cannot be placed must reject here rather than throw out of the spawn function.
 *
 * This gate is what lets the house's compaction take a node chat over like a local one: a chat placed here
 * runs on this machine's own disk, so its transcript is a file this server reads (see the header).
 */
function colocationRefusal(node: string): string | null {
  try {
    if (nodeSessions.isColocated(node)) return null;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `Could not tell whether ${node} is on this machine (${why})`;
  }
  return `${node} is no longer this machine — move this project back to this server from its card on the Cerberus tab`;
}

/**
 * Opens the turn's channel on its node and wires it to the facade. The promise settles ONCE: it
 * resolves at the first frame the warden sends back, and rejects with the sentence when the turn
 * cannot be placed — the node is not on this machine, it is not linked, the warden refused the open, or it
 * was silent for 15 s. After it resolves the turn is the host's and its trouble ends the facade itself.
 *
 * consumer: spawner.ts
 */
export function placeInNodeHost(facade: Facade, options: SpawnOptions, ctx: NodePlacement): Promise<void> {
  const { node } = ctx;
  const notHere = colocationRefusal(node);
  if (notHere !== null) return Promise.reject(new Error(notHere));
  if (!nodeSessions.isLinked(node)) return Promise.reject(notConnected(node));

  const cwd = options.cwd ?? null;
  if (!ctx.reattach && cwd === null) {
    return Promise.reject(new Error(`This turn has no working folder to start in on ${node}`));
  }
  const refusal = ctx.reattach ? null : freshHostGate(node, ctx.appSessionId);
  if (refusal !== null) return Promise.reject(new Error(refusal));
  // D-8: never the bare app session id — a supersede overlap puts two hosts on one session.
  const hostId = ctx.reattach ? ctx.reattach.hostId : `${ctx.appSessionId}-${Date.now().toString(36)}`;

  let resolvePlaced: () => void = () => {};
  let rejectPlaced: (error: Error) => void = () => {};
  const placed = new Promise<void>((resolve, reject) => {
    resolvePlaced = resolve;
    rejectPlaced = reject;
  });

  let channel: Channel | null = null;
  /** Bumped by every open and by `release`, so a channel that was replaced or let go is not heard. */
  let generation = 0;
  /** Where a re-open resumes: the last `out` seq delivered, or the host's own cursor while none has been. */
  let resumeFrom: number | 'acked' = ctx.reattach ? 'acked' : 0;
  let heardHost = false;
  /** Client frames that had no channel to go down: held until a re-open, written in order. */
  let held: CerberusHostFrame[] = [];
  let firstFrameTimer: NodeJS.Timeout | null = null;
  let graceTimer: NodeJS.Timeout | null = null;
  let stopListening: (() => void) | null = null;
  const grace = { hostId };

  const sendToHost = (frame: CerberusHostFrame): void => {
    if (facade.settled) return;
    if (channel === null || !channel.send(frame)) held.push(frame);
  };

  function endGrace(): void {
    if (graceTimer !== null) clearTimeout(graceTimer);
    graceTimer = null;
    graces.delete(grace);
    stopListening?.();
    stopListening = null;
  }

  /** Lets go of everything this placement holds: timers, the link-up subscription, the channel. */
  function release(): void {
    generation += 1;
    if (firstFrameTimer !== null) clearTimeout(firstFrameTimer);
    firstFrameTimer = null;
    endGrace();
    channel?.detach();
    channel = null;
    held = [];
  }

  /** The host is lost for good: its reason is the process's error, so the chat can say why, then the process ends hung up. */
  function endTurn(reason: string): void {
    release();
    facade.emitError(new Error(reason));
    facade.settleExit(null, 'SIGHUP');
  }

  /**
   * The turn could not be placed: nothing of it reached a host that will be heard from. A fresh placement
   * has already put its `spawn` on the wire, so the host it may have started is retired (at the node's next
   * link-up when its link is gone) and the node's hosts are listed again; a re-attach keeps its host, which
   * still belongs to a live session.
   */
  function refuse(reason: string): void {
    release();
    if (!ctx.reattach && retireRefusedHost(node, hostId)) noteNodeHostsChanged(node);
    rejectPlaced(new Error(reason));
  }

  function onHostFrame(frame: CerberusHostFrame): void {
    if (!heardHost) {
      heardHost = true;
      if (firstFrameTimer !== null) clearTimeout(firstFrameTimer);
      firstFrameTimer = null;
      resolvePlaced();
      // The warden has spoken for the host: the chat has a live host until this facade settles. A link
      // blink (the grace above) leaves the facade unsettled, so the chat stays live through one.
      trackHostLiveness(facade, ctx.appSessionId, hostId);
      // A fresh host is one more the node holds; a re-adopted one was already listed.
      if (!ctx.reattach) noteNodeHostsChanged(node);
    }
    if (graceTimer !== null) {
      endGrace();
      console.log(`[keepalive] node ${node}: re-attached host ${hostId} after its link returned`);
    }
    if (frame.t === 'out' && typeof frame.seq === 'number' && frame.seq > 0 && (resumeFrom === 'acked' || frame.seq > resumeFrom)) {
      resumeFrom = frame.seq;
    }
    if (deliverHostFrame(facade, frame, hostId)) {
      // The host's `exit` is its last word: it is one fewer the node holds.
      noteNodeHostsChanged(node);
      release();
    }
  }

  function onChannelClosed(reason: string): void {
    channel = null;
    if (facade.settled || isApiExiting()) {
      release();
      return;
    }
    if (!heardHost) {
      // The open itself was refused or cut off before the host said anything: nothing was placed.
      refuse(reason === LINK_LOST ? `The link to ${node}'s warden was lost before the session started` : reason);
      return;
    }
    if (reason !== LINK_LOST) {
      console.warn(`[keepalive] node ${node}: host ${hostId} is gone (${reason}) — ending the turn`);
      endTurn(reason);
      return;
    }
    startGrace();
  }

  function startGrace(): void {
    if (graceTimer === null) {
      console.warn(`[keepalive] node ${node}: lost the link to host ${hostId}; waiting up to ${LINK_GRACE_MS / 1000} s for it to return`);
      graces.add(grace);
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (facade.settled || isApiExiting()) {
          release();
          return;
        }
        console.warn(`[keepalive] node ${node}: host ${hostId} was not reachable again within ${LINK_GRACE_MS / 1000} s — ending the turn`);
        endTurn(`${node}'s warden was not reachable again within ${LINK_GRACE_MS / 1000} s`);
      }, LINK_GRACE_MS);
      graceTimer.unref();
    }
    // Subscribed before this handler returns: a link that REPLACED the lost one is already up, and the
    // relay announces it to the listeners it holds when this very pass reaches them.
    if (stopListening === null) {
      stopListening = nodeSessions.onLinkUp((linkedNode) => {
        if (linkedNode === node) reopen();
      });
    }
  }

  function reopen(): void {
    if (channel !== null || graceTimer === null || facade.settled || isApiExiting()) return;
    if (openChannel('attach', { t: 'hello', fromSeq: resumeFrom }) === null) return; // not usable yet: the next link-up retries
    const pending = held;
    held = [];
    for (const frame of pending) sendToHost(frame);
  }

  function openChannel(op: 'spawn' | 'attach', frame: CerberusHostFrame): Channel | null {
    generation += 1;
    const mine = generation;
    channel = nodeSessions.openChannel(
      node,
      { op, hostId, cwd: op === 'spawn' ? cwd : null, frame },
      {
        frame: (incoming) => {
          if (mine === generation) onHostFrame(incoming);
        },
        closed: (reason) => {
          if (mine === generation) onChannelClosed(reason);
        }
      }
    );
    return channel;
  }

  const first: CerberusHostFrame = ctx.reattach
    ? // D-3: "acked" is the host's own cursor — it replays any `result` this API never confirmed
      // handling, and nothing it already did.
      { t: 'hello', fromSeq: 'acked' }
    : {
        t: 'spawn',
        command: options.command,
        args: options.args,
        cwd,
        env: plainEnv(options.env),
        appSessionId: ctx.appSessionId,
        userId: ctx.userId,
        profile: ctx.profile
      };
  if (openChannel(ctx.reattach ? 'attach' : 'spawn', first) === null) return Promise.reject(notConnected(node));

  firstFrameTimer = setTimeout(() => {
    firstFrameTimer = null;
    refuse(`${node}'s warden did not start the session within ${FIRST_FRAME_TIMEOUT_MS / 1000} s`);
  }, FIRST_FRAME_TIMEOUT_MS);
  firstFrameTimer.unref();

  facade.attach(hostTransport(sendToHost));
  // Behind the `hello` the open carries: the warden writes that first, then the frames that follow it in order.
  if (ctx.reattach) writeReleaseBack(facade, hostId, ctx.reattach, node);
  return placed;
}
