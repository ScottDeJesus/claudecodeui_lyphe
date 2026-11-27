import type { RealtimeClientConnection } from '@/shared/types.js';

/**
 * Lanes a socket watches by key. A browser says which keyed thing it is looking at (`watch.start`,
 * `watch.stop`), and the lane's owner hears when a lane and key gain their first watcher (`first`)
 * and lose their last (`last`). So a server-side watch (a file tail, a vendor read) runs exactly
 * while someone looks, and its frames go only to the sockets that asked (`sockets`).
 *
 * Kept per socket. A socket that closes takes every watch it held with it (`drop`, called from the
 * gateway's close handler), so a tab that vanished without a `watch.stop` never holds a watch open.
 * A second `watch.start` from the same socket for the same key is the same watch: a reconnect's
 * re-send and a flushed outbox both produce one. Two views of one tab on the same key are counted in
 * the tab (`src/shared/hooks/useLaneWatch.ts`), which sends the stop only when the last one leaves.
 *
 * A lane nobody defined is ignored, and so is a key that is neither a short string nor null: the
 * frame comes from the browser, and an unknown lane must not grow these maps.
 */

/** What a watcher looks at inside a lane, or `null` for a lane with one subject. */
export type LaneWatchKey = string | null;

/** The owner's side of a lane: run when a key gains its first watcher and when it loses its last. */
export type LaneWatchHooks = {
  first?(key: LaneWatchKey): void;
  last?(key: LaneWatchKey): void;
};

/** The fields of a socket frame this service reads; everything else on it is the gateway's. */
export type LaneWatchFrame = { type: string; lane?: unknown; key?: unknown };

const START_TYPE = 'watch.start';
const STOP_TYPE = 'watch.stop';
/** The longest key a socket may name: keys are ids joined by colons, never prose. */
const MAX_KEY_LENGTH = 512;

const hooksByLane = new Map<string, LaneWatchHooks>();
const watchersByLane = new Map<string, Map<LaneWatchKey, Set<RealtimeClientConnection>>>();
const watchesBySocket = new Map<RealtimeClientConnection, Map<string, Set<LaneWatchKey>>>();

export const laneWatch = {
  /** Names a lane and the hooks its owner runs; defining it again replaces the hooks. */
  define(lane: string, hooks: LaneWatchHooks): void {
    hooksByLane.set(lane, hooks);
  },

  /** Handles a `watch.start` or `watch.stop` frame; `false` for any other type, which stays the gateway's. */
  handle(ws: RealtimeClientConnection, data: LaneWatchFrame): boolean {
    if (data.type !== START_TYPE && data.type !== STOP_TYPE) return false;
    if (typeof data.lane !== 'string' || !hooksByLane.has(data.lane)) return true;
    const key = readKey(data.key);
    if (key === undefined) return true;
    if (data.type === START_TYPE) startWatch(ws, data.lane, key);
    else stopWatch(ws, data.lane, key);
    return true;
  },

  /** Ends every watch the socket held; the gateway calls it when the socket closes. */
  drop(ws: RealtimeClientConnection): void {
    const watches = watchesBySocket.get(ws);
    if (!watches) return;
    for (const [lane, keys] of [...watches]) {
      for (const key of [...keys]) stopWatch(ws, lane, key);
    }
    watchesBySocket.delete(ws);
  },

  /** The sockets watching this lane and key now, for the owner's sends. */
  sockets(lane: string, key: LaneWatchKey): RealtimeClientConnection[] {
    return [...(watchersByLane.get(lane)?.get(key) ?? [])];
  },
};

/** The key as the browser sent it, or `undefined` when it is not one this service accepts. */
function readKey(value: unknown): LaneWatchKey | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_KEY_LENGTH) return undefined;
  return value;
}

function startWatch(ws: RealtimeClientConnection, lane: string, key: LaneWatchKey): void {
  let byKey = watchersByLane.get(lane);
  if (!byKey) {
    byKey = new Map();
    watchersByLane.set(lane, byKey);
  }
  let watchers = byKey.get(key);
  if (!watchers) {
    watchers = new Set();
    byKey.set(key, watchers);
  }
  if (watchers.has(ws)) return;
  watchers.add(ws);

  let watches = watchesBySocket.get(ws);
  if (!watches) {
    watches = new Map();
    watchesBySocket.set(ws, watches);
  }
  let keys = watches.get(lane);
  if (!keys) {
    keys = new Set();
    watches.set(lane, keys);
  }
  keys.add(key);

  if (watchers.size === 1) runHook(lane, key, 'first');
}

function stopWatch(ws: RealtimeClientConnection, lane: string, key: LaneWatchKey): void {
  const byKey = watchersByLane.get(lane);
  const watchers = byKey?.get(key);
  if (!byKey || !watchers || !watchers.delete(ws)) return;

  const watches = watchesBySocket.get(ws);
  const keys = watches?.get(lane);
  keys?.delete(key);
  if (keys?.size === 0) watches?.delete(lane);

  if (watchers.size > 0) return;
  byKey.delete(key);
  if (byKey.size === 0) watchersByLane.delete(lane);
  runHook(lane, key, 'last');
}

/** A hook that throws is said with its lane and key; the socket's other frames keep being served. */
function runHook(lane: string, key: LaneWatchKey, which: 'first' | 'last'): void {
  const hook = hooksByLane.get(lane)?.[which];
  if (!hook) return;
  try {
    hook(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[LaneWatch] ${which} of lane ${lane} key ${String(key)} failed: ${message}`);
  }
}
