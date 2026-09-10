import { useEffect, useRef, type ReactNode } from 'react';

import { RUNNER_ALL_TOPIC, runnerTopic, useLiveBus } from '@/modules/live-bus';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { RunnerRunSnapshot } from '@/shared/types';

/**
 * THIS IS THE RUNNER'S DOOR INTO THE LIVE BUS, and it is the only place in the client that names
 * the `runner_state` frame.
 *
 * The bus knows no producer on purpose (`src/modules/live-bus/context/LiveBusContext.tsx`): it
 * retains, dispatches and admits topics, and nothing else. What fills it is a FEED — a headless
 * component owned by the module whose data it carries. So a second lane (git delegation, Task
 * Master) arrives as a sibling `*Feed.tsx` in ITS own module, and never as a line in `live-bus/`.
 * That is what stops the bus growing a switch over frame kinds it has no business knowing.
 *
 * It renders `children` unchanged and owns no state, so mounting it costs one subscription and
 * one render of whatever it wraps. `App` mounts it once, inside `LiveBusProvider` (it publishes
 * into it), inside the auth gate (its seed must never fire against the login screen) and below
 * `WebSocketProvider` (it subscribes to the one socket, and never opens a second).
 *
 * TWO WAYS IN, AND THEY DO NOT FIGHT. The push is authoritative: every `runner_state` frame is
 * republished whole. The REST seed exists for the gap the push cannot cover — the moment between
 * mounting and the watcher's next broadcast, which only happens on a CHANGE, so a quiet lane can
 * leave a fresh page blank for as long as nothing moves. The seed therefore never overwrites a
 * READING NEWER THAN ITSELF: a request in flight while a frame arrives would otherwise land after
 * it and put the older picture back on screen for as long as the lane stays quiet.
 */
export function RunnerFeed({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const bus = useLiveBus();

  // The per-run ids this feed last published a topic for. Essential, and a ref rather than state
  // because nothing renders from it: it is the ONLY way to know which topics have to be RETIRED.
  // A run that ends simply stops appearing in `runs` — nothing announces its departure — so
  // without this set its last snapshot would stay retained forever and the next widget to
  // subscribe would be replayed a run that finished hours ago, as though it were still going.
  const publishedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    // Guards the seed's async tail: a response landing after unmount must not publish into a bus
    // this component no longer belongs to.
    let cancelled = false;

    // Publishes one topic, optionally refusing to overwrite a newer reading. Returns whether it
    // published, which is what lets a refused RETIREMENT be tried again on the next reading.
    const put = (topic: string, payload: unknown, at: number, guarded: boolean): boolean => {
      if (guarded) {
        const held = bus.get(topic);
        if (held && held.at >= at) return false;
      }
      bus.publish(topic, payload, at);
      return true;
    };

    const apply = (runs: RunnerRunSnapshot[], at: number, guarded: boolean) => {
      put(RUNNER_ALL_TOPIC, runs, at, guarded);

      const nextIds = new Set<string>();
      for (const run of runs) {
        if (typeof run?.run_id !== 'string') continue;
        nextIds.add(run.run_id);
        // An id outside the vocabulary keeps its place in `runner:*`; the bus voices that refusal.
        put(runnerTopic(run.run_id), run, at, guarded);
      }

      // Every id that was here last time and is gone now is retired with `null` — a positive
      // statement that the run is over, which a subscriber can tell apart from never having heard
      // of it. An id whose retirement was REFUSED as stale stays on the books so the next reading
      // retires it, rather than being dropped here and leaving its value retained with nobody
      // left who remembers to clear it.
      const stillHeld = new Set(nextIds);
      for (const id of publishedIdsRef.current) {
        if (nextIds.has(id)) continue;
        if (!put(runnerTopic(id), null, at, guarded)) stillHeld.add(id);
      }
      publishedIdsRef.current = stillHeld;
    };

    const seed = async () => {
      try {
        const response = await api.planRunner.runs();
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as { runs?: unknown; at?: unknown };
        if (cancelled || !Array.isArray(body.runs)) return;
        apply(body.runs as RunnerRunSnapshot[], typeof body.at === 'number' ? body.at : Date.now(), true);
      } catch (error) {
        // A seed that fails is a gap, not a failure: the next frame fills it. Logged rather than
        // surfaced, because nothing on screen is waiting on this and a dead lane is not an error
        // the reader can act on.
        console.warn('[RunnerFeed] the runner seed could not be read:', error);
      }
    };

    const unsubscribe = subscribe((event) => {
      // A reconnect means frames were missed while the socket was down, and the watcher only
      // broadcasts on CHANGE — so a run that moved during the outage would otherwise show its
      // pre-outage picture until it moved again. Re-seeding closes exactly that gap.
      if (event.kind === 'websocket_reconnected') {
        void seed();
        return;
      }
      if (event.kind !== 'runner_state') return;
      if (!Array.isArray(event.runs)) return;
      apply(event.runs as RunnerRunSnapshot[], typeof event.at === 'number' ? event.at : Date.now(), false);
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
