import { useEffect, type ReactNode } from 'react';

import { DISPATCHER_ALL_TOPIC, useLiveBus } from '@/modules/live-bus';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { DispatcherArc, DispatcherDaemon, DispatcherLanePicture, DispatcherPlan, DispatcherPlanner, DispatcherRoute } from '@/shared/types';

/**
 * THIS IS THE DISPATCHER LANE'S DOOR INTO THE LIVE BUS, and it is the only place in the client that
 * names the `dispatcher_state` frame.
 *
 * The bus knows no producer on purpose (`src/modules/live-bus/context/LiveBusContext.tsx`): it
 * retains, dispatches and admits topics, and nothing else. What fills it is a FEED — a headless
 * component owned by the module whose data it carries — so a further lane arrives as a sibling
 * `*Feed.tsx` in ITS own module and never as a line in `live-bus/`. That is what keeps the bus from
 * growing a switch over frame kinds it has no business knowing.
 *
 * It renders `children` unchanged and owns no state, so mounting it costs one subscription and one
 * render of whatever it wraps. `App` mounts it once, inside `LiveBusProvider` (it publishes into
 * it), inside the auth gate (its seed must never fire against the login screen) and below
 * `WebSocketProvider` (it subscribes to the one socket, and never opens a second).
 *
 * ONE TOPIC, BECAUSE ONE PICTURE. The run lane publishes a topic per run beside its whole array, so
 * that a widget can watch one thing; the dispatcher has no reader for a single plan — every card is
 * drawn from the same census, which is also where the count and the route come from — so it
 * publishes the whole picture and nothing else. There is therefore no per-plan topic to RETIRE when
 * a plan is cut away: the picture simply stops carrying it, and no reader is holding a value that
 * nobody would ever clear.
 *
 * WHAT THE PAYLOAD LEAVES OUT IS THE POINT. The frame carries two keys that change without anything
 * moving — `home`, and `generated_at`, restamped from the dispatcher's clock on every poll — plus
 * the frame's own `at`, which the bus carries as the value's clock. Republishing the frame whole
 * would make every poll a new reading by `JSON.stringify`, which is exactly how a lane wakes every
 * open screen twice a second with no news in it. So the payload is the seven keys a reader draws
 * from — `plans`, `arcs`, `planners`, the route, the daemon and the next off-peak moment — with the
 * document's own spellings left alone.
 *
 * TWO WAYS IN, AND THEY DO NOT FIGHT. The push is authoritative: every `dispatcher_state` frame is
 * republished. The REST seed exists for the gap the push cannot cover — the moment between mounting
 * and the watcher's next broadcast, which only happens on a CHANGE, so a quiet lane can leave a
 * fresh page blank for as long as nothing moves. The seed therefore never overwrites a READING NEWER
 * THAN ITSELF: a request in flight while a frame arrives would otherwise land after it and put the
 * older picture back on screen for as long as the lane stays quiet.
 */
export function DispatcherFeed({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const bus = useLiveBus();

  useEffect(() => {
    // Guards the seed's async tail: a response landing after unmount must not publish into a bus
    // this component no longer belongs to.
    let cancelled = false;

    // Publishes the picture, optionally refusing to overwrite a newer reading. Returns whether it
    // published, which is what makes "guarded" a real condition rather than a timing hope.
    const put = (picture: DispatcherLanePicture, at: number, guarded: boolean): boolean => {
      if (guarded) {
        const held = bus.get(DISPATCHER_ALL_TOPIC);
        if (held && held.at >= at) return false;
      }
      bus.publish(DISPATCHER_ALL_TOPIC, picture, at);
      return true;
    };

    const seed = async () => {
      try {
        const response = await api.dispatcher.plans();
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as Record<string, unknown>;
        if (cancelled) return;
        const picture = asPicture(body);
        // A body that is not the whole picture is not published at all: a half-filled lane would
        // read downstream as "this box has no plans and no posture", which is worse than the blank
        // the next frame fills.
        if (picture === null) return;
        put(picture, typeof body.at === 'number' ? body.at : Date.now(), true);
      } catch (error) {
        // A seed that fails is a gap, not a failure: the next frame fills it. Logged rather than
        // surfaced, because nothing on screen is waiting on this and a dead lane is not an error
        // the reader can act on.
        console.warn('[DispatcherFeed] the dispatcher seed could not be read:', error);
      }
    };

    const unsubscribe = subscribe((event) => {
      // A reconnect means frames were missed while the socket was down, and the watcher only
      // broadcasts on CHANGE — so a plan that moved during the outage would otherwise show its
      // pre-outage picture until it moved again. Re-seeding closes exactly that gap.
      if (event.kind === 'websocket_reconnected') {
        void seed();
        return;
      }
      if (event.kind !== 'dispatcher_state') return;
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

/**
 * The seven keys the topic carries, out of a frame or a response body — or `null` when the value is
 * not the whole picture. Checked one field at a time rather than cast, because the socket's event
 * type is deliberately loose (`ServerEvent`) and a payload this module publishes is read by every
 * card on the screen: a missing `route` would surface as a crash in a card instead of as a lane
 * that simply has not spoken yet.
 *
 * `arcs` AND `planners` ARE THE TWO FIELDS READ RATHER THAN DEMANDED. A frame from a server older
 * than either key is still a whole picture of the plans — the same reading a fresh page gets before
 * the first frame lands — so an absent list draws no arc headers, or no badges, instead of blanking
 * every card the frame did carry. A key that IS there and is not a list is still refused, like every
 * other field here.
 */
function asPicture(value: unknown): DispatcherLanePicture | null {
  if (value === null || typeof value !== 'object') return null;
  const held = value as Record<string, unknown>;
  if (!Array.isArray(held.plans)) return null;
  if (held.arcs !== undefined && !Array.isArray(held.arcs)) return null;
  if (held.planners !== undefined && !Array.isArray(held.planners)) return null;
  if (held.route === null || typeof held.route !== 'object') return null;
  if (held.daemon === null || typeof held.daemon !== 'object') return null;
  if (typeof held.offpeak_at !== 'string') return null;
  return {
    plans: held.plans as DispatcherPlan[],
    arcs: (held.arcs ?? []) as DispatcherArc[],
    planners: (held.planners ?? []) as DispatcherPlanner[],
    route: held.route as DispatcherRoute,
    daemon: held.daemon as DispatcherDaemon,
    offpeak_at: held.offpeak_at,
  };
}
