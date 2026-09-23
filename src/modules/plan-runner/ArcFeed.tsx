import { useEffect, type ReactNode } from 'react';

import { ARC_ALL_TOPIC, useLiveBus } from '@/modules/live-bus';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ArcSnapshot } from '@/shared/types';

/**
 * THIS IS THE ARC DECK'S DOOR INTO THE LIVE BUS, and it is the only place in the client that names
 * the `arc_state` frame.
 *
 * Its twin is `RunnerFeed` beside it, and the shape is deliberately the same one: a feed is a
 * headless component owned by the module whose data it carries, it renders `children` unchanged,
 * and it owns no state of its own. One feed per lane, in the lane's own module — which is why the
 * deck did not become a second job for `RunnerFeed`.
 *
 * ONE TOPIC, AND NO RETIREMENT. A run publishes a topic per run id as well as the whole lane
 * (`RunnerFeed`), because a card may open one run alone and a finished run must be retired off its
 * topic. Nothing reads a single arc that way: the deck is one gallery, drawn whole from `arc:*`,
 * and the server dropping a finished arc from the frame is the whole of the retirement — the next
 * reading is a shorter array, which the reader replays.
 *
 * TWO WAYS IN, AND THEY DO NOT FIGHT — the rule `RunnerFeed` states and this one keeps whole. The
 * push is authoritative: every `arc_state` frame is republished whole. The REST seed covers the
 * gap the push cannot: the watcher broadcasts only on a CHANGE, so a quiet deck can leave a fresh
 * page blank for as long as nothing moves. The seed therefore never overwrites a reading NEWER
 * than itself, or a request in flight while a frame arrives would land after it and put the older
 * picture on screen for as long as the deck stays quiet.
 *
 * Mounted by `App`, inside `LiveBusProvider` (it publishes into it), inside the auth gate (its seed
 * must never fire against the login screen) and below `WebSocketProvider` (it subscribes to the
 * one socket, and never opens a second).
 */
export function ArcFeed({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const bus = useLiveBus();

  useEffect(() => {
    // Guards the seed's async tail: a response landing after unmount must not publish into a bus
    // this component no longer belongs to.
    let cancelled = false;

    // Publishes the deck, optionally refusing to overwrite a newer reading — the same guard, for
    // the same reason, as `RunnerFeed`'s.
    const put = (arcs: ArcSnapshot[], at: number, guarded: boolean): void => {
      if (guarded) {
        const held = bus.get(ARC_ALL_TOPIC);
        if (held && held.at >= at) return;
      }
      bus.publish(ARC_ALL_TOPIC, arcs, at);
    };

    const seed = async () => {
      try {
        const response = await api.planRunner.arcs();
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as { arcs?: unknown; at?: unknown };
        // The `Array.isArray` guard is load-bearing while the server's arc lane is not answering
        // yet: an unknown `/api/plan-runner/*` path answers this SPA's HTML with status 200, so a
        // missing lane is a 200 carrying a document, not a failed request.
        if (cancelled || !Array.isArray(body.arcs)) return;
        put(body.arcs as ArcSnapshot[], typeof body.at === 'number' ? body.at : Date.now(), true);
      } catch (error) {
        // A seed that fails is a gap, not a failure: the next frame fills it. Logged rather than
        // surfaced, because nothing on screen is waiting on this.
        console.warn('[ArcFeed] the arc deck seed could not be read:', error);
      }
    };

    const unsubscribe = subscribe((event) => {
      // A reconnect means frames were missed while the socket was down, and the watcher only
      // broadcasts on CHANGE — so a deck that moved during the outage would otherwise show its
      // pre-outage picture until it moved again. Re-seeding closes exactly that gap.
      if (event.kind === 'websocket_reconnected') {
        void seed();
        return;
      }
      if (event.kind !== 'arc_state') return;
      if (!Array.isArray(event.arcs)) return;
      put(event.arcs as ArcSnapshot[], typeof event.at === 'number' ? event.at : Date.now(), false);
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
