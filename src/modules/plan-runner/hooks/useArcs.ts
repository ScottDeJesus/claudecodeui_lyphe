import { useMemo } from 'react';

import { ARC_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { ArcSnapshot } from '@/shared/types';

/**
 * The deck's read side: every arc the lane is carrying, and how many of them are still walking.
 *
 * It reads the bus and never the socket or the API. `ArcFeed` is the only thing in the client that
 * names the `arc_state` frame; everything downstream of it — this hook, the deck, the Runner tab's
 * gate — reads a retained topic and knows nothing about how it got there. That is what lets the
 * gallery mount at any moment and paint on its FIRST render with the value the bus was already
 * holding, rather than blank until the deck next moves.
 *
 * `undefined` (nothing retained yet) and `[]` (the lane is empty) collapse to `[]` on purpose: to
 * a screen they are the same instruction — draw nothing — and the gallery renders nothing at zero
 * arcs anyway.
 *
 * `count` IS THE TAB GATE'S NUMBER, NOT THE LIST'S. It counts the arcs the deck is still walking,
 * so an arc that has finished never keeps the Runner tab open by itself — the server drops a
 * finished arc from the frame after `ENDED_KEEP_S` on its own schedule, and this is what holds
 * the gate meanwhile. `arcs` carries every arc that survives the filter, complete ones included.
 */
/**
 * The one switch that lets a TEST see test arcs — the same key `useRunnerRuns` reads, COPIED
 * rather than imported so the two hooks stay independent readings of one convention. A browser
 * probe sets it before the app loads; the operator never does, so their deck holds only their own
 * arcs and a fixture under `/tmp` never blinks onto their screen.
 */
const SHOW_TEST_RUNS_KEY = 'cloudcli:show-test-runs';

function showTestArcs(): boolean {
  try {
    return localStorage.getItem(SHOW_TEST_RUNS_KEY) === '1';
  } catch {
    return false;
  }
}

export function useArcs(): { arcs: ArcSnapshot[]; count: number } {
  const value = useLiveTopic<ArcSnapshot[]>(ARC_ALL_TOPIC);

  return useMemo(() => {
    const lane = Array.isArray(value?.payload) ? value.payload : [];
    const arcs = showTestArcs() ? lane : lane.filter((arc) => !arc.test_arc);

    return { arcs, count: arcs.filter((arc) => arc.status !== 'complete').length };
  }, [value]);
}
