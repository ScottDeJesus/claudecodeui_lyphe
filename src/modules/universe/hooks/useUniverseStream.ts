import * as React from 'react';

import { getKnownMapId, setKnownMapId } from '@/modules/universe/hooks/useUniverseMap';
import { isFreshActivityFrame } from '@/modules/universe/utils/universeFrames';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ServerEvent, UniverseActivityRow } from '@/shared/types';

/**
 * THE ESTATE'S ACTIVITY, READ ONCE FOR TWO CONSUMERS THAT WANT OPPOSITE THINGS FROM IT.
 *
 * The canvas must see every row — the tap coalesces and flushes up to ten times a second — and must
 * re-render nothing while it does; the chrome beside it wants a summary and may re-render, but only
 * about once a second. This hook is where that is decided, and the decision is that NOTHING THAT
 * MOVES PER FRAME IS REACT STATE:
 *
 *   - The ring of the newest rows and the listeners that consume raw rows live in refs, so a frame's
 *     arrival is a function call: the canvas is handed its rows synchronously and React is not
 *     consulted. `subscribeRows` is the canvas's door onto that path, and `onRows` its shorthand.
 *   - The only state the hook owns is the 1 Hz SNAPSHOT (`recentRows`, `rate`, `countsFor`), rebuilt
 *     by one `setState` on a timer tick. Put the ring in state instead and a busy second re-renders
 *     the panel and every child under it ten times, handing the canvas fresh props at the same rate
 *     — the cost this hook exists to remove.
 *
 * The ring is CAPPED at `RING_ROWS`: a tab left open overnight holds two hundred rows and nothing
 * more. Frames are admitted only through `isFreshActivityFrame`, the one freshness rule the bus feed
 * also asks, and a `universe_map` frame is not a row at all — it announces which estate the next
 * rows describe, and goes to the map's own store.
 */

/** How many rows the ring keeps. The cap is the whole memory story: a tab left open holds these and nothing else. */
const RING_ROWS = 200;

/** How many of them the 1 Hz snapshot hands the chrome — the newest, which is what a feed shows. Its
 *  one reader draws them in a box this size, so the budget lives here rather than in two places. */
export const FEED_ROWS = 50;

/** The window the rate averages over. */
const RATE_WINDOW_MS = 10_000;

/** How often the React-visible values are recomputed. The canvas is not on this clock. */
const SNAPSHOT_MS = 1000;

const RATE_WINDOW_S = RATE_WINDOW_MS / 1000;

/** One node's activity: the raw events it collected, split by kind. */
export type UniverseCounts = { edits: number; execs: number };

/** Shared by every node with nothing to report, so `countsFor` allocates nothing to answer "none". */
const NO_COUNTS: UniverseCounts = { edits: 0, execs: 0 };

/** One tick's reading of the ring: the newest rows, the rate they amount to, and the per-node totals. */
type UniverseSnapshot = {
  recentRows: UniverseActivityRow[];
  /** Raw events per second over the last ten seconds, as far back as the ring still reaches. */
  rate: number;
  counts: Map<number, UniverseCounts>;
};

export type UniverseStreamOptions = {
  /** The canvas's callback: every accepted frame's rows, the instant they land. Held in a ref, so a fresh closure per render never re-registers the socket. */
  onRows?: (rows: UniverseActivityRow[]) => void;
};

export type UniverseStream = {
  /** Attaches a raw-row reader for a component that mounts after this hook — the canvas path, one frame behind nothing. */
  subscribeRows: (listener: (rows: UniverseActivityRow[]) => void) => () => void;
  /** The newest rows, as of the last tick. */
  recentRows: UniverseActivityRow[];
  /** Raw events per second over the last ten seconds, as of the last tick. */
  rate: number;
  /** One node's totals as of the last tick; `{ edits: 0, execs: 0 }` for a node nothing touched. */
  countsFor: (node: number) => UniverseCounts;
};

