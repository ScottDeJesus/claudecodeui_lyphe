// Her head's motion while she speaks, in pure code, in the picture's plane only. Her speaking frames face forward ("she faces forward and her
// mouth moves": no frame has an open mouth on a turned head), so a nod and a roll are the head movement she can honestly make while she
// talks, and none of it needs a frame. The engine steps it (`faceEngine.ts`); the portrait writes what it answers as two variables that the
// stylesheet turns into the layer's own `translate` and `rotate`.
//
// FOUR THINGS MOVE HER HEAD, added together: THE BREATH IN, drawn as each sentence starts sounding (a lift that peaks 250 ms in and settles
// over 700 ms; a sentence that begins with a clip has the clip as its cue and draws none); THE LIFT, her head rising with her voice's
// strength; A BEAT on each stressed onset, a nod down with a small roll that alternates sides; and THE DRIFT, a slow roll. While the breath in
// lasts it takes the lift's place, so it peaks at its own size however loud the sentence opens. The sum is held to ±0.9% and ±1.8°, and eases
// to rest over 300 ms once she stops speaking, when the answer is null. Under reduced motion it is always null.
//
// Her voice's level is the only input (read on every step she speaks, with or without the exact mouth's pieces), so a page that plays no
// voice draws no head. The one random part, the side of the first roll and where the drift begins, is drawn from this file's own generator.

import { HALF_OPEN_AT } from '@/modules/companion/utils/faceMouth';
import { createRandom } from '@/modules/companion/utils/faceSchedule';

/** Her head's in-plane motion while she speaks: `bob` in % of the layer (positive is down), `roll` in degrees (positive is clockwise). Null at rest. */
export type FaceHead = { bob: number; roll: number };

type HeadInput = {
  now: number; speaking: boolean; level: number; freshSentence: boolean; clipStarted: boolean; reducedMotion: boolean;
};

// The envelope of her voice: the level followed with an attack and a release, and its slow average, both in ms. Her strength is the
// envelope's height above the mouth's own closed threshold, over the span to a strong voice.
const ATTACK_MS = 50;
const RELEASE_MS = 220;
const SLOW_MS = 1200;
const STRENGTH_SPAN = 0.2;
/** How far her head rises at full strength, % of the layer. */
const LIFT_PCT = 0.5;
// A beat: the envelope passes BEAT_RATIO times its slow average and BEAT_FLOOR, at least BEAT_GAP_MS after the last beat (or the sentence's start,
// which the breath in or a clip owns). The nod goes down NOD_PCT in NOD_IN_MS and comes back in NOD_OUT_MS; the roll rises with it and is over in BEAT_ROLL_MS.
const BEAT_RATIO = 1.5;
const BEAT_FLOOR = 0.08;
const BEAT_GAP_MS = 320;
const NOD_PCT = 0.7;
const NOD_IN_MS = 90;
const NOD_OUT_MS = 260;
const BEAT_ROLL_DEG = 0.7;
const BEAT_ROLL_MS = 450;
// The drift: a roll on a slow sine. A new sentence moves its phase by up to a quarter turn either way; the move is spread over DRIFT_RETUNE_MS,
// since a phase set outright would snap the roll by up to 1° in a frame.
const DRIFT_DEG = 1.0;
const DRIFT_PERIOD_MS = 3400;
const DRIFT_RETUNE_MS = 1200;
// The breath in: a lift of BREATH_PCT, peaking BREATH_IN_MS after the sentence starts sounding and settled BREATH_OUT_MS later.
const BREATH_PCT = 0.6;
const BREATH_IN_MS = 250;
const BREATH_OUT_MS = 700;
// The bounds on the sum, and how long she takes to come to rest once she stops speaking.
const BOB_LIMIT_PCT = 0.9;
const ROLL_LIMIT_DEG = 1.8;
const SETTLE_MS = 300;
/** A weight under this is at rest: stepping 300 ms of frames leaves float dust above 0, which would hold a frame past the settle. */
const AT_REST_WEIGHT = 1e-6;
/** Mixed into the seed so this file's draws are not the engine's own line of draws over again. */
const HEAD_SEED_SALT = 0x68656164;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
/** An ease from 0 to 1 over `x` from 0 to 1, flat at both ends. */
const smooth = (x: number): number => x * x * (3 - 2 * x);

/** 0 to 1 over `riseMs`, then back to 0 over `fallMs`, each eased, a peak of 1 at `riseMs`; 0 before and after. */
function pulse(sinceMs: number, riseMs: number, fallMs: number): number {
  if (sinceMs < 0 || sinceMs >= riseMs + fallMs) return 0;
  return sinceMs < riseMs ? smooth(sinceMs / riseMs) : 1 - smooth((sinceMs - riseMs) / fallMs);
}

