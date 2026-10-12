import { cerberusNodesDb } from '@/modules/database/index.js';
import type { CerberusEnvelope, CerberusHelloBody, CerberusLinkState } from '@/shared/cerberus-types.js';

/**
 * The registry every warden's link joins: who is connected, when each node was last heard, and the
 * handlers that frames of each type are routed to.
 *
 * TWO FACTS, KEPT APART. A node's SOCKET (is a link attached) and a node's SILENCE (has anything
 * been heard from it lately) are different questions with different answers, and the screen needs
 * both. A node is SILENT once `now − lastHeardAt > 90 000`, whether or not its socket is still
 * open — a half-open connection that carries nothing is silent — and `silentSince` is
 * `lastHeardAt + 90 000`, the moment the 90 seconds ran out rather than the moment anyone noticed.
 * Any frame counts as hearing the node, a heartbeat or a result alike.
 *
 * BOOT. `seedFromStore()` reads every enrolled node's stored `last_heartbeat_at` as its
 * `lastHeardAt`. A node unheard since before this boot therefore reads silent at once, and the
 * one-second gap of a handover never does: the stored stamp is at most a minute old, nowhere near
 * 90 seconds. A node that has never sent a heartbeat has no `lastHeardAt` and is silent until it is.
 *
 * ROUTING. `registerHandler` is the one door later frames come in by — `run.*`, `diag.*`,
 * `update.*`, `session.*` — each plan registers its own types and the link looks them up with
 * `handlerFor`; this file knows no frame but through that table.
 *
 * Everything here is memory. The store is touched once, by `seedFromStore`.
 *
 * HELLO. A warden's `hello` says what it still holds across a reconnect (`active`), which no frame
 * says again, so `onHello` hears it once per connect — after the link is attached, so a listener that
 * answers by sending reaches the warden — and the runs service reconciles the runs it counts live.
 *
 * Consumers: `warden-link.ts` (one link per socket: `attach`, `detach`, `heard`, `handlerFor`,
 * `announceHello`), `warden-gateway.ts` (nothing but through that link), the module's `start()`
 * (`seedFromStore`), `definitions.service.ts` (`send` of a `checks.set`), the read model (`states`),
 * and every later plan that talks to a warden (`send`, `registerHandler`, `onChange`, `onHello`).
 */

/** The silence threshold: a node unheard for longer than this is silent. */
const SILENCE_AFTER_MS = 90_000;

/** How often the registry looks for a node that has just run out its 90 seconds. */
const SILENCE_CHECK_INTERVAL_MS = 5000;

/** The close code `attach` gives an older link of the same node: a newer one has taken its place. */
const REPLACED_LINK_CLOSE_CODE = 4000;

/**
 * One open warden socket, as the registry sees it. `send` answers false when the frame could not
 * be put on the socket; `id` is the envelope's id when the caller needs to name it (a request whose
 * answer carries it back, as `sessions.listed` carries `re`), else the link picks one.
 * `version` and `clockOffsetMs` are the link's own to keep current — the
 * warden's version from its `hello`, and the median of the last five `receivedAt − env.at`.
 * Consumers: `warden-link.ts` builds it; every other reader goes through `wardenLinks`.
 */
export type CerberusWardenLink = {
  node: string;
  send(type: string, body: unknown, id?: string): boolean;
  close(code: number, reason: string): void;
  version: string | null;
  clockOffsetMs: number | null;
};

/**
 * What a registered handler receives: the node the frame came from, the envelope's `body`, and the
 * envelope itself (for its `id`, `seq` and `at`). It may be async; a throw or a rejection is the
 * link's to log, never the registry's.
 * Consumers: every plan that registers a frame type.
 */
export type CerberusFrameHandler = (node: string, body: unknown, env: CerberusEnvelope<unknown>) => void | Promise<void>;

/** Called with the node and its state whenever a link attaches or detaches or a node enters or leaves silence. */
type LinkChangeListener = (node: string, state: CerberusLinkState) => void;

/**
 * What a connecting warden's `hello` said that a listener may act on, already checked for shape.
 * `startedAt` is when the warden PROCESS started, on its own clock, and `activeRuns` the ids of the fix
 * runs whose child it still holds; both are null when the warden did not say (a build older than the
 * runner), and a listener must then conclude nothing from them. `owedRuns` is the ids of runs that are
 * over but whose frames still wait on the warden's outbox; null when the warden does not report them
 * (a build older than that list), which a listener must read as "this hello does not account for what
 * is still owed". `activeDiags` is the ids of the diagnoses the warden holds open, null when it does not
 * say (a build older than diagnoses). `catalogVersion` is the set it acked. `update` is how the warden
 * says an update ended (`CerberusHelloBody.update`), null when the hello names none.
 * Consumers: `warden-link.ts` builds it; `run-reconcile.ts`, `update-driver.ts` and the diagnosis service read it.
 */
