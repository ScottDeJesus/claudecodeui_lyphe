// The warm spell at rest, in pure code: now and then her idle face eases to gentle, which adds a small smile and softer eyes to the
// photo's own, holds a few seconds, and eases back. It is the face of someone waiting beside him who is glad of it, so it is rare and
// short, never a loop he can see, and it belongs to one moment only: idle, with the mood neutral, no look held and no glance in play. A
// smile while she walks a result, or the moment she has turned from a held look, would read as a reaction to it.
//
// The engine owns the clock, the eligibility and the face: it draws her gentle `closed` face while `warm` and says when the spell
// begins and ends in `nextAt`. Nothing here schedules a timer.

import { between } from '@/modules/companion/utils/faceSchedule';
import type { Random } from '@/modules/companion/utils/faceSchedule';

/** The wait from one spell's end to the next, and how long a spell holds, ms. */
const WARM_EVERY_MS: readonly [number, number] = [25000, 60000];
const WARM_HOLD_MS: readonly [number, number] = [3000, 6000];
/**
 * A spell that fell due waits this long for her face to be eligible (a glance holds up to 1.1 s) and lapses after it, drawn again from when it was due, on
 * whichever step finds it that late: a held look that outlasts the date, a page waking from sleep or reduced motion turned off begins no smile at once.
 */
const WARM_WAIT_MS = 2000;

/**
 * Used by `faceEngine.ts`: one per engine state, so a change of state ends a spell and starts the count again. The count begins the
 * first time the face is eligible, and a face that never is (a face made before `blinks`, or any state but idle) draws nothing.
 */
export function createWarmth(random: Random): {
  /** The warm spell at rest: whether her idle face wears gentle now, and when that changes. `eligible` is whether her face is the idle one a spell may wear. */
  read(now: number, eligible: boolean): { warm: boolean; nextAt: number | null };
} {
  // When the next spell is due (null until the face is first eligible) and, while one is in play, when it ends.
  let startsAt: number | null = null;
  let endsAt: number | null = null;

  return {
    read(now, eligible) {
      // A spell is over at its end, or the moment her face stops being the idle one.
      if (endsAt !== null && (!eligible || now >= endsAt)) {
        startsAt = Math.min(now, endsAt) + between(random, WARM_EVERY_MS);
        endsAt = null;
      }
      if (eligible && startsAt === null) startsAt = now + between(random, WARM_EVERY_MS);
      while (endsAt === null && startsAt !== null && startsAt + WARM_WAIT_MS < now) startsAt += between(random, WARM_EVERY_MS);
      if (eligible && endsAt === null && startsAt !== null && now >= startsAt) endsAt = now + between(random, WARM_HOLD_MS);
      if (endsAt !== null) return { warm: true, nextAt: endsAt };
      return { warm: false, nextAt: startsAt !== null && startsAt > now ? startsAt : null };
    },
  };
}
