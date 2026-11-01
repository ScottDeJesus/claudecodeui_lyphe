// The engine of her face, in pure code: THE PAGE IS A PLAYER, NOT A PAINTER. The bake made her face once, as frames; this
// picks which frame the page shows, and what crossfades, moves and tilts, from her state, her voice, her mood, her sounds and
// her look. It touches no browser, so `tsx` replays it on a recorded turn and prints what the page would have drawn.
//
// ONE ENGINE PLAYS ONE MANIFEST: `createFaceEngine(manifest, seed)`, and a new face is a new engine. The page calls `step`
// when something changes and, while she speaks, a crossfade, clip or turn runs or her head settles (<= 300 ms), on every animation frame; `nextAt` is the
// next moment (the caller's clock) the engine wants a call at when nothing else would change it, and null when nothing does.
// A blink, a glance, a search step, a warm spell, the mood's hold and the brows' hold are deadlines like that; the first four come from the seeded random.
//
// WHAT EACH STATE DRAWS. idle, asleep, loading and walking: neutral (or the mood still held), glancing; in idle a warm smile comes and goes
// (`faceWarmth.ts`). listening: her listening face, leaning toward the sound, with a nod as the press begins. transcribing: eyes down.
// thinking and waking: her eyes search up and aside (`faceEyes.ts`), leaning; drafting: eyes down and right, leaning. speaking: the sentence's mood, her mouth
// the exact shape where an announced piece holds the audio's place (40 ms crossfades, `faceMouth.ts`) and else her voice's level and
// vowel; `mouthBy` says which. reading_session and reading_code: her eyes sweeping between down-left and down-right, one cycle each 4.4 s
// and 2.6 s. cut: the surprised face with one quick blink. failed: her stopped face, still. While a look holds, every state but
// those with a face of their own (listening, transcribing, speaking, cut, failed) turns her head toward the anchor instead.
// While she speaks her head also moves with her voice's level (`faceHead.ts`, in the picture's plane): `FaceDraw.head`, null at rest.
//
// SHE BLINKS IN EVERY STATE BUT STOPPED on a face made with `blinks` (`faceBlink.ts`): over the look she holds, at a rhythm each state has, and a
// move of her eyes or head (a sweep's turn, a search step, a glance, a turn level) may carry one: 40% of those after the state's shortest gap. A face made before them blinks at
// rest and speaking only, and neither searches nor smiles: it plays as it always did.
//
// HER BROWS LIFT AT THE END OF A QUESTION (`faceBrows.ts`): when a sentence of her voice ending in a question mark stops sounding, her mood's
// closed face with the brows lifted (`manifest.brows`) fades in over 140 ms and holds until her next sentence or 1200 ms, then eases back over
// 300 ms; it takes no blink, and a held look's turned head replaces it. A page that plays no voice, and a face made before them, shows none.
//
// REDUCED MOTION keeps every look and drops the movement: no motion, though a state's tilt stands; frames swap with no
// crossfade; no blink, glance, sweep, search, warm spell, clip or head; a look shows its final turn at once; speaking holds the mood's half-open "ah";
// a question's lifted brows still show, swapped with no fade.

import { createBlinker, stillFrameOf } from '@/modules/companion/utils/faceBlink';
import type { FaceLook } from '@/modules/companion/utils/faceBlink';
import { createBrowHold } from '@/modules/companion/utils/faceBrows';
import { createClipPlayer } from '@/modules/companion/utils/faceClipPlayer';
import { nodClip } from '@/modules/companion/utils/faceClips';
import type { FaceMotion } from '@/modules/companion/utils/faceClips';
import { createStateEyes } from '@/modules/companion/utils/faceEyes';
import { createFader } from '@/modules/companion/utils/faceFader';
import { createHeadMotion } from '@/modules/companion/utils/faceHead';
import type { FaceHead } from '@/modules/companion/utils/faceHead';
import { moodTilt } from '@/modules/companion/utils/faceMoodMap';
import { createMoodHold } from '@/modules/companion/utils/faceMoodHold';
import type { FacePlaying } from '@/modules/companion/utils/faceMoodHold';
import { MOUTH_CLOSED, MOUTH_FADE_MS, QUIET_VOICE, chooseMouth, soundAt } from '@/modules/companion/utils/faceMouth';
import { createRandom, glanceGap, glanceOf } from '@/modules/companion/utils/faceSchedule';
import { NO_TURN, poseOf, sameTurn, stepTurn, turnToward } from '@/modules/companion/utils/faceTurn';
import type { Turn } from '@/modules/companion/utils/faceTurn';
import { createWarmth } from '@/modules/companion/utils/faceWarmth';
import type { CompanionFaceGaze, CompanionFaceManifest } from '@/shared/companion-types';
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

