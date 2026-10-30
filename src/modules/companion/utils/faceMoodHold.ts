// Which mood her face wears, and for how long. The mood is the sentence's leading word, mapped to one of her nine faces
// (`faceMoodMap.ts`): read as the sentence STARTS sounding on a page that plays her voice, or from the newest sentence of her
// running turn on a page that plays none; it holds for 2.5 s after her turn has ended and her voice has stopped, and then
// eases back to neutral.

import { moodOf } from '@/modules/companion/utils/faceMoodMap';
import type { CompanionFaceMood, CompanionSound } from '@/shared/companion-types';

/** The sentence the player is sounding: her mood word, the text and sounds it displays, seconds elapsed in it, and its length in seconds once its body has ended (else null). */
export type FacePlaying = { mood: string | null; text: string; sounds: readonly CompanionSound[]; elapsed: number; duration: number | null };

/** What `read` needs of the engine's input. `newestMood` is null for "nothing to read" (a page that plays her voice, or no sentence arrived yet) and never for "a sentence without a mood": that one is `''`, which reads as neutral. */
type MoodInput = { now: number; playing: FacePlaying | null; newestMood: string | null; turnRunning: boolean };

/** How the mood moved this step: `same`, `changed` to a sentence's, or `eased` back to neutral at the end of its hold. `freshSentence` is true on the step a new sentence is first seen sounding. */
type MoodMove = { move: 'same' | 'changed' | 'eased'; freshSentence: boolean };

/** How long the mood holds after her turn has ended and her voice has stopped, ms. */
const MOOD_HOLD_MS = 2500;

/** Whether two playings are the same sentence, by value: a page may build a new object each step for the same one. */
const sameSentence = (a: FacePlaying, b: FacePlaying): boolean =>
  a.text === b.text && a.mood === b.mood && a.sounds.length === b.sounds.length
  && a.sounds.every((sound, k) => sound.tag === b.sounds[k].tag && sound.at === b.sounds[k].at);

/** Used by `faceEngine.ts`: one reader per engine. */
export function createMoodHold(): { read(input: MoodInput): MoodMove; mood(): CompanionFaceMood; holdsUntil(): number | null } {
  // The mood shown now, and when its hold runs out (null while the turn or her voice goes on, or while the mood is neutral).
  let mood: CompanionFaceMood = 'neutral';
  let holdUntil: number | null = null;
  // Whether the turn was running at the last step, to see a new one begin.
  let wasTurnRunning = false;
  // The sentence last seen sounding and how far into it that was: a smaller `elapsed` is the next sentence, even one with the same words.
  let sentence: FacePlaying | null = null;
  let lastElapsed = 0;

  return {
    read({ now, playing, newestMood, turnRunning }) {
      const before = mood;
      let freshSentence = false;
      // A new turn begins with a clean face; its first sentence brings its own mood. A sentence of the last turn still sounding keeps the face it started with.
      if (turnRunning && !wasTurnRunning && playing === null) mood = 'neutral';
      wasTurnRunning = turnRunning;
      if (playing !== null) {
        if (sentence === null || playing.elapsed < lastElapsed || !sameSentence(sentence, playing)) {
          mood = moodOf(playing.mood);
          freshSentence = true;
        }
        sentence = playing;
        lastElapsed = playing.elapsed;
      } else {
        sentence = null;
        // On a page with no voice: the newest sentence's word, and `''` (no word) is neutral too, so a mood-less sentence clears the last one's face.
        if (turnRunning && newestMood !== null) mood = moodOf(newestMood);
      }
      let eased = false;
      if (playing !== null || turnRunning || mood === 'neutral') {
        holdUntil = null;
      } else if (holdUntil === null) {
        holdUntil = now + MOOD_HOLD_MS;
      } else if (now >= holdUntil) {
        mood = 'neutral';
        holdUntil = null;
        eased = true;
      }
      return { move: mood === before ? 'same' : eased ? 'eased' : 'changed', freshSentence };
    },
    mood: () => mood,
    holdsUntil: () => holdUntil,
  };
}