/** Used by `faceEngine.ts`: one head per engine. `step` reads her voice's level on each step she speaks and answers her head now, or null once at rest. */
export function createHeadMotion(seed: number): { step(input: HeadInput): FaceHead | null } {
  const random = createRandom(seed ^ HEAD_SEED_SALT);
  // Whether the head moves (she speaks, or is settling) or is at rest, and the time of the last step.
  let awake = false;
  let lastAt = 0;
  // How much of the motion shows: 1 while she speaks, running down to 0 over SETTLE_MS once she stops, and back up if she speaks again meanwhile.
  let weight = 1;
  // The voice's envelope and its slow average, whether the envelope was over the beat's threshold at the last step, and when a beat may next fall.
  let followed = 0;
  let slow = 0;
  let wasAbove = false;
  let quietUntil = 0;
  // The beats still moving (each with the side it rolls to), and the side the next one takes.
  const beats: Array<{ at: number; side: 1 | -1 }> = [];
  let nextSide: 1 | -1 = 1;
  // When the breath in began (null: none moving); the drift's phase and the part of a new sentence's move of it still to make.
  let breathAt: number | null = null;
  let phase = 0;
  let retune = 0;

  return {
    step({ now, speaking, level, freshSentence, clipStarted, reducedMotion }) {
      if (reducedMotion || (!awake && !speaking)) {
        awake = false;
        return null;
      }
      let woke = false;
      if (!awake) {
        // She starts from level: the drift begins at a zero of its sine (rising or falling), so her roll leaves rest without a snap.
        awake = true;
        woke = true;
        weight = 1;
        lastAt = now;
        followed = 0;
        slow = 0;
        wasAbove = false;
        quietUntil = now;
        beats.length = 0;
        breathAt = null;
        retune = 0;
        phase = random() < 0.5 ? 0 : Math.PI;
        nextSide = random() < 0.5 ? -1 : 1;
      }
      const elapsedMs = Math.max(0, now - lastAt);
      lastAt = now;

      // Her voice's envelope: quick to rise, slower to fall. Once she has stopped it hears nothing and runs down.
      const heard = speaking && Number.isFinite(level) ? level : 0;
      followed += (heard - followed) * (1 - Math.exp(-elapsedMs / (heard > followed ? ATTACK_MS : RELEASE_MS)));
      slow += (followed - slow) * (1 - Math.exp(-elapsedMs / SLOW_MS));
      const strength = clamp((followed - HALF_OPEN_AT) / STRENGTH_SPAN, 0, 1);

      if (speaking && freshSentence) {
        if (!clipStarted) breathAt = now;
        quietUntil = now + BEAT_GAP_MS;
        if (!woke) retune += (random() - 0.5) * Math.PI;
      }
      // A beat falls where the envelope crosses upward over its threshold, not on every step it stays over.
      const above = followed > Math.max(BEAT_RATIO * slow, BEAT_FLOOR);
      if (speaking && above && !wasAbove && now >= quietUntil) {
        beats.push({ at: now, side: nextSide });
        nextSide = nextSide === 1 ? -1 : 1;
        quietUntil = now + BEAT_GAP_MS;
      }
      wasAbove = above;
      while (beats.length > 0 && now - beats[0].at >= BEAT_ROLL_MS) beats.shift();
      let nod = 0;
      let beatRoll = 0;
      for (const beat of beats) {
        nod += NOD_PCT * pulse(now - beat.at, NOD_IN_MS, NOD_OUT_MS);
        beatRoll += beat.side * BEAT_ROLL_DEG * pulse(now - beat.at, NOD_IN_MS, BEAT_ROLL_MS - NOD_IN_MS);
      }

      const move = retune * (1 - Math.exp(-elapsedMs / DRIFT_RETUNE_MS));
      retune -= move;
      phase += (2 * Math.PI * elapsedMs) / DRIFT_PERIOD_MS + move;

      // The breath in takes the lift's place while it lasts, and gives it back as it settles.
      const breath = breathAt === null ? 0 : pulse(now - breathAt, BREATH_IN_MS, BREATH_OUT_MS);
      if (breathAt !== null && now - breathAt >= BREATH_IN_MS + BREATH_OUT_MS) breathAt = null;
      const rise = BREATH_PCT * breath + LIFT_PCT * strength * (1 - breath);

      weight = clamp(weight + (speaking ? elapsedMs : -elapsedMs) / SETTLE_MS, 0, 1);
      if (!speaking && weight < AT_REST_WEIGHT) {
        awake = false;
        return null;
      }
      const shown = smooth(weight);
      return {
        bob: clamp(shown * (nod - rise), -BOB_LIMIT_PCT, BOB_LIMIT_PCT),
        roll: clamp(shown * (DRIFT_DEG * Math.sin(phase) + beatRoll), -ROLL_LIMIT_DEG, ROLL_LIMIT_DEG),
      };
    },
  };
}