/** What the page draws: `base` whole with `over` (frame indices into the manifest) on top at `alpha` (null and 0 when nothing fades), the one-shot `motion` its stylesheet plays, the lean in degrees, her `head` (null at rest), the next ms the engine wants a call at (null for none), and `mouthBy`, what drove her mouth while she speaks: `exact` (a timed shape) or `voice` (level and vowel), the frame names being the same; null when she is not speaking and under reduced motion. */
export type FaceDraw = { base: number; over: number | null; alpha: number; motion: FaceMotion | null; tilt: number; head: FaceHead | null; nextAt: number | null; mouthBy: 'exact' | 'voice' | null };

const MOOD_FADE_MS = 180;
const STEP_FADE_MS = 140;
const EASE_MS = 300;
const CUT_BLINK_AFTER_MS = 250;
/** What the brows' hold says for a face with no `brows`: never lifted, nothing to wait for. */
const NO_LIFT = { lifted: false, nextAt: null };

/** The states of a plain face: it blinks, glances, and turns toward a look. */
const RESTING = new Set<CompanionPresenceState>(['idle', 'asleep', 'loading', 'walking']);
/** The states whose face a held look replaces with a turned head. */
const TURNABLE = new Set<CompanionPresenceState>([...RESTING, 'thinking', 'waking', 'drafting', 'reading_session', 'reading_code']);
/** The lean of a state, degrees clockwise. A state without one takes its mood's. */
const STATE_TILT: Partial<Record<CompanionPresenceState, number>> = { listening: -5, thinking: 3, waking: 3, drafting: 3 };

// Used by the portrait and by `.verify`'s replay: the frames' names live in `faceNames.ts`, and the engine's import surface stays as it was.
export { frameNames } from '@/modules/companion/utils/faceNames';

