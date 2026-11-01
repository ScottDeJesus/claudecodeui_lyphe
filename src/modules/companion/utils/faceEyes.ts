// Where her eyes are while she looks somewhere with her head still, in pure code: transcribing looks down, drafting down and right,
// the reading states sweep between down-left and down-right, and thinking and waking SEARCH, as people look up and aside while they
// reach for something instead of holding one point. Every gaze is a frame the bake already made, so none of this costs a frame.
//
// The engine owns the clock and the blink a move may carry: `gaze` answers where her eyes are wanted and the next ms it wants a call
// at (their next move), and the engine lands each move now or under the closed step of a blink. Nothing here schedules a timer.

import { between } from '@/modules/companion/utils/faceSchedule';
import type { Random } from '@/modules/companion/utils/faceSchedule';
import type { CompanionFaceGaze } from '@/shared/companion-types';
import type { CompanionPresenceState } from '@/shared/types';

/** Where her eyes are for the states that look somewhere, head still. Thinking and waking begin their search here, and keep it when they may not search. */
const EYES_OF_STATE: Partial<Record<CompanionPresenceState, CompanionFaceGaze>> = {
  transcribing: 'down', thinking: 'up_right', waking: 'up_right', drafting: 'down_right', reading_session: 'down_right', reading_code: 'down_right',
};
/** The reading states' sweep: one cycle (down-left, down-right) takes this long, ms. */
const SWEEP_CYCLE_MS: Partial<Record<CompanionPresenceState, number>> = { reading_session: 4400, reading_code: 2600 };
/** The states whose eyes search, and where they look in turn: up and aside, the way people look while they reach for a memory. */
const SEARCHING = new Set<CompanionPresenceState>(['thinking', 'waking']);
const SEARCH_GAZES: readonly CompanionFaceGaze[] = ['up_right', 'up', 'up_left', 'right'];
/** How long her eyes rest on one place of the search before they move to another, ms. */
const SEARCH_HOLD_MS: readonly [number, number] = [1200, 2600];

/** The search in play: where her eyes are on it, when they move on, and the state it began in. */
type Search = { gaze: CompanionFaceGaze; movesAt: number; since: number };

/**
 * Used by `faceEngine.ts`: one per engine. `searches` is false for a face made before `blinks`, whose thinking keeps its one look and
 * draws nothing from `random`; the reading sweep belongs to every face.
 */
export function createStateEyes(random: Random, searches = true): {
  /**
   * Where her eyes are for a state that looks somewhere with her head still, at `now`: the reading sweep, thinking's search, or the
   * state's one gaze; null for a state with none. `nextAt` is when they next move. `since` is when the state began, which the sweep
   * counts from and the search restarts on. `still` is reduced motion or a look held: her eyes stay where the state puts them.
   */
  gaze(now: number, state: CompanionPresenceState, since: number, still: boolean): { gaze: CompanionFaceGaze; nextAt: number | null } | null;
} {
  let search: Search | null = null;

  return {
    gaze(now, state, since, still) {
      const resting = EYES_OF_STATE[state];
      if (resting === undefined) return null;
      const sweepCycle = SWEEP_CYCLE_MS[state];
      if (sweepCycle !== undefined && !still) {
        const half = sweepCycle / 2;
        const sweeps = Math.floor((now - since) / half);
        return { gaze: sweeps % 2 === 0 ? 'down_left' : 'down_right', nextAt: since + (sweeps + 1) * half };
      }
      if (!SEARCHING.has(state) || !searches || still) {
        search = null; // the next search begins again where the state looks
        return { gaze: resting, nextAt: null };
      }
      if (search === null || search.since !== since) search = { gaze: resting, movesAt: now + between(random, SEARCH_HOLD_MS), since };
      // A move that fell due while no one asked (the page was hidden) is made now, so the search is the same however often the page steps.
      const here = search;
      while (here.movesAt <= now) {
        const others = SEARCH_GAZES.filter((candidate) => candidate !== here.gaze);
        here.gaze = others[Math.floor(random() * others.length)];
        here.movesAt += between(random, SEARCH_HOLD_MS);
      }
      return { gaze: here.gaze, nextAt: here.movesAt };
    },
  };
}
