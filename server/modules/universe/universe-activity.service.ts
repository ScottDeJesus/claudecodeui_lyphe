import type { UniverseActivityEvent, UniverseActivityInput, UniverseActivityRow } from '@/shared/types.js';

/**
 * The throttle between the two taps and the wire, and the only writer of `universe_activity` frames.
 *
 * Both taps push raw rows into one Map keyed `${node}|${kind}|${source}`, which accumulates a count
 * and keeps the newest `at`. Once per tick the map is drained into ONE frame — and NOTHING is
 * broadcast when it is empty, which is why this is not a `createPolledLane`. That lane's contract is
 * a picture that changed, and it would have to send the estate's current sighting on every tick;
 * here the honest picture of a quiet estate is no picture, and an empty frame ten times a second is
 * 864,000 writes a day that say only "still nothing".
 *
 * Frames are capped, and the cap is LOUD: the rows above it are counted into `dropped` rather than
 * quietly left out, so a burst is visibly lossy instead of appearing complete.
 */

export type ActivityCoalescerDependencies = {
  /** Puts one frame on every open socket. Called only when there is a row to send. */
  broadcast: (frame: UniverseActivityEvent) => void;
  /** The held map's id, read at flush time — a frame has to name the map its node indices are from. */
  mapId: () => string;
  /** How often the map is drained. A tenth of a second is under the eye's threshold and over a CDN's. */
  flushMs?: number;
  /** The most rows one frame may carry. The rest are counted into the frame's `dropped`. */
  maxRows?: number;
};

export type ActivityCoalescer = {
  /** Adds one raw event. Never throws: a malformed row's fields are the tap's business, not this. */
  push(row: UniverseActivityInput): void;
  start(): void;
  stop(): void;
};

const DEFAULT_FLUSH_MS = 100;
const DEFAULT_MAX_ROWS = 200;

/** Consumed by both taps (which push into it) and by `universe.module.ts` (which starts and stops it). */
export function createActivityCoalescer(dependencies: ActivityCoalescerDependencies): ActivityCoalescer {
  const flushMs = dependencies.flushMs ?? DEFAULT_FLUSH_MS;
  const maxRows = dependencies.maxRows ?? DEFAULT_MAX_ROWS;

  /** The window's rows so far, keyed so a thousand identical events are one row and one count. */
  const pending = new Map<string, UniverseActivityRow>();

  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    // Silence is the correct wire state for an estate doing nothing: the client learns liveness
    // from the map lane's frame, never from a heartbeat here.
    if (pending.size === 0) return;

    // Highest count first, so a cap trims the long tail of one-off events and never the storm.
    const rows = [...pending.values()].sort((left, right) => right.count - left.count);
    const sent = rows.slice(0, maxRows);
    pending.clear();

    dependencies.broadcast({
      kind: 'universe_activity',
      mapId: dependencies.mapId(),
      rows: sent,
      dropped: rows.length - sent.length,
      at: Date.now(),
    });
  };

  return {
    push: (row) => {
      const key = `${row.node}|${row.kind}|${row.source}`;
      const held = pending.get(key);
      if (held === undefined) {
        pending.set(key, { ...row, count: 1 });
        return;
      }
      held.count += 1;
      held.at = Math.max(held.at, row.at);
      // The newest session behind a row is the one the client can point at; a row whose source is a
      // systemd unit never carries one.
      if (row.session !== undefined) held.session = row.session;
    },

    start: () => {
      if (timer !== null) return;
      timer = setInterval(flush, flushMs);
      // Not a reason for this process to stay alive: it exists to carry activity, and a server with
      // nothing else to do has no activity to carry.
      timer.unref();
    },

    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      // The window is dropped unflushed: this server is going away, and a frame nobody can receive
      // is a frame that was never worth sending.
      pending.clear();
    },
  };
}
