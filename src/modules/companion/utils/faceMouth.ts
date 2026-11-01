// The mouth of her face, in pure code. THE EXACT SHAPES LEAD AND THE LEVEL MOUTH FILLS IN. Gemini's speech sends audio only,
// but the server finds the timed mouth shapes in it (Rhubarb Lip Sync, piece by piece as the audio arrives) and announces them,
// so wherever an announced piece holds the audio's place her mouth is the baked mouth of that shape (`MOUTH_OF_SHAPE`, `shapeAt`).
// Wherever none does (a sentence's start until its first piece lands: that piece's length, Rhubarb's run time and the audio's arrival, so
// about one to two seconds and longer under load; the gap between two pieces; a piece Rhubarb could not answer; no install) the mouth is built from
// the two things the page always has: the voice's LEVEL says how far the mouth opens, and the sentence's TEXT, at the share of
// it the audio has reached, says which vowel it shapes. `chooseMouth` makes that choice for one step; `faceEngine.ts` plays it as frames.

import type { FacePlaying } from '@/modules/companion/utils/faceMoodHold';
import type { CompanionFaceMouth, CompanionMouthPiece, CompanionMouthShape, CompanionSound } from '@/shared/companion-types';

/** How far her mouth is open: shut, half open (frame `1`) or full open (frame `2`). */
type MouthOpenness = 'closed' | 'half' | 'full';

/** The three vowel shapes the bake draws: "ah", "ee" and "oo". */
export type MouthVowel = 'a' | 'e' | 'o';

/** The mouth as it is shown and since when (ms on the caller's clock), so the next read can hold it for its dwell. Handed back to `mouthOpenness` as `previous`. */
type MouthState = { openness: MouthOpenness; since: number };

/** A mouth shut for as long as anyone can remember: the first change is never held by its dwell. */
export const MOUTH_CLOSED: MouthState = { openness: 'closed', since: Number.NEGATIVE_INFINITY };

/** The level (the player's RMS, 0..1) at which a shut mouth opens to half; `faceHead.ts` reads the same level as the floor of her voice's strength. */
export const HALF_OPEN_AT = 0.035;
/** The level at which a half-open mouth opens fully. */
const FULL_OPEN_AT = 0.12;
/** A mouth closes or narrows only once the level has fallen this far below the level that opened it, so a level resting on a threshold never flickers. */
const HYSTERESIS = 0.01;
/** A mouth shown holds at least this long before it changes again. */
const DWELL_MS = 50;
/** Her speech, in characters of text a second: the estimate of a sentence's length until its body has ended and the player knows it. */
const CHARACTERS_PER_SECOND = 15;
/** How long the level mouth crossfades from one frame to the next, ms: long enough that a loudness on a threshold is a soft change, not a flicker. */
export const MOUTH_FADE_MS = 60;
/** How long an exact shape crossfades into the next, ms. Rhubarb's shortest cues run 40 to 70 ms, so a longer fade would never show a 40 ms shape whole; 40 ms still hides the swap of one photo frame for another. */
const EXACT_MOUTH_FADE_MS = 40;

/** Rhubarb's shapes as her baked mouths: the six basic shapes are six of her seven mouths, and rest is her closed mouth. `e2`, the wide grin, stays the level mouth's. */
export const MOUTH_OF_SHAPE: Readonly<Record<CompanionMouthShape, CompanionFaceMouth>> = {
  X: 'closed', A: 'closed', B: 'e1', C: 'a1', D: 'a2', E: 'o2', F: 'o1',
};

/**
 * The shape her mouth takes `position` seconds into the sentence: the last cue at or before it, in the piece that holds it
 * (`from` up to, not including, `to`). Null when no announced piece holds it.
 */
export function shapeAt(pieces: readonly CompanionMouthPiece[], position: number): CompanionMouthShape | null {
  const piece = pieces.find((candidate) => position >= candidate.from && position < candidate.to);
  if (piece === undefined) return null;
  let shape: CompanionMouthShape | null = null;
  for (const cue of piece.cues) {
    if (cue.at > position) break;
    shape = cue.shape;
  }
  return shape;
}

/**
 * How many characters of text each sound takes in the sentence's length. A giggle is not a character, but it takes time, so it
 * counts as ten and the text after it is reached later. A tag not listed (the allow-list may grow) counts as eight. A Map, so a
 * tag that spells an Object property (`constructor`, which Settings accepts) is looked up as a tag and not found on the prototype.
 */
const SOUND_CHARACTERS = new Map<string, number>([
  ['giggle', 10], ['chuckle', 10], ['laugh', 16], ['gasp', 6], ['sigh', 12], ['phew', 10], ['tsk', 4], ['breath', 6],
  ['short pause', 6], ['long pause', 14],
]);
const OTHER_SOUND_CHARACTERS = 8;

/**
 * Used by `faceEngine.ts`: how open her mouth is for this `level`, given the mouth shown (`previous`) and the time `now`
 * (ms). The thresholds are crossed upward at 0.035 and 0.12 and back down 0.01 below them, and a change is held until the
 * mouth shown has stood 50 ms. Returns `previous` itself when nothing changes, a new state otherwise.
 */
export function mouthOpenness(level: number, previous: MouthState, now: number): MouthState {
  let rank = previous.openness === 'closed' ? 0 : previous.openness === 'half' ? 1 : 2;
  if (rank < 1 && level >= HALF_OPEN_AT) rank = 1;
  if (rank < 2 && level >= FULL_OPEN_AT) rank = 2;
  if (rank > 1 && level < FULL_OPEN_AT - HYSTERESIS) rank = 1;
  if (rank > 0 && level < HALF_OPEN_AT - HYSTERESIS) rank = 0;
  const openness: MouthOpenness = rank === 0 ? 'closed' : rank === 1 ? 'half' : 'full';
  if (openness === previous.openness || now - previous.since < DWELL_MS) return previous;
  return { openness, since: now };
}

