// The engine of her face, in pure code: THE PAGE IS A PLAYER, NOT A PAINTER. The bake made her face once, as frames; this
// picks which frame the page shows, and what crossfades, moves and tilts, from her state, her voice, her mood, her sounds and
// her look. It touches no browser, so `tsx` replays it on a recorded turn and prints what the page would have drawn.
//
// ONE ENGINE PLAYS ONE MANIFEST: `createFaceEngine(manifest, seed)`, and a new face is a new engine. The page calls `step`
// when something changes and, while she speaks or a crossfade, clip or turn runs, on every animation frame; `nextAt` is the
// next moment (the caller's clock) the engine wants a call at when nothing else would change it, and null when nothing does.
// A blink, a glance and the mood's hold are deadlines like that. Blinks and glances come from the seeded random.
//
// WHAT EACH STATE DRAWS. idle, asleep, loading and walking: neutral (or the mood still held), blinking and glancing.
// listening: her listening face, leaning toward the sound, with a nod as the press begins. transcribing: eyes down.
// thinking and waking: eyes up and away, leaning; drafting: eyes down and right, leaning. speaking: the sentence's mood, her
// mouth on her voice. reading_session and reading_code: her eyes sweeping between down-left and down-right, one cycle each 4.4 s
// and 2.6 s. cut: the surprised face with one quick blink. failed: her stopped face, still. While a look holds, every state but
// those with a face of their own (listening, transcribing, speaking, cut, failed) turns her head toward the anchor instead.
//
// REDUCED MOTION keeps every look and drops the movement: no motion, though a state's tilt stands; frames swap with no
// crossfade; no blink, glance, sweep or clip; a look shows its final turn at once; speaking holds the mood's half-open "ah".

import { createClipPlayer } from '@/modules/companion/utils/faceClipPlayer';
import { nodClip } from '@/modules/companion/utils/faceClips';
import type { FaceMotion } from '@/modules/companion/utils/faceClips';
import { createFader } from '@/modules/companion/utils/faceFader';
import { moodTilt } from '@/modules/companion/utils/faceMoodMap';
import { createMoodHold } from '@/modules/companion/utils/faceMoodHold';
import type { FacePlaying } from '@/modules/companion/utils/faceMoodHold';
import { MOUTH_CLOSED, mouthOpenness, soundAt, vowelAt } from '@/modules/companion/utils/faceMouth';
import type { MouthVowel } from '@/modules/companion/utils/faceMouth';
import {
  blinkAt, blinkGap, blinkIsDoubled, blinkLength, blinkSteps, createRandom, glanceGap, glanceOf,
} from '@/modules/companion/utils/faceSchedule';
import { NO_TURN, poseOf, sameTurn, stepTurn, turnToward } from '@/modules/companion/utils/faceTurn';
import type { Turn } from '@/modules/companion/utils/faceTurn';
import type { CompanionFaceGaze, CompanionFaceManifest, CompanionFaceMouth } from '@/shared/companion-types';
import type { CompanionPresenceState } from '@/shared/types';

/** Everything the engine reads, each step. Times are ms on one steady clock, spans are seconds. */
export type FaceInput = {
  now: number;
  presence: CompanionPresenceState;
  /** The player's `level()`, 0..1; read only while she speaks. */
  level: number;
  /** The sentence the player is sounding, with seconds elapsed in it and its length once its body has ended (else null); null when none sounds, and always on a page that plays no voice. Its mood is read as it starts sounding. */
  playing: FacePlaying | null;
  /**
   * For a page that plays no voice: the mood word of the newest sentence of her running turn, read as it arrives — `''` when that
   * sentence has no mood word (it is neutral, and clears the face of the sentence before). Null means nothing to read: no sentence
   * has arrived yet, and always on a page that plays her voice, which takes the mood from `playing` as the sentence starts. A caller
   * handing a log row's `mood` through turns its null into `''` once the row has arrived.
   */
  newestMood: string | null;
  turnRunning: boolean;
  /** Where the anchor she looks at lies from her, in screen pixels; null when no look holds. */
  look: { dx: number; dy: number } | null;
  reducedMotion: boolean;
};

/** What the page draws: `base` whole with `over` (frame indices into the manifest) on top at `alpha` (null and 0 when nothing fades), the one-shot `motion` its stylesheet plays, the lean in degrees, and the next ms the engine wants a call at (null for none). */
export type FaceDraw = { base: number; over: number | null; alpha: number; motion: FaceMotion | null; tilt: number; nextAt: number | null };

