import { useEffect, type ReactNode } from 'react';

import { SOULS_ALL_TOPIC, useLiveBus } from '@/modules/live-bus';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { SoulLaunchSnapshot } from '@/shared/types';

/**
 * THIS IS THE LAUNCHER SOULS' DOOR INTO THE LIVE BUS, and the only place in the client that names
 * the `soul_launch_state` frame.
 *
 * The bus knows no producer on purpose (`src/modules/live-bus/context/LiveBusContext.tsx`), so a
 * lane arrives as a FEED — a headless component owned by the module whose data it carries. This is
 * the sibling `RunnerFeed`'s doc calls for, and it follows that one's shape exactly, because the
 * two lanes have the same two problems to solve.
 *
 * TWO WAYS IN, AND THEY DO NOT FIGHT. The push is authoritative: every `soul_launch_state` frame
 * is republished whole. The REST seed exists for the gap the push cannot cover — the moment
 * between mounting and the lane's next broadcast, which only happens on a CHANGE, so a state root
 * nothing is moving in would leave a fresh page blank until the next dispatch started. The seed
 * therefore never overwrites a READING NEWER THAN ITSELF: a request in flight while a frame
 * arrives would otherwise land after it and put the older picture back on screen.
 *
 * It renders `children` unchanged and owns no state, so mounting it costs one subscription and one
 * render of whatever it wraps. `App` mounts it inside `LiveBusProvider`, inside the auth gate (its
 * seed must never fire against the login screen) and below `WebSocketProvider` (it subscribes to
 * the one socket, and never opens a second).
 */
export function SoulLaunchFeed({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const bus = useLiveBus();

  useEffect(() => {
    // Guards the seed's async tail: a response landing after unmount must not publish into a bus
    // this component no longer belongs to.
    let cancelled = false;

    const apply = (launches: SoulLaunchSnapshot[], at: number, guarded: boolean): void => {
      if (guarded) {
        const held = bus.get(SOULS_ALL_TOPIC);
        if (held && held.at >= at) return;
      }
      bus.publish(SOULS_ALL_TOPIC, launches, at);
    };

    const seed = async () => {
      try {
        const response = await api.dispatchSouls.launches();
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as { launches?: unknown; at?: unknown };
        if (cancelled || !Array.isArray(body.launches)) return;
        apply(
          body.launches as SoulLaunchSnapshot[],
          typeof body.at === 'number' ? body.at : Date.now(),
          true,
        );
      } catch (error) {
        // A seed that fails is a gap, not a failure: the next frame fills it. Logged rather than
        // surfaced, because nothing on screen is waiting on this and a dead lane is not an error
        // the reader can act on.
        console.warn('[SoulLaunchFeed] the launcher seed could not be read:', error);
      }
    };

    const unsubscribe = subscribe((event) => {
      // A reconnect means frames were missed while the socket was down, and the lane only
      // broadcasts on CHANGE — so a soul that started or ended during the outage would otherwise
      // show its pre-outage picture until it moved again. Re-seeding closes exactly that gap.
      if (event.kind === 'websocket_reconnected') {
        void seed();
        return;
      }
      if (event.kind !== 'soul_launch_state') return;
      if (!Array.isArray(event.launches)) return;
      apply(
        event.launches as SoulLaunchSnapshot[],
        typeof event.at === 'number' ? event.at : Date.now(),
        false,
      );
    });

    void seed();

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Both are stable for the life of the provider tree above, so this runs once: the socket's
    // `subscribe` is memoised on nothing, and the bus's identity never changes.
  }, [subscribe, bus]);

  return <>{children}</>;
}
