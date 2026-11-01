// The random part of her face, from a seed: when she blinks and glances, and where. A seeded generator makes a replay of the
// same inputs draw the same blinks, so the engine can be run again on a recording and compared.

import type { CompanionFaceGaze } from '@/shared/companion-types';
import type { CompanionPresenceState } from '@/shared/types';

/** A draw from [0, 1). */
export type Random = () => number;

/** The eight directions her eyes may glance, in a fixed order so the same draw is the same glance. */
const GLANCES: readonly CompanionFaceGaze[] = ['left', 'right', 'up', 'down', 'up_left', 'up_right', 'down_left', 'down_right'];

/** What the eyes show at one moment of a blink: half closed, closed, or open between the two blinks of a double. */
type BlinkLook = 'half' | 'closed' | 'open';

/** A blink: 40 ms going to half, 50 ms closed, 40 ms coming back. A double blink is two of them 90 ms apart. */
const BLINK: ReadonlyArray<readonly [BlinkLook, number]> = [['half', 40], ['closed', 50], ['half', 40]];
const DOUBLE_BLINK_PAUSE_MS = 90;
/** The share of blinks that come twice. */
const DOUBLE_BLINK_SHARE = 0.15;
/** Between one blink and the next at rest (ms), and the one range a face made before `blinks` keeps for every state. */
const REST_GAP_MS: readonly [number, number] = [2800, 6500];
const THINKING_GAP_MS: readonly [number, number] = [2200, 5000];
const LOOKING_GAP_MS: readonly [number, number] = [4500, 9000];
/**
 * The gap after a blink in each state, ms; failed and cut have none. People blink most in conversation and least while reading:
 * speaking and listening are quicker than rest, thinking and waking a little, and the states whose eyes are on a task (transcribing,
 * the reading states, drafting) the slowest.
 */
export const BLINK_GAP_BY_STATE: Readonly<Partial<Record<CompanionPresenceState, readonly [number, number]>>> = {
  idle: REST_GAP_MS, asleep: REST_GAP_MS, loading: REST_GAP_MS, walking: REST_GAP_MS,
  speaking: [2000, 4500], listening: [2500, 5500], thinking: THINKING_GAP_MS, waking: THINKING_GAP_MS,
  transcribing: LOOKING_GAP_MS, reading_session: LOOKING_GAP_MS, reading_code: LOOKING_GAP_MS, drafting: LOOKING_GAP_MS,
};
/** Between one glance and the next (ms), and how long a glance holds. */
const GLANCE_GAP_MS: readonly [number, number] = [5000, 11000];
const GLANCE_HOLD_MS: readonly [number, number] = [500, 1100];

/** Used by `faceEngine.ts`: a small, fast generator (mulberry32) from a seed; the same seed gives the same line of draws. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Used by `faceEyes.ts` and `faceWarmth.ts`, and by this file's own gaps: a draw from `range`, ms. */
export const between = (random: Random, [low, high]: readonly [number, number]): number => low + random() * (high - low);

/** Used by `faceBlink.ts`: the wait before the next blink in `state`, ms; a state with no range (failed, cut) takes the rest range. */
export const blinkGap = (random: Random, state: CompanionPresenceState): number => between(random, BLINK_GAP_BY_STATE[state] ?? REST_GAP_MS);

/** Used by `faceEngine.ts`: the wait before the next glance, ms. */
export const glanceGap = (random: Random): number => between(random, GLANCE_GAP_MS);

/** Used by `faceEngine.ts`: where the next glance goes and how long it holds (ms). */
export function glanceOf(random: Random): { gaze: CompanionFaceGaze; holdMs: number } {
  return { gaze: GLANCES[Math.floor(random() * GLANCES.length)], holdMs: between(random, GLANCE_HOLD_MS) };
}

/** Used by `faceBlink.ts`: whether the next blink comes twice (15% do). */
export const blinkIsDoubled = (random: Random): boolean => random() < DOUBLE_BLINK_SHARE;

/** Used by `faceBlink.ts`: a blink's steps — one blink, or two with the eyes open between — as the look held and for how long (ms). */
export function blinkSteps(doubled: boolean): Array<readonly [BlinkLook, number]> {
  return doubled ? [...BLINK, ['open', DOUBLE_BLINK_PAUSE_MS], ...BLINK] : [...BLINK];
}

/** Used by `faceBlink.ts`: how long a blink's steps take, ms. */
export const blinkLength = (steps: ReadonlyArray<readonly [BlinkLook, number]>): number => steps.reduce((sum, [, ms]) => sum + ms, 0);

/** Used by `faceBlink.ts`: what the eyes show `sinceMs` into a blink and until when (ms into the blink), or null once it is over. */
export function blinkAt(steps: ReadonlyArray<readonly [BlinkLook, number]>, sinceMs: number): { look: BlinkLook; untilMs: number } | null {
  let end = 0;
  for (const [look, ms] of steps) {
    end += ms;
    if (sinceMs < end) return { look, untilMs: end };
  }
  return null;
}
