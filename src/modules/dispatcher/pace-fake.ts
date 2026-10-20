import { createContext, useContext } from 'react';

import type { DispatcherPace, DispatcherPhase, DispatcherPlan } from '@/shared/types';

/**
 * THE FAKES THE SCAFFOLD RENDERS OVER — the pacer's picture the dispatcher will send (`route.pace`)
 * and the one pace hold a card will carry (`plan.pace_hold`), each state a WHOLE value so a fixture
 * draws the real `MasterController` and the real `PlanCard` without a single field invented at the
 * mount. The live screen reads the two contexts below, whose defaults are empty: absent pace, no
 * hold, nothing drawn. The fill phase replaces those reads with `route?.pace` and `plan.pace_hold`
 * and deletes this file.
 *
 * THE FIGURES ARE FRACTIONS 0..1, as the dispatcher's document spells them (interface VI); the
 * words beside them are the dispatcher's own sentence, which is what the board draws. A whole card
 * is a plan of no arc with one phase, queued, so its head is the row these fakes exist to show.
 */

/** One ready phase, so a fake card's face is a real card's face rather than a blank. */
const PHASE: DispatcherPhase = {
  key: '1',
  position: 1,
  title: 'Walk the demo feature',
  assignee: 'iris',
  status: 'not started',
  chain_id: null,
  done_at: null,
  waits_on: [],
  busy: false,
  stalled: null,
  rounds: 0,
  cost_usd: 0,
  tokens: 0,
  tokens_in: 0,
  tokens_out: 0,
  tokens_cache_read: null,
  start_here: [],
  stages: [],
};

/** The plan every held-card fake is cut from: a whole `DispatcherPlan`, queued, with nothing else waiting on it. */
const BASE_PLAN: DispatcherPlan = {
  name: 'held-feature',
  state: 'loaded',
  status: 'queued',
  hidden: null,
  repo: '/home/lyphe/.claude',
  goal: 'Show the pacer holding a feature',
  delivers: 'One card that says why the pacer is not letting it start',
  session: null,
  session_app_id: null,
  author: 'iris',
  arc: null,
  planner: null,
  model: 'claude',
  model_own: null,
  posture: 'claude route',
  queue_hold: null,
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T15:00:00Z',
  completed_at: null,
  prompted_at: null,
  paused: false,
  launched: false,
  stalled: null,
  approved: { at: '2026-10-20T14:00:00Z', by: 'operator' },
  accept_armed: null,
  design_loaded_at: '2026-10-20T13:00:00Z',
  asking: null,
  waits_on: [],
  schedule: null,
  cost_usd: 0,
  tokens: 0,
  tokens_in: 0,
  tokens_out: 0,
  tokens_cache_read: null,
  runtime_s: 0,
  rounds: 0,
  phases: [PHASE],
  events: [],
};

/** A card held by the pacer, by the queue, and one held by nothing — one of each, whole. */
export const HELD_CARD_FAKES: Record<'pace' | 'queue' | 'clear', DispatcherPlan> = {
  pace: { ...BASE_PLAN, name: 'held-by-pace', pace_hold: 'pace: no room on the 5-hour window — 93% used, 97% projected by 4:10 pm, ceiling 95%' },
  queue: { ...BASE_PLAN, name: 'held-by-queue', queue_hold: 'queue: at most 1 epics at once' },
  clear: { ...BASE_PLAN, name: 'held-by-nothing' },
};

/**
 * The pacer's picture (`route.pace`, interface VI) in its four states: holding new starts at a
 * ceiling it has passed, probing while no fresh reading has landed, pacing with room, and absent.
 * `null` is the document saying it has no picture; absent is a dispatcher older than the field —
 * both draw nothing.
 */
export const ROUTE_PACE_FAKES: Record<'holding' | 'probing' | 'room' | 'absent', DispatcherPace | null> = {
  holding: {
    account: '8badf00d',
    reading: { at: 1792501200, source: 'stream', fresh: true, rolled: false },
    five: { used: 0.93, projected: 0.97, ceiling: 0.95, resets_at: 1792537800 },
    week: { used: 0.61, projected: 0.72, ceiling: 0.95, resets_at: 1792998000 },
    probe: false,
    held: 2,
    opens_at: 1792537800,
    words: 'pace: no room on the 5-hour window — 93% used, 97% projected by 4:10 pm, ceiling 95%',
  },
  probing: {
    account: '8badf00d',
    reading: { at: null, source: '', fresh: false, rolled: false },
    five: null,
    week: null,
    probe: true,
    held: 0,
    opens_at: null,
    words: 'pace: one start at a time until a fresh reading lands',
  },
  room: {
    account: '8badf00d',
    reading: { at: 1792501200, source: 'meter', fresh: true, rolled: false },
    five: { used: 0.61, projected: 0.69, ceiling: 0.95, resets_at: 1792537800 },
    week: { used: 0.42, projected: 0.55, ceiling: 0.95, resets_at: 1792998000 },
    probe: false,
    held: 0,
    opens_at: null,
    words: 'pacing to 95% · 69% projected by 4:10 pm',
  },
  absent: null,
};

/** The pacer's picture the live master controller reads while this is a scaffold: empty, so no line draws. */
export const RoutePaceFakeContext = createContext<DispatcherPace | null>(null);

/** The scaffold's read of `route.pace` — the fill phase swaps it for the frame's own key. */
export function useRoutePaceFake(): DispatcherPace | null {
  return useContext(RoutePaceFakeContext);
}

/** The one pace hold the live card reads while this is a scaffold: empty, so no line draws. */
export const PlanPaceFakeContext = createContext<string>('');

/** The scaffold's read of `plan.pace_hold` — the fill phase swaps it for the plan's own key. */
export function usePlanPaceFake(): string {
  return useContext(PlanPaceFakeContext);
}
