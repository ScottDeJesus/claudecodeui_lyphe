import { useEffect, type ReactNode } from 'react';

import { ROADMAP_ALL_TOPIC, useLiveBus } from '@/modules/live-bus';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { Roadmap, RoadmapPicture } from '@/shared/roadmap-types';

/**
 * THIS IS THE ROADMAP LANE'S DOOR INTO THE LIVE BUS, and it is the only place in the client that names
 * the `roadmap_state` frame. It is `DispatcherFeed`'s twin for the roadmap and follows its shape
 * exactly (`src/modules/dispatcher/DispatcherFeed.tsx`, whose header says why a lane is a headless
 * feed in its own module and never a line in `live-bus/`).
 *
 * It renders `children` unchanged and owns no state of its own, so mounting it costs one
 * subscription, one silent listener and one render of whatever it wraps. `App` mounts it once, inside
 * `LiveBusProvider` (it publishes into it), inside the auth gate (its seed must never fire against the
 * login screen) and below `WebSocketProvider` (it subscribes to the one socket, and never opens a
 * second).
 *
 * ONE TOPIC, BECAUSE ONE PICTURE. The screen draws one roadmap at a time, but the celebrations diff
 * the whole picture and `unplaced` is the store's, not a roadmap's, so the payload is the document
 * whole — `{ generated_at, roadmaps, unplaced }`, the frame's `kind` and `at` taken off — on one topic.
 * There is no per-roadmap topic to retire when a roadmap is removed: the picture simply stops
 * carrying it.
 *
 * TWO WAYS IN, AND THEY DO NOT FIGHT. The push is authoritative: every `roadmap_state` frame is
 * republished with the frame's own `at`. The REST seed covers the gap the push cannot — the moment
 * between mounting and the lane's next broadcast, which happens only on a CHANGE, so a quiet roadmap
 * would leave a fresh page blank for as long as nothing moved. The seed therefore never overwrites a
 * READING NEWER THAN ITSELF: a request in flight while a frame arrives would otherwise land after it
 * and put the older picture back on screen.
 *
 * `generated_at` STAYS IN THE PAYLOAD, BUT IS NO READING. The dispatcher restamps it on every read,
 * and a mount or a reconnect re-seeds from a fresh read of an unchanged store; the bus compares
 * publishes by `JSON.stringify`, so republishing that picture would wake every subscriber with a new
 * `roadmaps` array and nothing new in it. The server's frames already go out only on a change; the
 * seed is what `put` holds to the same rule.
 */
export function RoadmapFeed({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const bus = useLiveBus();

  useEffect(() => {
    // Guards the seed's async tail: a response landing after unmount must not publish into a bus
    // this component no longer belongs to.
    let cancelled = false;

    // Publishes the picture, optionally refusing to overwrite a newer reading. Returns whether it
    // published, which is what makes "guarded" a real condition rather than a timing hope. A picture
    // that differs from the held one by `generated_at` alone is not a reading and is not published (see
    // `sameReading`), however it arrived.
    const put = (picture: RoadmapPicture, at: number, guarded: boolean): boolean => {
      const held = bus.get<RoadmapPicture>(ROADMAP_ALL_TOPIC);
      if (guarded && held && held.at >= at) return false;
      if (held && sameReading(held.payload, picture)) return false;
      bus.publish(ROADMAP_ALL_TOPIC, picture, at);
      return true;
    };

    const seed = async () => {
      try {
        const response = await api.roadmap.picture();
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as Record<string, unknown>;
        if (cancelled) return;
        const picture = asPicture(body);
        // A body that is not the whole picture is not published at all — the lane answers
        // `{ error }` until this boot has read the dispatcher, and a half-filled roadmap would read
        // downstream as "this user has no roadmaps", which is worse than the blank the next frame fills.
        if (picture === null) return;
        put(picture, typeof body.at === 'number' ? body.at : Date.now(), true);
      } catch (error) {
        // A seed that fails is a gap, not a failure: the next frame fills it. Logged rather than
        // surfaced, because nothing on screen is waiting on this and a dead lane is not an error
        // the reader can act on.
        console.warn('[RoadmapFeed] the roadmap seed could not be read:', error);
      }
    };

    const unsubscribe = subscribe((event) => {
      // A reconnect means frames were missed while the socket was down, and the lane only broadcasts
      // on CHANGE — so a write that landed during the outage would otherwise show its pre-outage
      // picture until the roadmap moved again. Re-seeding closes exactly that gap.
      if (event.kind === 'websocket_reconnected') {
        void seed();
        return;
      }
      if (event.kind !== 'roadmap_state') return;
      const picture = asPicture(event);
      if (picture === null) return;
      put(picture, typeof event.at === 'number' ? event.at : Date.now(), false);
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

/** Whether two pictures say the same thing: equal in everything but the `generated_at` the dispatcher restamps on every read. */
function sameReading(held: RoadmapPicture, incoming: RoadmapPicture): boolean {
  return (
    JSON.stringify({ roadmaps: held.roadmaps, unplaced: held.unplaced })
    === JSON.stringify({ roadmaps: incoming.roadmaps, unplaced: incoming.unplaced })
  );
}

/** Whether a value is a plain object, not an array or null. */
const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/**
 * The three keys the topic carries, out of a frame or a response body — or `null` when the value is
 * not the whole picture. Checked one field at a time rather than cast, because the socket's event
 * type is deliberately loose (`ServerEvent`) and a payload this module publishes is read by every
 * row on the screen: a missing `unplaced` would surface as a crash in the banner instead of as a lane
 * that simply has not spoken yet. The frame's `kind` and `at` and the response's `at` are left off on
 * purpose — `at` travels as the bus value's own clock.
 */
function asPicture(value: unknown): RoadmapPicture | null {
  if (!isRecord(value)) return null;
  if (typeof value.generated_at !== 'string') return null;
  if (!Array.isArray(value.roadmaps)) return null;
  const { unplaced } = value;
  if (!isRecord(unplaced) || !Array.isArray(unplaced.epics) || !Array.isArray(unplaced.features)) return null;
  return {
    generated_at: value.generated_at,
    roadmaps: value.roadmaps as Roadmap[],
    unplaced: unplaced as RoadmapPicture['unplaced'],
  };
}
