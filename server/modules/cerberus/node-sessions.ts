import crypto from 'node:crypto';
import fs from 'node:fs';

import { cerberusNodesDb } from '@/modules/database/index.js';
import type {
  CerberusHostFrame,
  CerberusNodeHost,
  CerberusSessionOpenBody,
} from '@/shared/cerberus-types.js';

import { wardenLinks, type CerberusWardenLink } from './warden-links.js';

/**
 * Center's relay to the sessions a node's warden hosts: the channels a session host drives its
 * remote hosts through, the list of what runs there, and the word that a node's link came up.
 *
 * A CHANNEL is one holder of one remote host. `openChannel` sends `session.open`; the host's frames
 * arrive as `session.frame` and go to the holder's `frame` handler, the holder's own go down through
 * `send`, and `detach` lets go without ending the host (the warden closes its socket and never
 * writes end-of-input; the CLI keeps running for the next client). A channel ends in one of four
 * ways: the holder detaches; the warden says `session.closed`; the host's `exit` frame is delivered
 * (the warden drops its side after it, so the relay forgets its own: no `closed` follows, and a
 * later `send` answers false); or the LINK it was opened on goes away. A link replaced by a newer
 * one counts as gone — the warden that redialled ended every channel socket of the old link — so a
 * channel remembers the link object it was opened on and is closed with `closed('link lost')` when
 * `wardenLinks` holds any other.
 *
 * ORDER OF A LINK CHANGE. Channels and pending lists of the lost link are closed first, then
 * `onLinkUp` listeners hear of the new one — all one microtask AFTER the change. `attach` runs
 * inside the link's `hello` handling, ahead of the `welcome` it sends in the same synchronous run,
 * and a warden drops what it answers before it has seen `welcome`: a listener or a `closed` handler
 * that asked something at once would have its answer thrown away. After a REPLACEMENT the node is
 * already linked inside `closed('link lost')`: a holder that waits for `onLinkUp` to re-open must
 * subscribe before that handler returns, or ask `isLinked` and re-open at once.
 *
 * A LINK THAT WAS UP BEFORE THE SUBSCRIPTION is not "coming up", so `onLinkUp` does not fire for it:
 * on a restart the wardens redial within seconds, usually before the session host subscribes.
 * `onLinkUp(listener, { replay: true })` tells the listener once of every node already linked, which
 * is the recipe for a subscriber that must act on every link, old and new.
 *
 * NOTHING HERE RETRIES OR REPLAYS FRAMES: the host's journal and acked cursor are the replay (see
 * NODE SESSIONS in `cerberus-types.ts`). The frames are registered with `wardenLinks.registerHandler`
 * and link changes come from `wardenLinks.onChange`, both armed by the first call into
 * `nodeSessions`; a warden only speaks session frames in answer to one center sent, so none can
 * arrive before it. Everything is memory; the store is read for one thing, a node's `machine_id`.
 */

/** How long `listHosts` waits for the warden's `sessions.listed` before rejecting. */
const LIST_TIMEOUT_MS = 10_000;

/** What a channel's holder hands `openChannel` to receive the host's side of the conversation. */
type ChannelHandlers = {
  /** One host frame, verbatim from the host's socket. */
  frame(frame: CerberusHostFrame): void;
  /** The channel is over without the holder asking: the warden's reason, or `link lost`. No frame follows. */
  closed(reason: string): void;
};

/** What a holder says it wants: `session.open` without the channel id center picks. */
type ChannelOpen = Pick<CerberusSessionOpenBody, 'op' | 'hostId' | 'cwd' | 'frame'>;

/** A channel's holder side: frames down to the host, and the deliberate let-go. */
type NodeChannel = {
  /** Puts one client frame on the link; false when the channel is over or the link took no frame. */
  send(frame: CerberusHostFrame): boolean;
  /** Lets go of the host (`session.detach`): it keeps running. Idempotent; `closed` is not called for it. */
  detach(): void;
};

/** A link-up subscriber; it may be async, and a throw or rejection is logged here, never raised. */
type LinkUpListener = (node: string) => void | Promise<void>;

/** A subscriber to a warden's `sessions.changed`, run as a link-up listener is. */
type HostsChangedListener = (node: string) => void | Promise<void>;

type OpenChannel = { node: string; link: CerberusWardenLink; handlers: ChannelHandlers };

type PendingList = {
  node: string;
  link: CerberusWardenLink;
  timer: NodeJS.Timeout;
  resolve(hosts: CerberusNodeHost[]): void;
  reject(error: Error): void;
};

