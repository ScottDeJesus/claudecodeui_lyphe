import { useEffect, useRef, type ReactNode } from 'react';

import { UNIVERSE_ALL_TOPIC as UNIVERSE_TOPIC, useLiveBus } from '@/modules/live-bus';
import { ensureUniverseMap, getKnownMapId, setKnownMapId } from '@/modules/universe/hooks/useUniverseMap';
import { isFreshActivityFrame } from '@/modules/universe/utils/universeFrames';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ServerEvent, UniverseActivityRow, UniverseDigest } from '@/shared/types';

/**
 * THIS IS THE ESTATE'S DOOR INTO THE LIVE BUS, and the only place outside the tab that reads
 * `universe_activity` frames.
 *
 * The bus knows no producer on purpose (`src/modules/live-bus/context/LiveBusContext.tsx`), so a
 * lane arrives as a FEED: a headless component owned by the module whose data it carries. This is
 * the third of them, after `RunnerFeed` and `SoulLaunchFeed`, and it follows their shape — one
 * subscription, `children` rendered unchanged, no UI of its own.
 *
 * WHAT IT PUBLISHES IS A DIGEST, NEVER THE ROWS. The estate's stream is coalesced and flushed up to
 * ten times a second; the bus retains one value per topic and compares every publish by
 * `JSON.stringify`, so a lane carrying raw rows would stringify the whole payload ten times a second
 * for as long as anything in the estate is busy, whether or not a single subscriber exists. What
 * goes on `universe:*` instead is the window's counts — edits, executions, and the newest raw `at` —
 * accumulated between publishes and published AT MOST ONCE A SECOND.
 *
 * A QUIET SECOND PUBLISHES NOTHING, which is the same rule the server's own coalescer keeps: an
 * empty reading ten times a second says only "still nothing", and a trailing digest of zeros would
 * overwrite the last window that had something in it. The retained value therefore carries the
 * newest window that held any activity, and `at` is what a reader measures its staleness against.
 *
 * THE SEED IS THE MAP, and it exists for the same reason `SoulLaunchFeed`'s REST seed does: a frame
 * is only fresh against a `mapId` this client knows (`isFreshActivityFrame`), and the only way to
 * learn the current one is to fetch the map. `ensureUniverseMap` does that through the map's own
 * store, so the tab that later opens is answered from the same fetch. On a reconnect the seed runs
 * again — frames were missed while the socket was down, and a crawl could have landed in that gap.
 *
 * `App` mounts it inside `LiveBusProvider`, inside the auth gate and below `WebSocketProvider` —
 * nested inside the other two feeds, which is what the feeds' own nesting rule asks for.
 */
export function UniverseFeed({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const bus = useLiveBus();

  // The window accumulating between publishes: the two counts and the newest raw `at` seen. A ref
  // because nothing renders from it — rows land up to ten times a second and a state update here
  // would put the whole app's chrome on the activity stream's clock.
  const windowRef = useRef<UniverseDigest | null>(null);

  useEffect(() => {
    const accumulate = (rows: UniverseActivityRow[]): void => {
      const held = windowRef.current ?? { edits: 0, execs: 0, at: 0 };
      for (const row of rows) {
        if (row.kind === 'edit') held.edits += row.count;
        else held.execs += row.count;
        if (row.at > held.at) held.at = row.at;
      }
      windowRef.current = held;
    };

    /** Publishes the window, if anything has landed in it, and starts a new one. */
    const publish = (): void => {
      const held = windowRef.current;
      if (held === null) return;
      windowRef.current = null;
      // `at` is the newest raw event's instant, not the tick's: the bus retains the instant a reading
      // became TRUE, which is what lets a subscriber tell a busy estate from a stalled one.
      bus.publish(UNIVERSE_TOPIC, held, held.at);
    };

    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind === 'websocket_reconnected') {
        // Frames were missed while the socket was down, and the announcement of a new map is one of
        // them: re-seeding is what closes that gap, exactly as the sibling feeds' seeds do.
        ensureUniverseMap();
        return;
      }
      if (event.kind === 'universe_map') {
        if (typeof event.mapId === 'string') setKnownMapId(event.mapId);
        return;
      }
      // The same rule the canvas's reader asks, so a digest is never counted from a retired map.
      if (!isFreshActivityFrame(event, getKnownMapId())) return;
      if (!Array.isArray(event.rows)) return;
      accumulate(event.rows as UniverseActivityRow[]);
    });

    const timer = window.setInterval(publish, 1000);
    ensureUniverseMap();

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
    // Both are stable for the life of the provider tree above, so this runs once: the socket's
    // `subscribe` is memoised on nothing, and the bus's identity never changes.
  }, [subscribe, bus]);

  return <>{children}</>;
}