const MOUTH_FADE_MS = 60;
const MOOD_FADE_MS = 180;
const STEP_FADE_MS = 140;
const EASE_TO_NEUTRAL_MS = 300;
const CUT_BLINK_AFTER_MS = 250;

/** The states of a plain face: it blinks, glances, and turns toward a look. */
const RESTING = new Set<CompanionPresenceState>(['idle', 'asleep', 'loading', 'walking']);
/** The states whose face a held look replaces with a turned head. */
const TURNABLE = new Set<CompanionPresenceState>([...RESTING, 'thinking', 'waking', 'drafting', 'reading_session', 'reading_code']);
/** Where her eyes are for the states that look somewhere, head still. */
const EYES_OF_STATE: Partial<Record<CompanionPresenceState, CompanionFaceGaze>> = {
  transcribing: 'down', thinking: 'up_right', waking: 'up_right', drafting: 'down_right', reading_session: 'down_right', reading_code: 'down_right',
};
/** The reading states' sweep: one cycle (down-left, down-right) takes this long, ms. */
const SWEEP_CYCLE_MS: Partial<Record<CompanionPresenceState, number>> = { reading_session: 4400, reading_code: 2600 };
/** The lean of a state, degrees clockwise. A state without one takes its mood's. */
const STATE_TILT: Partial<Record<CompanionPresenceState, number>> = { listening: -5, thinking: 3, waking: 3, drafting: 3 };

/**
 * Used by the portrait and by `.verify`'s replay: every frame's name in the bake's convention, by index —
 * `mood.<mood>.<mouth>`, `blink.<mood>.half` and `.closed`, `gaze.<gaze>`, `pose.<pose>`, `state.listening`, `state.failed`,
 * `state.surprise` and `clip.<clip>.<n>`. A frame two things point at keeps the first name; one nothing points at is `frame.<n>`.
 * A clip's own frames are numbered from 0 without the frames another table already names: the gasp's playlist is
 * `clip.gasp.0`, `state.surprise`, `clip.gasp.1`, as the bake names them.
 */
export function frameNames(manifest: CompanionFaceManifest): string[] {
  const names = manifest.frames.map((_, index) => `frame.${index}`);
  const claimed = new Set<number>();
  const claim = (index: number, name: string) => {
    if (claimed.has(index)) return;
    claimed.add(index);
    names[index] = name;
  };
  for (const [mood, face] of Object.entries(manifest.moods)) {
    for (const [mouth, index] of Object.entries(face.mouths)) claim(index, `mood.${mood}.${mouth}`);
    claim(face.blink.half, `blink.${mood}.half`);
    claim(face.blink.closed, `blink.${mood}.closed`);
  }
  for (const [gaze, index] of Object.entries(manifest.gaze)) claim(index, `gaze.${gaze}`);
  for (const [pose, index] of Object.entries(manifest.poses)) claim(index, `pose.${pose}`);
  for (const [state, index] of Object.entries(manifest.states)) claim(index, `state.${state}`);
  for (const [clip, { frames }] of Object.entries(manifest.clips)) {
    let n = 0;
    for (const index of frames) {
      if (claimed.has(index)) continue;
      claim(index, `clip.${clip}.${n}`);
      n += 1;
    }
  }
  return names;
}

