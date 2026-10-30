// The random part of her face, from a seed: when she blinks and glances, and where. A seeded generator makes a replay of the
// same inputs draw the same blinks, so the engine can be run again on a recording and compared.

import type { CompanionFaceGaze } from '@/shared/companion-types';

/** A draw from [0, 1). */
type Random = () => number;

/** The eight directions her eyes may glance, in a fixed order so the same draw is the same glance. */
const GLANCES: readonly CompanionFaceGaze[] = ['left', 'right', 'up', 'down', 'up_left', 'up_right', 'down_left', 'down_right'];

/** What the eyes show at one moment of a blink: half closed, closed, or open between the two blinks of a double. */
type BlinkLook = 'half' | 'closed' | 'open';

/** A blink: 40 ms going to half, 50 ms closed, 40 ms coming back. A double blink is two of them 90 ms apart. */
const BLINK: ReadonlyArray<readonly [BlinkLook, number]> = [['half', 40], ['closed', 50], ['half', 40]];
const DOUBLE_BLINK_PAUSE_MS = 90;
/** The share of blinks that come twice. */
const DOUBLE_BLINK_SHARE = 0.15;
/** Between one blink and the next (ms). */
const BLINK_GAP_MS: readonly [number, number] = [2800, 6500];
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

const between = (random: Random, [low, high]: readonly [number, number]): number => low + random() * (high - low);

/** Used by `faceEngine.ts`: the wait before the next blink, ms. */
export const blinkGap = (random: Random): number => between(random, BLINK_GAP_MS);

/** Used by `faceEngine.ts`: the wait before the next glance, ms. */
export const glanceGap = (random: Random): number => between(random, GLANCE_GAP_MS);

/** Used by `faceEngine.ts`: where the next glance goes and how long it holds (ms). */
export function glanceOf(random: Random): { gaze: CompanionFaceGaze; holdMs: number } {
  return { gaze: GLANCES[Math.floor(random() * GLANCES.length)], holdMs: between(random, GLANCE_HOLD_MS) };
}

/** Used by `faceEngine.ts`: whether the next blink comes twice (15% do). */
export const blinkIsDoubled = (random: Random): boolean => random() < DOUBLE_BLINK_SHARE;

/** Used by `faceEngine.ts`: a blink's steps — one blink, or two with the eyes open between — as the look held and for how long (ms). */
export function blinkSteps(doubled: boolean): Array<readonly [BlinkLook, number]> {
  return doubled ? [...BLINK, ['open', DOUBLE_BLINK_PAUSE_MS], ...BLINK] : [...BLINK];
}

/** Used by `faceEngine.ts`: how long a blink's steps take, ms. */
export const blinkLength = (steps: ReadonlyArray<readonly [BlinkLook, number]>): number => steps.reduce((sum, [, ms]) => sum + ms, 0);

/** Used by `faceEngine.ts`: what the eyes show `sinceMs` into a blink and until when (ms into the blink), or null once it is over. */
export function blinkAt(steps: ReadonlyArray<readonly [BlinkLook, number]>, sinceMs: number): { look: BlinkLook; untilMs: number } | null {
  let end = 0;
  for (const [look, ms] of steps) {
    end += ms;
    if (sinceMs < end) return { look, untilMs: end };
  }
  return null;
}
