// Her brows at the end of a question, in pure code. A question is the one place in her speech where an expression reliably belongs and
// where her mouth is closed, so the bake made one closed-mouth frame per mood with her brows lifted (`manifest.brows`).
//
// THE RULE, on a page that plays her voice: when the sentence that was sounding stops sounding (the player's progress no longer names
// it) and its text ends in a question mark, her brows lift. They hold until her next sentence starts sounding or 1200 ms pass; a sentence
// that follows at once leaves no time for the lift. The hold lives through the step from speaking to rest and ends at any other state.
// A page that plays no voice never has a sentence sounding, so it has no moment a question ends and shows none.
//
// The engine owns the clock and the frame: `read` says whether the brows are lifted now and the ms its hold ends at, which the engine
// returns in `nextAt`. Nothing here schedules a timer.

import type { FacePlaying } from '@/modules/companion/utils/faceMoodHold';
import type { CompanionPresenceState } from '@/shared/types';

/** A sentence's text ends in a question mark, which a closing quote, bracket or space may follow. Used by `faceBrows.ts` and `.verify`'s replay of the brows. */
export const QUESTION_END = /\?["'”’)\]\s]*$/;

/** How long the lift holds after the sentence stops sounding, ms. */
const BROW_HOLD_MS = 1200;

/** The states the lift lives in: speaking, where the question ended, and the states of rest the face passes to (the engine's resting states). */
const LIFT_STATES = new Set<CompanionPresenceState>(['speaking', 'idle', 'asleep', 'loading', 'walking']);

/** Used by `faceEngine.ts`: one per engine. */
export function createBrowHold(): {
  /** Whether her brows are lifted now: a sentence that ended in a question mark has just stopped sounding. `nextAt` is when the hold ends. */
  read(now: number, playing: FacePlaying | null, state: CompanionPresenceState): { lifted: boolean; nextAt: number | null };
} {
  // The text of the sentence sounding at the last step (null when none was), and when the lift began (null when none stands).
  let sounding: string | null = null;
  let liftedAt: number | null = null;

  return {
    read(now, playing, state) {
      if (playing !== null) {
        // Her next sentence is sounding: a lift ends, and the text is kept to see when this one stops.
        sounding = playing.text;
        liftedAt = null;
        return { lifted: false, nextAt: null };
      }
      if (sounding !== null) {
        if (QUESTION_END.test(sounding)) liftedAt = now;
        sounding = null;
      }
      if (liftedAt !== null && (!LIFT_STATES.has(state) || now >= liftedAt + BROW_HOLD_MS)) liftedAt = null;
      return liftedAt === null ? { lifted: false, nextAt: null } : { lifted: true, nextAt: liftedAt + BROW_HOLD_MS };
    },
  };
}