const channels = new Map<string, OpenChannel>();
const pendingLists = new Map<string, PendingList>();
const lastListedByNode = new Map<string, CerberusNodeHost[]>();
const linkUpListeners = new Set<LinkUpListener>();
const hostsChangedListeners = new Set<HostsChangedListener>();
/** The link object each node last had, so that an attach is told from a node merely entering or leaving silence. */
const linkSeenByNode = new Map<string, CerberusWardenLink>();
let armed = false;
/** `undefined` until the file has been read once; `null` when this machine has no id to compare. */
let localMachineId: string | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs a holder's handler so that a throw or a rejection costs the link nothing; both are logged with the node. */
function runHolderHandler(node: string, what: string, call: () => void | Promise<void>): void {
  const logFailure = (error: unknown): void => {
    console.error(`[Cerberus] a session ${what} handler threw for node ${node}: ${describe(error)}`);
  };
  try {
    Promise.resolve(call()).catch(logFailure);
  } catch (error) {
    logFailure(error);
  }
}

function newId(taken: (id: string) => boolean): string {
  let id = crypto.randomBytes(6).toString('hex');
  while (taken(id)) id = crypto.randomBytes(6).toString('hex');
  return id;
}

/** The channel a warden's frame is about: only one center opened on THAT node — a warden speaks for its own channels alone. */
function channelOf(node: string, chan: unknown): OpenChannel | null {
  const channel = typeof chan === 'string' ? channels.get(chan) : undefined;
  return channel && channel.node === node ? channel : null;
}

function onSessionFrame(node: string, body: unknown): void {
  if (!isRecord(body)) return;
  const channel = channelOf(node, body.chan);
  const frame = body.frame;
  // An unknown channel is a frame that outran a detach or a closed: dropping it is the right answer.
  if (!channel || !isRecord(frame) || typeof frame.t !== 'string') return;
  runHolderHandler(node, 'frame', () => channel.handlers.frame(frame as CerberusHostFrame));
  // `exit` is the last thing a host says and the warden drops its side of the channel after it: forgetting ours
  // keeps the holder's handlers from being held (and told `link lost`) until some later link goes.
  if (frame.t === 'exit' && channels.get(body.chan as string) === channel) channels.delete(body.chan as string);
}

function onSessionClosed(node: string, body: unknown): void {
  if (!isRecord(body)) return;
  const channel = channelOf(node, body.chan);
  if (!channel) return;
  channels.delete(body.chan as string);
  const reason = typeof body.reason === 'string' && body.reason !== '' ? body.reason : 'the host closed the channel';
  runHolderHandler(node, 'closed', () => channel.handlers.closed(reason));
}

/**
 * One listed host, made into exactly a `CerberusNodeHost`: a field of the wrong type becomes its
 * empty value, so a consumer walking the cache never meets `undefined` or a string where a list is
 * expected. Null when the two fields everything keys on — `hostId`, `appSessionId` — are not strings.
 */
function readNodeHost(value: unknown): CerberusNodeHost | null {
  if (!isRecord(value) || typeof value.hostId !== 'string' || typeof value.appSessionId !== 'string') return null;
  const text = (field: unknown): string | null => (typeof field === 'string' ? field : null);
  const finite = (field: unknown): number | null => (typeof field === 'number' && Number.isFinite(field) ? field : null);
  return {
    hostId: value.hostId,
    appSessionId: value.appSessionId,
    userId: typeof value.userId === 'string' || typeof value.userId === 'number' ? value.userId : null,
    cwd: text(value.cwd),
    startedAt: finite(value.startedAt) ?? 0,
    turnCompleteSent: value.turnCompleteSent === true,
    heldForBackgroundWork: value.heldForBackgroundWork === true,
    deferredTools: Array.isArray(value.deferredTools) ? value.deferredTools.filter((tool) => typeof tool === 'string') : [],
    liveTasks: Array.isArray(value.liveTasks) ? value.liveTasks.filter((task) => typeof task === 'string') : [],
    profile: isRecord(value.profile) ? value.profile : null,
    cliVersion: text(value.cliVersion),
    cliPid: Number.isSafeInteger(value.cliPid) ? (value.cliPid as number) : null,
    lastTurnFinishedAt: finite(value.lastTurnFinishedAt),
  };
}

function onSessionsListed(node: string, body: unknown): void {
  if (!isRecord(body) || typeof body.re !== 'string') return;
  const pending = pendingLists.get(body.re);
  if (!pending || pending.node !== node) return;
  clearTimeout(pending.timer);
  pendingLists.delete(body.re);
  if (!Array.isArray(body.hosts)) {
    pending.reject(new Error(`node ${node} answered sessions.list without a hosts list`));
    return;
  }
  const hosts = body.hosts.map(readNodeHost).filter((host): host is CerberusNodeHost => host !== null);
  if (hosts.length !== body.hosts.length) {
    console.warn(`[Cerberus] node ${node} listed ${body.hosts.length - hosts.length} host(s) this center could not read; skipped`);
  }
  // The cache keeps its own hosts; every caller is handed copies (`structuredClone`), so neither reordering
  // what it was given nor setting a field on a host changes what a later reader of `lastListed` sees.
  lastListedByNode.set(node, hosts);
  pending.resolve(structuredClone(hosts));
}