export type CerberusHelloReport = {
  version: string;
  startedAt: number | null;
  activeRuns: string[] | null;
  owedRuns: string[] | null;
  activeDiags: string[] | null;
  catalogVersion: number | null;
  update: NonNullable<CerberusHelloBody['update']> | null;
};

/** Called with the node and what its hello said, after the link carrying it is attached. */
type HelloListener = (node: string, hello: CerberusHelloReport) => void;

type NodeRecord = {
  link: CerberusWardenLink | null;
  lastHeardAt: number | null;
  /** What the last link reported, kept after it is gone: the node's version does not vanish with its socket. */
  lastVersion: string | null;
  lastClockOffsetMs: number | null;
  /** Whether the last look found the node silent — what makes entering and leaving silence an event. */
  wasSilent: boolean;
};

const records = new Map<string, NodeRecord>();
const handlers = new Map<string, CerberusFrameHandler>();
const listeners = new Set<LinkChangeListener>();
const helloListeners = new Set<HelloListener>();
let silenceTimer: NodeJS.Timeout | null = null;

/** A node never heard is silent; so is one unheard for more than 90 seconds. */
function isSilent(record: NodeRecord, now: number): boolean {
  return record.lastHeardAt === null || now - record.lastHeardAt > SILENCE_AFTER_MS;
}

function recordFor(node: string): NodeRecord {
  let record = records.get(node);
  if (!record) {
    // A node nobody has heard is silent: its first frame is the event that leaves silence.
    record = { link: null, lastHeardAt: null, lastVersion: null, lastClockOffsetMs: null, wasSilent: true };
    records.set(node, record);
  }
  return record;
}

function stateOf(record: NodeRecord, now: number): CerberusLinkState {
  const silent = isSilent(record, now);
  return {
    linked: record.link !== null,
    lastHeardAt: record.lastHeardAt,
    silentSince: silent && record.lastHeardAt !== null ? record.lastHeardAt + SILENCE_AFTER_MS : null,
    clockOffsetMs: record.link?.clockOffsetMs ?? record.lastClockOffsetMs,
    version: record.link?.version ?? record.lastVersion,
  };
}

