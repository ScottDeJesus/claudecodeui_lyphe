// The turn of her head toward what she is looking at, in pure code. The bake draws her turned in eight poses (a small and a
// larger turn left, right, up and down), so a turn is a direction and a level, and the head goes there one level at a time.

import type { CompanionFacePose } from '@/shared/companion-types';

/** Which way her head is turned (the screen's directions: `left` is toward the window's left edge) and how far: 0 facing forward, 1 the small turn, 2 the larger. */
export type Turn = { dir: 'left' | 'right' | 'up' | 'down' | null; level: 0 | 1 | 2 };

/** Facing forward. */
export const NO_TURN: Turn = { dir: null, level: 0 };

/** The anchor is this far from her (px) or nearer: the small turn. Farther, the larger. */
const NEAR_LOOK_PX = 160;

/**
 * Used by `faceEngine.ts`: the turn that faces `look`, the anchor's direction from her in screen pixels. The turn is yaw on the
 * larger axis and pitch otherwise, small under 160 px of distance and large beyond; a look at no distance is no turn.
 */
export function turnToward(look: { dx: number; dy: number } | null): Turn {
  if (look === null) return NO_TURN;
  const distance = Math.hypot(look.dx, look.dy);
  if (distance === 0) return NO_TURN;
  const level = distance < NEAR_LOOK_PX ? 1 : 2;
  if (Math.abs(look.dx) >= Math.abs(look.dy)) return { dir: look.dx < 0 ? 'left' : 'right', level };
  return { dir: look.dy < 0 ? 'up' : 'down', level };
}

/** Used by `faceEngine.ts`: whether two turns are the same pose. */
export const sameTurn = (a: Turn, b: Turn): boolean => a.dir === b.dir && a.level === b.level;

/** Used by `faceEngine.ts`: one level of the way from `turn` to `wanted`. A head turned the other way, or farther than wanted, comes back through the level below first. */
export function stepTurn(turn: Turn, wanted: Turn): Turn {
  if (turn.level > 0 && (turn.dir !== wanted.dir || turn.level > wanted.level)) {
    return turn.level === 1 ? NO_TURN : { dir: turn.dir, level: 1 };
  }
  if (turn.level < wanted.level) return { dir: wanted.dir, level: (turn.level + 1) as 1 | 2 };
  return turn;
}

/** Used by `faceEngine.ts`: the pose that draws a turned head (`left_10`, `up_5`); the turn must not be `NO_TURN`. Yaw is 10 and 20 degrees, pitch 5 and 10. */
export function poseOf(turn: Turn): CompanionFacePose {
  const degrees = turn.dir === 'left' || turn.dir === 'right' ? turn.level * 10 : turn.level * 5;
  return `${turn.dir}_${degrees}` as CompanionFacePose;
}