/** Ends everything that was riding a link `wardenLinks` no longer holds for the node. */
function endWorkOnLostLinks(node: string, current: CerberusWardenLink | null): void {
  for (const [chan, channel] of [...channels]) {
    if (channel.node !== node || channel.link === current) continue;
    channels.delete(chan);
    runHolderHandler(node, 'closed', () => channel.handlers.closed('link lost'));
  }
  for (const [id, pending] of [...pendingLists]) {
    if (pending.node !== node || pending.link === current) continue;
    clearTimeout(pending.timer);
    pendingLists.delete(id);
    pending.reject(new Error(`the link of node ${node} was lost before it answered sessions.list`));
  }
}

/** Judges where the node's link stands NOW — a change may have been overtaken by the time this runs — and tells whoever it concerns. */
function settleLinkChange(node: string): void {
  try {
    const current = wardenLinks.get(node);
    endWorkOnLostLinks(node, current);
    if (!current) {
      linkSeenByNode.delete(node);
      return;
    }
    // A silence change fires onChange with the same link; only a link not seen before is a link coming up.
    if (linkSeenByNode.get(node) === current) return;
    linkSeenByNode.set(node, current);
    for (const listener of [...linkUpListeners]) runHolderHandler(node, 'link-up', () => listener(node));
  } catch (error) {
    console.error(`[Cerberus] settling a link change of node ${node} failed: ${describe(error)}`);
  }
}

/** A warden's word that the retire it was asked for is over: whoever keeps the node's list true lists it again. */
function onSessionsChanged(node: string, body: unknown): void {
  if (!isRecord(body)) return;
  for (const listener of [...hostsChangedListeners]) runHolderHandler(node, 'hosts-changed', () => listener(node));
}

const FRAME_HANDLERS = {
  'session.frame': onSessionFrame,
  'session.closed': onSessionClosed,
  'sessions.listed': onSessionsListed,
  'sessions.changed': onSessionsChanged,
};

function armOnce(): void {
  if (armed) return;
  // All or nothing, and `armed` last: a frame type another plan already holds is a conflict every call
  // hears of, never one call's throw followed by a relay that quietly lacks half its handlers.
  const taken = Object.keys(FRAME_HANDLERS).filter((type) => wardenLinks.handlerFor(type) !== undefined);
  if (taken.length > 0) throw new Error(`The node-session relay cannot arm: Cerberus frames of type ${taken.join(', ')} already have a handler.`);
  // Nodes already linked when this arms are not "coming up": note their links so the next change is judged fairly.
  for (const node of wardenLinks.states().keys()) {
    const link = wardenLinks.get(node);
    if (link) linkSeenByNode.set(node, link);
  }
  for (const [type, handler] of Object.entries(FRAME_HANDLERS)) wardenLinks.registerHandler(type, handler);
  // One microtask late, so that what the change sets off leaves AFTER `welcome` (see the header).
  wardenLinks.onChange((node) => queueMicrotask(() => settleLinkChange(node)));
  armed = true;
}