/** Where the audio stands in the sentence: `char` the index of the character being said (the one before a sound that is sounding; -1 before any), `reached` the index of the latest sound begun (-1 for none). */
type Place = { char: number; reached: number };

/**
 * The place in `text` that `elapsed` seconds of audio have reached. The text and its sounds make one line: each sound is
 * `SOUND_CHARACTERS` long and sits at its `at` (an offset in `text`), so the line is longer than the text. The audio's share
 * (`elapsed` over `duration`, which is the player's own once the sentence's body has ended and else the line at 15 characters a
 * second) is a point on that line, and the sentence's marks are placed the way the characters are.
 */
function placeAt(text: string, sounds: readonly CompanionSound[], elapsed: number, duration: number | null): Place {
  const weights = sounds.map((sound) => SOUND_CHARACTERS.get(sound.tag) ?? OTHER_SOUND_CHARACTERS);
  const total = text.length + weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return { char: -1, reached: -1 };
  const seconds = duration !== null && duration > 0 ? duration : total / CHARACTERS_PER_SECOND;
  const point = Math.min(1, Math.max(0, elapsed / seconds)) * total;
  // `before`: how much of the line the sounds already passed take, which is what pushes the text after them later.
  let before = 0;
  let reached = -1;
  for (let k = 0; k < sounds.length; k += 1) {
    const start = sounds[k].at + before;
    if (point < start) break;
    reached = k;
    // Inside a sound the text stands still at the last character said before it.
    if (point < start + weights[k]) return { char: sounds[k].at - 1, reached };
    before += weights[k];
  }
  return { char: Math.min(text.length - 1, Math.floor(point - before)), reached };
}

/** The vowel a letter shapes, or null for a letter that shapes none (a consonant, a digit, a mark). Accents are dropped first: á, à, â and ä are all a. */
function vowelOfLetter(letter: string): MouthVowel | null {
  switch (letter.normalize('NFD')[0]?.toLowerCase()) {
    case 'a': return 'a';
    case 'e': case 'i': case 'y': return 'e';
    case 'o': case 'u': case 'w': return 'o';
    default: return null;
  }
}

/**
 * Used by `faceEngine.ts`: the vowel her mouth shapes at `elapsed` seconds into the sentence. a, á, à, â are "ah"; e, é, i, í
 * and y "ee"; o, ó, u, ú and w "oo"; any other character keeps the vowel before it, and a sentence that has none yet opens on
 * "ah". `duration` is the sentence's length in seconds when the player knows it, else null.
 */
export function vowelAt(text: string, sounds: readonly CompanionSound[], elapsed: number, duration: number | null): MouthVowel {
  for (let index = placeAt(text, sounds, elapsed, duration).char; index >= 0; index -= 1) {
    const vowel = vowelOfLetter(text[index]);
    if (vowel !== null) return vowel;
  }
  return 'a';
}

/**
 * Used by `faceEngine.ts`: the latest sound of the sentence whose place the audio has reached (its `index` in `sounds` and its
 * `tag`), or null before the first. A sound is reached the way a vowel is, so the caller plays its clip once, when `index`
 * first passes the last one played.
 */
export function soundAt(
  text: string,
  sounds: readonly CompanionSound[],
  elapsed: number,
  duration: number | null,
): { index: number; tag: string } | null {
  const { reached } = placeAt(text, sounds, elapsed, duration);
  return reached < 0 ? null : { index: reached, tag: sounds[reached].tag };
}

/** The level mouth as the engine carries it from step to step: the openness shown, and the vowel it shapes (kept for a step with no sentence). */
export type VoiceMouth = { openness: MouthState; vowel: MouthVowel };

/** The level mouth before she has spoken: shut, on "ah". */
export const QUIET_VOICE: VoiceMouth = { openness: MOUTH_CLOSED, vowel: 'a' };

/**
 * What one step's mouth is: who `by` drove it, the baked mouth `key` to draw, the crossfade into it in ms, whether it is `closed`
 * (a blink waits for that), and the level mouth to carry into the next step.
 */
export type MouthChoice = { by: 'exact' | 'voice'; key: CompanionFaceMouth; fadeMs: number; closed: boolean; voice: VoiceMouth };

/**
 * Used by `faceEngine.ts`: the mouth for one step while she speaks. Where an announced piece holds the audio's place, the mouth is
 * the mood's baked mouth of that shape, crossfaded in 40 ms; elsewhere it is today's mouth from the level and the vowel, with its
 * 60 ms crossfade, 50 ms dwell and hysteresis. The level mouth is read on every step either way, so it is current the moment it
 * takes over.
 */
export function chooseMouth(level: number, playing: FacePlaying | null, voice: VoiceMouth, now: number): MouthChoice {
  const openness = mouthOpenness(level, voice.openness, now);
  const vowel = playing === null ? voice.vowel : vowelAt(playing.text, playing.sounds, playing.elapsed, playing.duration);
  const shape = playing === null ? null : shapeAt(playing.mouth, playing.elapsed);
  if (shape !== null) {
    const key = MOUTH_OF_SHAPE[shape];
    return { by: 'exact', key, fadeMs: EXACT_MOUTH_FADE_MS, closed: key === 'closed', voice: { openness, vowel } };
  }
  const closed = openness.openness === 'closed';
  const key = closed ? 'closed' : (`${vowel}${openness.openness === 'half' ? 1 : 2}` as CompanionFaceMouth);
  return { by: 'voice', key, fadeMs: MOUTH_FADE_MS, closed, voice: { openness, vowel } };
}