/** Used by the portrait: one engine for one face. */
export function createFaceEngine(manifest: CompanionFaceManifest, seed: number): { step(input: FaceInput): FaceDraw } {
  const random = createRandom(seed);
  const fader = createFader();
  const moodHold = createMoodHold();
  const clips = createClipPlayer(manifest);
  const { moods, gaze, states } = manifest;

  // The presence last drawn and when it began, so a change is seen, and the sweep and the cut's blink count from it.
  let state: CompanionPresenceState | null = null;
  let stateSince = 0;
  // The mouth shown (its dwell needs when it changed) and the vowel it shapes, kept for a step with no sentence.
  let mouth = MOUTH_CLOSED;
  let vowel: MouthVowel = 'a';
  // The blink in play, when the next one is due, and whether the cut's one blink has been made.
  let blink: { startedAt: number; steps: ReturnType<typeof blinkSteps> } | null = null;
  let nextBlinkAt: number | null = null;
  let cutBlinked = false;
  // Whether the face of the last step had blink frames and glance frames (and motion on): a deadline that fell due while it had none lapsed.
  let couldBlink = false;
  let couldGlance = false;
  // When the 180 ms (or 300 ms) crossfade of a new state or mood ends: a frame that changes inside it joins it and ends with it.
  let bigFadeEndsAt = 0;
  // The glance in play (its frame and end) and when the next is due.
  let glance: { frame: number; endsAt: number } | null = null;
  let nextGlanceAt = 0;
  // The head's turn as shown, and when it may move one level on.
  let turn: Turn = NO_TURN;
  let turnStepAt = 0;

  function enterState(next: CompanionPresenceState, now: number, reduced: boolean): void {
    state = next;
    stateSince = now;
    blink = null;
    glance = null;
    clips.clear();
    cutBlinked = false;
    mouth = MOUTH_CLOSED;
    if (!TURNABLE.has(next)) turn = NO_TURN;
    if (next === 'listening' && !reduced) clips.play(nodClip(manifest), now);
  }

  function step(input: FaceInput): FaceDraw {
    const { now, presence, reducedMotion: reduced } = input;
    const deadlines: number[] = [];
    const wantAt = (time: number | null) => {
      if (time !== null && time > now) deadlines.push(time);
    };
    if (nextBlinkAt === null) {
      nextBlinkAt = now + blinkGap(random);
      nextGlanceAt = now + glanceGap(random);
    }
    // A blink or glance that fell due while the face had none lapsed. It is renewed from when it was due, earliest first, so the
    // schedule is the same however often the page stepped through the wait (a page that steps only on `nextAt` does not step in it).
    for (;;) {
      const blinkLapsed = !couldBlink && nextBlinkAt <= now;
      const glanceLapsed = !couldGlance && nextGlanceAt <= now;
      if (blinkLapsed && (!glanceLapsed || nextBlinkAt <= nextGlanceAt)) nextBlinkAt += blinkGap(random);
      else if (glanceLapsed) nextGlanceAt += glanceGap(random);
      else break;
    }
    const presenceChanged = presence !== state;
    if (presenceChanged) enterState(presence, now, reduced);
    const inBlinkAtStart = blink !== null;
    const { move: moodMove, freshSentence } = moodHold.read(input);
    const mood = moodHold.mood();
    if (freshSentence) clips.newSentence();
    if (reduced) {
      clips.clear();
      blink = null;
      glance = null;
    }

    // THE MOUTH, while she speaks: its openness from the voice's level, its vowel from the text at the audio's place.
    const speaking = presence === 'speaking';
    const playing = input.playing;
    let mouthKey: CompanionFaceMouth = 'a1';
    if (speaking && !reduced) {
      mouth = mouthOpenness(input.level, mouth, now);
      if (playing !== null) vowel = vowelAt(playing.text, playing.sounds, playing.elapsed, playing.duration);
      mouthKey = mouth.openness === 'closed' ? 'closed' : (`${vowel}${mouth.openness === 'half' ? 1 : 2}` as CompanionFaceMouth);
    }

    // THE SOUNDS: a sound's clip plays when the audio reaches its place.
    clips.advance(now);
    if (speaking && !reduced && playing !== null) clips.hear(soundAt(playing.text, playing.sounds, playing.elapsed, playing.duration), now);
    if (clips.playing()) blink = null;

    // THE TURN toward a look, one level every 140 ms (all at once under reduced motion).
    const turnable = TURNABLE.has(presence);
    const wantedTurn = turnable ? turnToward(input.look) : NO_TURN;
    if (reduced || !turnable) {
      turn = wantedTurn;
    } else if (!sameTurn(turn, wantedTurn) && now >= turnStepAt) {
      turn = stepTurn(turn, wantedTurn);
      turnStepAt = now + STEP_FADE_MS;
    }
    if (!sameTurn(turn, wantedTurn)) wantAt(turnStepAt);
    const turned = turn.level > 0;
    const lookHeld = wantedTurn.level > 0;

    // A step that changes the state or the mood starts that crossfade; no blink or glance cuts into it.
    const settled = !presenceChanged && moodMove === 'same';

    // THE BLINK waits for a closed mouth and a still face; one that falls due in a face with no blink frames lapses (above, next step).
    if (blink !== null && blinkAt(blink.steps, now - blink.startedAt) === null) blink = null;
    if (presence === 'cut' && !reduced && !cutBlinked && blink === null && now - stateSince >= CUT_BLINK_AFTER_MS && !fader.fading(now)) {
      cutBlinked = true;
      blink = { startedAt: now, steps: blinkSteps(false) };
    }
    const hasBlinkFrames = !reduced && (RESTING.has(presence) || speaking);
    const free = settled && blink === null && glance === null && !clips.playing() && !turned && !lookHeld && !fader.fading(now);
    if (hasBlinkFrames && nextBlinkAt <= now && free && (!speaking || mouth.openness === 'closed')) {
      const steps = blinkSteps(blinkIsDoubled(random));
      blink = { startedAt: now, steps };
      nextBlinkAt = now + blinkLength(steps) + blinkGap(random);
    }

    // THE GLANCE, in a plain face with a neutral mood.
    if (glance !== null && now >= glance.endsAt) glance = null;
    const hasGlanceFrames = !reduced && RESTING.has(presence);
    if (hasGlanceFrames && nextGlanceAt <= now && glance === null && settled && blink === null && !turned && !lookHeld && mood === 'neutral' && !fader.fading(now)) {
      const { gaze: direction, holdMs } = glanceOf(random);
      glance = { frame: gaze[direction], endsAt: now + holdMs };
      nextGlanceAt = glance.endsAt + glanceGap(random);
    }
    couldBlink = hasBlinkFrames;
    couldGlance = hasGlanceFrames;

    // WHICH FRAME. Each branch also says how long a change into it crossfades.
    const blinkNow = blink === null ? null : blinkAt(blink.steps, now - blink.startedAt);
    const blinkFrames = presence === 'cut' ? moods.neutral.blink : moods[mood].blink;
    const stillFrame = presence === 'cut' ? states.surprise : moods[mood].mouths.closed;
    let blinkFrame: number | null = null;
    if (blink !== null && blinkNow !== null) {
      blinkFrame = blinkNow.look === 'half' ? blinkFrames.half : blinkNow.look === 'closed' ? blinkFrames.closed : stillFrame;
      wantAt(blink.startedAt + blinkNow.untilMs);
    }
    const clipShown = clips.frame(now);
    clips.deadlines(now).forEach(wantAt);

    let frame: number;
    let fadeMs = STEP_FADE_MS;
    if (presence === 'failed') {
      frame = states.failed;
    } else if (presence === 'cut') {
      frame = blinkFrame ?? states.surprise;
      if (!cutBlinked && !reduced) wantAt(stateSince + CUT_BLINK_AFTER_MS);
    } else if (presence === 'listening') {
      frame = clipShown ?? states.listening;
      fadeMs = MOUTH_FADE_MS;
    } else if (speaking) {
      frame = clipShown ?? blinkFrame ?? moods[mood].mouths[mouthKey];
      fadeMs = MOUTH_FADE_MS;
    } else if (turned) {
      frame = manifest.poses[poseOf(turn)];
    } else if (EYES_OF_STATE[presence] !== undefined) {
      const sweepCycle = SWEEP_CYCLE_MS[presence];
      if (sweepCycle !== undefined && !reduced && !lookHeld) {
        const half = sweepCycle / 2;
        const sweeps = Math.floor((now - stateSince) / half);
        frame = gaze[sweeps % 2 === 0 ? 'down_left' : 'down_right'];
        wantAt(stateSince + (sweeps + 1) * half);
      } else {
        frame = gaze[EYES_OF_STATE[presence] as CompanionFaceGaze];
      }
    } else {
      // A plain face: its mood's, or a glance.
      frame = blinkFrame ?? glance?.frame ?? moods[mood].mouths.closed;
      if (glance !== null) wantAt(glance.endsAt);
      if (!reduced) {
        if (blink === null) wantAt(nextBlinkAt);
        if (glance === null) wantAt(nextGlanceAt);
      }
    }
    wantAt(moodHold.holdsUntil());

    // A blink's steps are hard swaps, and so is the step out of the last one.
    const sceneFadeMs = inBlinkAtStart || blinkNow !== null ? 0 : fadeMs;
    // A new state's face and a new mood's fade in over 180 ms (a mood easing back to neutral, 300); the nod's first frame is a clip's, at the clip's pace.
    const faceChanged = (presenceChanged && clipShown === null) || moodMove === 'changed';
    const startsBigFade = moodMove === 'eased' || faceChanged;
    const bigFadeMs = moodMove === 'eased' ? EASE_TO_NEUTRAL_MS : MOOD_FADE_MS;
    if (startsBigFade && !reduced) bigFadeEndsAt = now + bigFadeMs;
    // A frame that changes inside that fade (the mouth moving under a new mood) joins it and ends with it, not cutting it to its own 60 ms.
    const crossfadeMs = startsBigFade ? bigFadeMs : sceneFadeMs > 0 ? Math.max(sceneFadeMs, bigFadeEndsAt - now) : 0;
    const shown = fader.show(frame, now, reduced ? 0 : crossfadeMs);
    wantAt(fader.endsAt());

    const tilt = STATE_TILT[presence] ?? (RESTING.has(presence) || speaking ? moodTilt(mood) : 0);
    return { ...shown, motion: clips.motion(), tilt, nextAt: deadlines.length === 0 ? null : Math.min(...deadlines) };
  }

  return { step };
}