/** The first line of this machine's `/etc/machine-id`, read once; null when there is none (a container, another OS). */
function thisMachineId(): string | null {
  if (localMachineId !== undefined) return localMachineId;
  try {
    localMachineId = fs.readFileSync('/etc/machine-id', 'utf8').split('\n')[0].trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[Cerberus] could not read /etc/machine-id, so no node is co-located: ${describe(error)}`);
    }
    localMachineId = null;
  }
  return localMachineId;
}

// nodeSessions: used, through `@/modules/cerberus/index.js`, by the session host
// (`session-host/node-transport.ts`, `node-readopt.ts`, `readopt-host.ts`, `colocated-hosts.ts`,
// `refused-hosts.ts`) and the projects module (`services/project-node.service.ts`), and, by direct
// import, by this module's `read-model/overview.ts`, to run a project's Claude sessions on a node's
// machine: `openChannel` holds a host, `listHosts` / `retireHost` adopt and tidy what runs there,
// `isColocated` tells a node on this machine from a remote one, `onLinkUp` re-adopts when a warden
// reconnects, and `lastListed` feeds the node card's session count.
export const nodeSessions = {
  /** Whether a warden socket is open for the node now. */
  isLinked(node: string): boolean {
    return wardenLinks.isLinked(node);
  },

  /**
   * Whether the node runs on THIS machine: its stored `machine_id` (from its last `hello`'s
   * `facts.machineId`) equals the first line of this machine's `/etc/machine-id`. Two machines that
   * both lack an id are not co-located: an absent id proves nothing.
   */
  isColocated(node: string): boolean {
    const local = thisMachineId();
    return local !== null && cerberusNodesDb.get(node)?.machine_id === local;
  },

  /**
   * Opens a channel to a host on the node. Answers null when the node's link is not usable — nothing
   * was opened and nothing will be called. Otherwise `session.open` is on its way and the holder's
   * handlers are live: `frame` for every host frame, `closed(reason)` once if the channel ends
   * without the holder detaching. A refused open (no session server, the host gone) arrives as
   * `closed`, not as a null.
   */
  openChannel(node: string, open: ChannelOpen, handlers: ChannelHandlers): NodeChannel | null {
    armOnce();
    const link = wardenLinks.get(node);
    if (!link) return null;
    const chan = newId((id) => channels.has(id));
    const channel: OpenChannel = { node, link, handlers };
    channels.set(chan, channel);
    const body: CerberusSessionOpenBody = { chan, op: open.op, hostId: open.hostId, cwd: open.cwd, frame: open.frame };
    if (!wardenLinks.send(node, 'session.open', body)) {
      channels.delete(chan);
      return null;
    }
    return {
      send: (frame) => channels.get(chan) === channel && wardenLinks.send(node, 'session.frame', { chan, frame }),
      detach: () => {
        if (channels.get(chan) !== channel) return;
        channels.delete(chan);
        wardenLinks.send(node, 'session.detach', { chan });
      },
    };
  },

  /**
   * The hosts running on the node, asked of its warden. Rejects when the node is not linked, when
   * its link is lost before the answer, or when no `sessions.listed` comes within 10 seconds. Every
   * answer is kept for `lastListed`.
   */
  listHosts(node: string): Promise<CerberusNodeHost[]> {
    armOnce();
    const link = wardenLinks.get(node);
    if (!link) return Promise.reject(new Error(`node ${node} is not connected`));
    return new Promise<CerberusNodeHost[]>((resolve, reject) => {
      const id = newId((candidate) => pendingLists.has(candidate));
      const timer = setTimeout(() => {
        pendingLists.delete(id);
        reject(new Error(`node ${node} did not answer sessions.list within ${LIST_TIMEOUT_MS / 1000} s`));
      }, LIST_TIMEOUT_MS);
      timer.unref();
      pendingLists.set(id, { node, link, timer, resolve, reject });
      // The request's own envelope id is the answer's `re`, so it is named here rather than picked by the link.
      if (!wardenLinks.send(node, 'sessions.list', {}, id)) {
        clearTimeout(timer);
        pendingLists.delete(id);
        reject(new Error(`could not put sessions.list on the link of node ${node}`));
      }
    });
  },

  /** The hosts the node last listed; empty before its first answer. Copies, hosts included: the cache is not the caller's to change. */
  lastListed(node: string): CerberusNodeHost[] {
    return structuredClone(lastListedByNode.get(node) ?? []);
  },

  /** Asks the node's warden to end a host. Answers whether the request went out; the warden answers later with `sessions.changed` (`onHostsChanged`). */
  retireHost(node: string, hostId: string): boolean {
    armOnce();
    const sent = wardenLinks.send(node, 'session.retire', { hostId });
    if (!sent) console.warn(`[Cerberus] could not ask node ${node} to retire host ${hostId}: its link is not usable`);
    return sent;
  },

  /**
   * Subscribes to a node's warden saying that a retire it was asked for is over (`sessions.changed`): the
   * list last read of that node may be stale, so the listener lists it again. Answers the unsubscribe.
   * A warden older than the frame never says it. consumer: the session host's node re-adoption (`node-readopt.ts`)
   */
  onHostsChanged(listener: HostsChangedListener): () => void {
    armOnce();
    hostsChangedListeners.add(listener);
    return () => hostsChangedListeners.delete(listener);
  },

  /**
   * Subscribes to a node's link coming up (a link not seen before: a first connect, a reconnect, a
   * replacement). Answers the unsubscribe. A link that was up BEFORE this call is not told to the
   * listener unless `replay` is set, which tells it once, a microtask later, of each node already
   * linked and announced — the way for a subscriber that must act on every link, as the session
   * host's re-adoption must on a restart. A link attached but not yet announced reaches the listener
   * by its own announcement, replay or not.
   */
  onLinkUp(listener: LinkUpListener, options: { replay?: boolean } = {}): () => void {
    armOnce();
    linkUpListeners.add(listener);
    if (options.replay) {
      const announced = [...linkSeenByNode].filter(([node, link]) => wardenLinks.get(node) === link);
      queueMicrotask(() => {
        for (const [node, link] of announced) {
          if (wardenLinks.get(node) === link && linkUpListeners.has(listener)) runHolderHandler(node, 'link-up', () => listener(node));
        }
      });
    }
    return () => linkUpListeners.delete(listener);
  },
};
