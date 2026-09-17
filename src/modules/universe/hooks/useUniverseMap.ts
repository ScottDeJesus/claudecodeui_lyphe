import { useEffect, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import type { UniverseMap } from '@/shared/types';

/**
 * THE ESTATE MAP, FETCHED ONCE AND HELD FOR THE LIFE OF THE PAGE — and one identity rule shared by
 * every reader of it.
 *
 * WHY THE CACHE IS MODULE-LEVEL, not component state. The map is 1.4 MB of JSON and it changes only
 * when a repo's HEAD moves, while the workspace remounts a tab's panel on every tab change. Held in
 * a component, each of those would cost a download; held here, the last map answers every mount
 * after the first and a tab switch is free — which is the whole of the module's mutable state, in
 * the one file that owns the map.
 *
 * WHY ONE IDENTITY RULE, AND WHAT IT IS NOT. A client's copy is current exactly when its `mapId` is
 * the one the incoming `universe_activity` rows index, because those rows carry node indices and
 * nothing else. So the two socket readers (`useUniverseStream`, `UniverseFeed`) announce a new
 * `mapId` from a `universe_map` frame through `setKnownMapId` — and `getKnownMapId` does NOT answer
 * with the announcement. It answers with the map the client HOLDS, because an announcement says a
 * crawl landed somewhere, not that this client has it: the frame is broadcast the moment a repo's
 * HEAD moves, while the map is still being written. Until the refetch lands, a row carrying the
 * announced id indexes a node list this client cannot draw, and admitting it points every flare at
 * the wrong star — which is the contract `server/shared/types.ts` states for these frames, that a
 * client holding a different map "refetches the map and drops the in-flight rows". So the
 * announcement opens a fetch; the fetch landing opens the gate. One store, one answer, so a reader
 * that has drawn the sky and a reader counting a digest cannot describe two different estates.
 *
 * WHY A FETCH IS BOUNDED. One request is ever in the air, and the announcement it is answering is
 * recorded: a frame that arrives while the disk still serves the previous map costs ONE download
 * rather than a loop of them, and a failure is retried on the next announcement rather than in a
 * spin. Best-effort throughout — a map that cannot be read leaves `error` set and the module usable,
 * and the next announcement tries again.
 *
 * ONE RENDER TRIGGER: the store notifies on a real change only, so a component mounting after the
 * map landed renders once, with the map in hand.
 */

/**
 * What a reader of the map is handed. `map` is `null` until a fetch lands — a state of its own and
 * not merely `loading`'s shadow: a panel drawn in that moment has nothing to draw and must be able
 * to say so rather than draw an empty sky.
 */
export type UniverseMapState = { map: UniverseMap | null; loading: boolean; error: string | null };

/** The store's whole value. `announcedMapId` rides beside the state so a reader re-loads when it moves. */
type UniverseMapSnapshot = { state: UniverseMapState; announcedMapId: string | null };

let snapshot: UniverseMapSnapshot = { state: { map: null, loading: false, error: null }, announcedMapId: null };

/** The mapId a `universe_map` frame announced, or `null` while no frame has moved it. */
let announcedMapId: string | null = null;

/**
 * The announcement the LAST SUCCESSFUL request answered, which bounds a crawl that has not caught
 * up on disk to one download. Deliberately not set by a request that failed: a failure has to stay
 * retryable, or a tab that met a dead route once stays mapless until the page is reloaded.
 */
let answeredMapId: string | null = null;

/** The request in the air, or `null`. One at a time, ever. */
let inflight: Promise<void> | null = null;

const listeners = new Set<() => void>();

/** Replaces the snapshot and wakes every reader. */
function publishUpdate(state: UniverseMapState): void {
  snapshot = { state, announcedMapId };
  for (const listener of Array.from(listeners)) listener();
}

/** Stable identities, both of them: a new `subscribe` each render would resubscribe React on every one. */
const subscribeToStore = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const readSnapshot = (): UniverseMapSnapshot => snapshot;

/**
 * The mapId the rows being read are indexable against: THE MAP THE CLIENT HOLDS, and nothing else.
 *
 * The announcement is deliberately not consulted here, and that is the whole safety of this lane. A
 * `universe_map` frame says a new crawl has landed; it does NOT put the new map in this client's
 * hands. Until the refetch lands, a row carrying the announced id indexes a node list this client
 * cannot draw, so admitting it would point every flare at the wrong star — the contract
 * `server/shared/types.ts` states for these frames is that a client holding a different map
 * "refetches the map and DROPS the in-flight rows". The announcement opens a fetch; the map landing
 * is what opens the gate, because the map landing is when the indices start meaning something.
 */
export function getKnownMapId(): string | null {
  return snapshot.state.map?.mapId ?? null;
}

/** Whether the copy held is not the one the newest announcement names. */
function isStale(): boolean {
  if (snapshot.state.map === null) return true;
  if (announcedMapId === null) return false;
  // A crawl that has landed on the wire but not yet on disk is ONE stale download, not a permanent
  // loop: the announcement a request SUCCESSFULLY answered is recorded and not re-asked.
  return announcedMapId !== snapshot.state.map.mapId && announcedMapId !== answeredMapId;
}

/** Starts a fetch unless one is out. Never throws: a failure lands in the state, where a reader sees it. */
function load(): void {
  if (inflight !== null) return;
  const answering = announcedMapId;
  publishUpdate({ ...snapshot.state, loading: true, error: null });

  inflight = (async () => {
    try {
      const response = await api.universe.map();
      if (!response.ok) throw new Error(`the map route answered ${response.status}`);
      answeredMapId = answering;
      publishUpdate({ map: (await response.json()) as UniverseMap, loading: false, error: null });
    } catch (error) {
      // The announcement is left UNANSWERED, so the next ask — the panel mounting, the feed
      // re-seeding on a reconnect, a repeated announcement — goes out again rather than being
      // refused as already-tried. A lane that cannot be retried is a lane that stays dark.
      publishUpdate({
        ...snapshot.state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inflight = null;
    }
  })();
}

/**
 * Fetches the map if the copy held is not the one the newest announcement names. Idempotent, and
 * safe to call from anywhere in this module — `UniverseFeed` seeds with it at mount and on a
 * reconnect, where it covers the announcement a `universe_map` frame dropped during the outage
 * would have carried.
 */
export function ensureUniverseMap(): void {
  if (isStale()) load();
}

/**
 * Records the mapId a `universe_map` frame carries and asks for the map it names. Called by the
 * module's two socket readers and by nothing else, so the announcement is one fact rather than two
 * that could drift. It does NOT redefine what the readers consider fresh — `getKnownMapId` answers
 * with the map held, and only a landed fetch moves it.
 */
export function setKnownMapId(mapId: string): void {
  if (mapId !== announcedMapId) {
    announcedMapId = mapId;
    publishUpdate(snapshot.state);
  }
  // Asked for on EVERY announcement, repeated ones included: the only request this can start is one
  // whose predecessor failed or has yet to be made.
  ensureUniverseMap();
}

/**
 * Used by the universe panel (and, from the next phase, the canvas under it) to draw the estate. The
 * effect is keyed on the two things that move it — an announcement, and a map landing — so a fetch
 * that failed, which moves neither, is retried on the next announcement or mount instead of in a
 * render loop.
 */
export function useUniverseMap(): UniverseMapState {
  const held = useSyncExternalStore(subscribeToStore, readSnapshot, readSnapshot);

  useEffect(() => {
    ensureUniverseMap();
  }, [held.announcedMapId, held.state.map]);

  return held.state;
}