/** Reads the ring into one snapshot. Pure, so the timer tick is the only thing that has to be right. */
function composeSnapshot(rows: UniverseActivityRow[], now: number): UniverseSnapshot {
  const counts = new Map<number, UniverseCounts>();
  let events = 0;

  for (const row of rows) {
    const held = counts.get(row.node) ?? { edits: 0, execs: 0 };
    if (row.kind === 'edit') held.edits += row.count;
    else held.execs += row.count;
    counts.set(row.node, held);
    if (now - row.at <= RATE_WINDOW_MS) events += row.count;
  }

  return { recentRows: rows.slice(-FEED_ROWS), rate: events / RATE_WINDOW_S, counts };
}

/**
 * Used by the universe panel: its canvas draws from `subscribeRows`/`onRows`, its activity feed,
 * statistics strip and selection panel from the 1 Hz snapshot. Mounted once per panel, beside
 * `useUniverseMap`, which owns the map those node indices point into.
 */
export function useUniverseStream({ onRows }: UniverseStreamOptions = {}): UniverseStream {
  const { subscribe } = useWebSocket();

  // The raw-row readers. A ref because rows land up to ten times a second: registering one must not
  // re-render anything, and the socket subscription below must never be torn down and rebuilt.
  const rowListenersRef = React.useRef(new Set<(rows: UniverseActivityRow[]) => void>());

  // The caller's own callback, held in a ref and refreshed in an effect: `onRows` is usually a fresh
  // closure per render, and a subscription keyed on it would re-register the socket listener on each
  // one — which is to say, on every render the panel makes.
  const onRowsRef = React.useRef<((rows: UniverseActivityRow[]) => void) | undefined>(undefined);
  React.useEffect(() => {
    onRowsRef.current = onRows;
  }, [onRows]);

  // The ring of the newest rows — the canvas's own reading, kept off React's clock on purpose.
  const ringRef = React.useRef<UniverseActivityRow[]>([]);

  // The ONE piece of React state here, and the whole seam between a canvas that must not re-render
  // and chrome that may: recomputed from the ring and published by a single timer tick.
  const [snapshot, setSnapshot] = React.useState<UniverseSnapshot>(() => composeSnapshot([], Date.now()));

  React.useEffect(() => {
    const unsubscribe = subscribe((event: ServerEvent) => {
      // A `universe_map` frame is not a row: it announces which estate the NEXT rows describe, and
      // the map's store is where that is kept — the same store the digest lane reads.
      if (event.kind === 'universe_map') {
        if (typeof event.mapId === 'string') setKnownMapId(event.mapId);
        return;
      }
      // One rule, one home: a frame from a map this client is not holding is not a row it can draw.
      if (!isFreshActivityFrame(event, getKnownMapId())) return;
      if (!Array.isArray(event.rows)) return;

      const rows = event.rows as UniverseActivityRow[];
      // The canvas path: handed on the instant the frame lands, with nothing between here and there.
      ringRef.current = [...ringRef.current, ...rows].slice(-RING_ROWS);
      onRowsRef.current?.(rows);
      rowListenersRef.current.forEach((listener) => listener(rows));
    });

    return unsubscribe;
    // The socket's `subscribe` is memoised on nothing, so this runs once for the panel's life.
  }, [subscribe]);

  // The chrome's clock: one tick a second recomputes the summary and publishes it as ONE state
  // update, whatever the last second held.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setSnapshot(composeSnapshot(ringRef.current, Date.now()));
    }, SNAPSHOT_MS);
    return () => window.clearInterval(timer);
  }, []);

  const subscribeRows = React.useCallback((listener: (rows: UniverseActivityRow[]) => void) => {
    rowListenersRef.current.add(listener);
    return () => {
      rowListenersRef.current.delete(listener);
    };
  }, []);

  const countsFor = React.useCallback(
    (node: number): UniverseCounts => snapshot.counts.get(node) ?? NO_COUNTS,
    [snapshot],
  );

  return { subscribeRows, recentRows: snapshot.recentRows, rate: snapshot.rate, countsFor };
}