function notifyChanged(node: string, record: NodeRecord): void {
  const state = stateOf(record, Date.now());
  for (const listener of listeners) {
    try {
      listener(node, state);
    } catch (error) {
      console.error(`[Cerberus] a link-change listener threw for node ${node}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Looks at one node's silence and tells the listeners if it moved since the last look. */
function refreshSilence(node: string, record: NodeRecord, now: number): void {
  const silent = isSilent(record, now);
  if (silent === record.wasSilent) return;
  record.wasSilent = silent;
  notifyChanged(node, record);
}

// The timer is started by the first thing that gives it work and unref'd: it is a convenience of a
// running server, never a reason for a process to stay up.
function ensureSilenceTimer(): void {
  if (silenceTimer) return;
  silenceTimer = setInterval(() => {
    const now = Date.now();
    for (const [node, record] of records) refreshSilence(node, record, now);
  }, SILENCE_CHECK_INTERVAL_MS);
  silenceTimer.unref();
}

export const wardenLinks = {
  /** The node's open link, or `null`. Consumers: later plans that need the socket itself. */
  get(node: string): CerberusWardenLink | null {
    return records.get(node)?.link ?? null;
  },

  /** Whether a socket is open for the node now — not whether the node has been heard lately. */
  isLinked(node: string): boolean {
    return records.get(node)?.link != null;
  },

  /**
   * Center's clock minus the node's, in ms: add it to a warden's time to read it on center's clock. The
   * open link's median of its last five heartbeats, else what the last link reported; 0 for a node
   * never heard (no correction is better than a guessed one).
   */
  clockOffsetMs(node: string): number {
    const record = records.get(node);
    return record?.link?.clockOffsetMs ?? record?.lastClockOffsetMs ?? 0;
  },

  /**
   * Puts one frame on the node's link. Answers false when the node has no link, or when the link
   * could not take the frame — the caller decides whether that matters (a `checks.set` does not:
   * the warden's next `hello` asks for it again). A link whose `send` throws answers false and is
   * logged: callers send AFTER their own write committed, and a throw from a socket must not turn
   * a committed write into a reported failure. `id` names the envelope for a caller whose request
   * is answered by a frame carrying it back.
   */
  send(node: string, type: string, body: unknown, id?: string): boolean {
    const link = records.get(node)?.link;
    if (!link) return false;
    try {
      return link.send(type, body, id);
    } catch (error) {
      console.error(`[Cerberus] the link of node ${node} threw sending a "${type}" frame: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  },

  /** Subscribes to link changes; answers the function that unsubscribes. */
  onChange(listener: LinkChangeListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Subscribes to every connecting warden's `hello`; answers the function that unsubscribes. */
  onHello(listener: HelloListener): () => void {
    helloListeners.add(listener);
    return () => helloListeners.delete(listener);
  },

  /**
   * Tells the `onHello` listeners what a warden's hello said. The link calls it once per connect, after
   * `attach`. A listener that throws is logged and the rest still hear: a hello is not undone by one
   * listener's fault.
   */
  announceHello(node: string, hello: CerberusHelloReport): void {
    for (const listener of helloListeners) {
      try {
        listener(node, hello);
      } catch (error) {
        console.error(`[Cerberus] a hello listener threw for node ${node}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  },

  /**
   * Registers the handler for one frame type. A second registration of the same type throws: two
   * plans claiming one frame is a mistake to hear about at boot, never one handler quietly
   * replacing another.
   */
  registerHandler(type: string, handler: CerberusFrameHandler): void {
    if (handlers.has(type)) throw new Error(`A handler for Cerberus frames of type "${type}" is already registered.`);
    handlers.set(type, handler);
  },

  /** The handler for a frame type, or `undefined` — the link logs an unknown type once and moves on. */
  handlerFor(type: string): CerberusFrameHandler | undefined {
    return handlers.get(type);
  },

  /** Every node the registry knows: socket open, last heard, silent since, clock offset, version. */
  states(): Map<string, CerberusLinkState> {
    const now = Date.now();
    const states = new Map<string, CerberusLinkState>();
    for (const [node, record] of records) states.set(node, stateOf(record, now));
    return states;
  },

  /**
   * Joins a link to the registry. An older link of the same node is closed with code 4000, "replaced
   * by a newer link": a warden that reconnects must not leave its half-dead predecessor routing
   * frames beside it. A predecessor whose `close` throws is logged and left; the new link is
   * already in place and the listeners are told either way.
   */
  attach(link: CerberusWardenLink): void {
    ensureSilenceTimer();
    const record = recordFor(link.node);
    const older = record.link;
    record.link = link;
    if (older && older !== link) {
      try {
        older.close(REPLACED_LINK_CLOSE_CODE, 'replaced by a newer link');
      } catch (error) {
        console.error(`[Cerberus] the replaced link of node ${link.node} threw on close: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    notifyChanged(link.node, record);
  },

  /**
   * Removes a link when its socket closes. Does nothing when the node's current link is another —
   * the replaced link's own close lands here after the newer one attached, and must not unseat it.
   * What the link last knew of the node's version and clock outlives it.
   */
  detach(link: CerberusWardenLink): void {
    const record = records.get(link.node);
    if (!record || record.link !== link) return;
    record.lastVersion = link.version ?? record.lastVersion;
    record.lastClockOffsetMs = link.clockOffsetMs ?? record.lastClockOffsetMs;
    record.link = null;
    notifyChanged(link.node, record);
  },

  /**
   * Notes that a frame of any kind arrived from the node at `at` (epoch ms). The stamp only moves
   * forward. When this ends the node's silence the listeners hear of it now, not at the next tick.
   */
  heard(node: string, at: number): void {
    ensureSilenceTimer();
    const record = recordFor(node);
    if (record.lastHeardAt === null || at > record.lastHeardAt) record.lastHeardAt = at;
    refreshSilence(node, record, Date.now());
  },

  /**
   * Makes every enrolled node known, with its stored last heartbeat as the time it was last heard.
   * Idempotent: a node already heard since (or linked) keeps the later of the two stamps.
   */
  seedFromStore(): void {
    ensureSilenceTimer();
    const now = Date.now();
    for (const row of cerberusNodesDb.list()) {
      const record = recordFor(row.id);
      if (row.last_heartbeat_at !== null && (record.lastHeardAt === null || row.last_heartbeat_at > record.lastHeardAt)) {
        record.lastHeardAt = row.last_heartbeat_at;
      }
      // Seeding is a start of knowledge, not an event: nothing is told that a node "became" silent.
      record.wasSilent = isSilent(record, now);
    }
  },
};