/** Used by the portrait: one engine for one face. */
export function createFaceEngine(manifest: CompanionFaceManifest, seed: number): { step(input: FaceInput): FaceDraw } {
  const random = createRandom(seed);
  const fader = createFader();
  const moodHold = createMoodHold();
  const clips = createClipPlayer(manifest);
  const headMotion = createHeadMotion(seed);
  const blinker = createBlinker(random);
  const browHold = createBrowHold();
  // A face made before `blinks` plays as it always did, its seeded draws in today's order (the `legacy` rules below): it never searches or smiles.
  const legacy = manifest.blinks === undefined;
  const stateEyes = createStateEyes(random, !legacy);
  let warmth = createWarmth(random); // made again as each state begins: a change of state ends a spell and its count starts anew
  const { moods, states, brows } = manifest;

  // The presence last drawn and when it began, so a change is seen, and the sweep and the cut's blink count from it.
  let state: CompanionPresenceState | null = null;
  let stateSince = 0;
  // The level mouth: the openness shown (its dwell needs when it changed) and the vowel it shapes, kept for a step with no sentence.
  let voice = QUIET_VOICE;
  let cutBlinked = false; // whether the cut's one blink has been made
  let browsShown = false; // whether the last step drew her brows lifted
  // Whether the face of the last step had blink frames and glance frames (and motion on): a deadline that fell due while it had none lapsed.
  let couldBlink = false;
  let couldGlance = false;
  // When the 180 ms (or 300 ms) crossfade of a new state or mood ends: a frame that changes inside it joins it and ends with it.
  let bigFadeEndsAt = 0;
  // The glance in play (its gaze, when it lands and when it ends), when the next is due, and the eyes of a state that looks somewhere as shown.
  let glance: { gaze: CompanionFaceGaze; startsAt: number; endsAt: number } | null = null;
  let nextGlanceAt = 0;
  let eyes: CompanionFaceGaze | null = null;
  let warm = false; // whether the warm spell was in play at the last step
  // The head's turn as shown, and when it may move one level on.
  let turn: Turn = NO_TURN;
  let turnStepAt = 0;

  function enterState(next: CompanionPresenceState, now: number, reduced: boolean): void {
    if (!legacy && state !== null) blinker.enter(now, next);
    state = next;
    stateSince = now;
    blinker.clear();
    warmth = createWarmth(random);
    glance = null;
    eyes = null;
    clips.clear();
    cutBlinked = false;
    voice = { ...voice, openness: MOUTH_CLOSED };
    if (!TURNABLE.has(next)) turn = NO_TURN;
    if (next === 'listening' && !reduced) clips.play(nodClip(manifest), now);
  }

  function step(input: FaceInput): FaceDraw {
    const { now, presence, reducedMotion: reduced } = input;
    const deadlines: number[] = [];
    const wantAt = (time: number | null) => {
      if (time !== null && time > now) deadlines.push(time);
    };
    const blinkState = legacy ? 'idle' : presence;
    if (state === null) {
      blinker.enter(now, blinkState);
      nextGlanceAt = now + glanceGap(random);
    }
    // A blink or glance that fell due while the face had none lapses, renewed from when it was due, earliest first: the same schedule however often the page steps.
    for (;;) {
      const blinkDue = couldBlink ? Infinity : blinker.dueAt() ?? Infinity;
      const glanceLapsed = !couldGlance && nextGlanceAt <= now;
      if (blinkDue <= now && (!glanceLapsed || blinkDue <= nextGlanceAt)) blinker.renew();
      else if (glanceLapsed) nextGlanceAt += glanceGap(random);
      else break;
    }
    const presenceChanged = presence !== state;
    if (presenceChanged) enterState(presence, now, reduced);
    const inBlinkAtStart = blinker.inBlink(now);
    const { move: moodMove, freshSentence } = moodHold.read(input);
    const mood = moodHold.mood();
    // THE BROWS: lifted when a question has just stopped sounding, on a face made with them; the hold's end is a deadline.
    const held = brows === undefined ? NO_LIFT : browHold.read(now, input.playing, presence);
    wantAt(held.nextAt);
    if (freshSentence) clips.newSentence();
    if (reduced) {
      clips.clear();
      blinker.clear();
      glance = null;
    }

    // THE MOUTH, while she speaks: the exact shape at the audio's place, else the voice's level and the text's vowel.
    const speaking = presence === 'speaking';
    const playing = input.playing;
    const drawn = speaking && !reduced ? chooseMouth(input.level, playing, voice, now) : null;
    if (drawn !== null) voice = drawn.voice;

    // THE SOUNDS: a sound's clip plays when the audio reaches its place.
    const clipWasPlaying = clips.playing();
    clips.advance(now);
    if (speaking && !reduced && playing !== null) clips.hear(soundAt(playing.text, playing.sounds, playing.elapsed, playing.duration), now);
    if (clips.playing() || held.lifted) blinker.clear();

    // THE HEAD moves with the voice's level; a clip that began with the sentence is its cue, so no breath in is drawn for it.
    const head = headMotion.step({ now, speaking, level: input.level, freshSentence, clipStarted: !clipWasPlaying && clips.playing(), reducedMotion: reduced });
    if (head !== null) wantAt(now + 1); // her head moves on every frame while it is not at rest

    // THE TURN toward a look, one level every 140 ms (all at once under reduced motion). A move of the eyes or head lands now, or at the
    // closed step of a blink that carries it (that step's start is the blink's own deadline).
    const landing = (): number => (legacy || reduced || clips.playing() || held.lifted ? now : blinker.carry(now));
    const turnable = TURNABLE.has(presence);
    const wantedTurn = turnable ? turnToward(input.look) : NO_TURN;
    if (reduced || !turnable) {
      turn = wantedTurn;
    } else if (!sameTurn(turn, wantedTurn) && now >= turnStepAt && landing() <= now) {
      turn = stepTurn(turn, wantedTurn);
      turnStepAt = now + STEP_FADE_MS;
    }
    if (!sameTurn(turn, wantedTurn)) wantAt(turnStepAt);
    const turned = turn.level > 0;
    const lookHeld = wantedTurn.level > 0;
    const browFrame = brows !== undefined && held.lifted && !turned ? brows[mood] : null;

    // A step that changes the state or the mood starts that crossfade; no blink or glance cuts into it.
    const settled = !presenceChanged && moodMove === 'same';

    // THE BLINK waits for a still face and, while she speaks, a closed mouth; one that falls due in a face that cannot blink lapses (above, next step).
    if (presence === 'cut' && !reduced && !cutBlinked && now - stateSince >= CUT_BLINK_AFTER_MS && !fader.fading(now)) {
      cutBlinked = true;
      blinker.single(now);
    }
    const plain = RESTING.has(presence) && !turned;
    const hasBlinkFrames = !reduced && (legacy ? RESTING.has(presence) || speaking : presence !== 'failed' && presence !== 'cut');
    const free = settled && !clips.playing() && !held.lifted && !fader.fading(now) && (drawn === null || drawn.closed) && (!legacy || (glance === null && !turned && !lookHeld));
    blinker.tick(now, blinkState, hasBlinkFrames && free);

    // THE GLANCE, in a plain face with a neutral mood; its start and its end are moves a blink may carry.
    if (glance !== null && now >= glance.endsAt && landing() <= now) glance = null;
    // THE WARM SPELL: in idle her face eases to gentle and back now and then; it begins on a still face and ends outside a blink, and no glance starts in it (one that falls due meanwhile lapses).
    const warmWas = warm;
    const spell = warmth.read(now, !legacy && !reduced && presence === 'idle' && mood === 'neutral' && !turned && !lookHeld && glance === null && (warm || (settled && !held.lifted && !blinker.inBlink(now) && !fader.fading(now))));
    warm = spell.warm || (warmWas && blinker.inBlink(now)); // a spell whose time is up in a blink waits for the blink to end
    wantAt(spell.nextAt);
    const hasGlanceFrames = !reduced && RESTING.has(presence) && !warm;
    if (hasGlanceFrames && nextGlanceAt <= now && glance === null && settled && !blinker.inBlink(now) && !turned && !lookHeld && !held.lifted && mood === 'neutral' && !fader.fading(now)) {
      const { gaze: direction, holdMs } = glanceOf(random);
      const startsAt = landing();
      glance = { gaze: direction, startsAt, endsAt: startsAt + holdMs };
      nextGlanceAt = glance.endsAt + glanceGap(random);
    }
    couldBlink = hasBlinkFrames;
    couldGlance = hasGlanceFrames;

    // THE EYES of a state that looks somewhere, head still (`faceEyes.ts`): the reading sweep, thinking's search. A move of them is one a blink may carry.
    const looking = stateEyes.gaze(now, presence, stateSince, reduced || lookHeld);
    if (looking === null || turned) {
      eyes = null;
    } else {
      if (eyes === null || (eyes !== looking.gaze && landing() <= now)) eyes = looking.gaze;
      wantAt(looking.nextAt);
    }

    // WHICH FRAME. The look she shows is what a blink closes and what a face with nothing over it draws; each branch also says how long a change into it crossfades.
    const look: FaceLook = presence === 'listening' ? { kind: 'listening' }
      : turned ? { kind: 'pose', pose: poseOf(turn) }
      : eyes !== null ? { kind: 'gaze', gaze: eyes }
      : glance !== null && now >= glance.startsAt ? { kind: 'gaze', gaze: glance.gaze }
      : { kind: 'mood', mood: warm ? 'gentle' : presence === 'cut' ? 'neutral' : mood };
    const { frame: blinkFrame, nextAt: blinkStepEnds } = blinker.frame(now, look, manifest);
    const blinkNow = blinker.inBlink(now);
    wantAt(blinkNow ? blinkStepEnds : hasBlinkFrames && (!legacy || plain) ? blinker.dueAt() : null); // the step's end, else the scheduled blink
    const clipShown = clips.frame(now);
    clips.deadlines(now).forEach(wantAt);

    let frame: number;
    let fadeMs = STEP_FADE_MS;
    if (presence === 'failed') {
      frame = states.failed;
    } else if (presence === 'cut') {
      frame = blinkFrame ?? states.surprise;
      if (!cutBlinked && !reduced) wantAt(stateSince + CUT_BLINK_AFTER_MS);
    } else if (speaking) {
      frame = clipShown ?? browFrame ?? blinkFrame ?? moods[mood].mouths[drawn?.key ?? 'a1'];
      fadeMs = clipShown !== null ? MOUTH_FADE_MS : browFrame !== null ? STEP_FADE_MS : drawn?.fadeMs ?? MOUTH_FADE_MS;
    } else {
      // Every other face is its look; a plain one (a mood's, or a glance) has the glance's deadlines.
      frame = clipShown ?? browFrame ?? blinkFrame ?? stillFrameOf(manifest, look);
      if (presence === 'listening') fadeMs = MOUTH_FADE_MS;
      if (plain) wantAt(glance !== null ? glance.endsAt : reduced ? null : nextGlanceAt);
    }
    wantAt(moodHold.holdsUntil());

    // A blink's steps are hard swaps, and so is the step out of the last one.
    const sceneFadeMs = inBlinkAtStart || blinkNow ? 0 : fadeMs;
    // A new state's face and a new mood's fade in over 180 ms (a mood easing back to neutral, 300); the nod's first frame is a clip's, at the clip's pace.
    // The lift fades in over 140 ms with the step that starts it, a state change or not; a state change ends it into that state's own fade.
    const lifts = browFrame !== null && !browsShown;
    const liftEnds = browsShown && browFrame === null;
    browsShown = browFrame !== null;
    const faceChanged = (presenceChanged && clipShown === null && !lifts) || moodMove === 'changed';
    const eased = moodMove === 'eased' || ((warm !== warmWas || liftEnds) && !presenceChanged); // the warm spell eases in and out and the lifted brows out, as a mood does
    const startsBigFade = eased || faceChanged;
    const bigFadeMs = eased ? EASE_MS : MOOD_FADE_MS;
    if (startsBigFade && !reduced) bigFadeEndsAt = now + bigFadeMs;
    // A frame that changes inside that fade (the mouth moving under a new mood) joins it and ends with it, not cutting it to its own 60 ms.
    const crossfadeMs = startsBigFade ? bigFadeMs : sceneFadeMs > 0 ? Math.max(sceneFadeMs, bigFadeEndsAt - now) : 0;
    if (warm !== warmWas && inBlinkAtStart) fader.show(moods[warmWas ? 'gentle' : 'neutral'].mouths.closed, now, 0); // the step out of a blink opens her eyes at once: the spell's ease starts from that face, not the blink's half-lidded one
    const shown = fader.show(frame, now, reduced ? 0 : crossfadeMs);
    wantAt(fader.endsAt());

    const tilt = STATE_TILT[presence] ?? (RESTING.has(presence) || speaking ? moodTilt(mood) : 0);
    return { ...shown, motion: clips.motion(), tilt, head, nextAt: deadlines.length === 0 ? null : Math.min(...deadlines), mouthBy: drawn?.by ?? null };
  }

  return { step };
}
