import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { useCompanionVoiceClock } from '@/modules/companion/context/CompanionVoiceClockContext';
import type { CompanionSoundProgress } from '@/shared/types';

/** With no voice to keep time with, a sentence's words come in this far apart, in ms. */
const WORD_STEP_MS = 42;
/** With no voice, no sentence takes longer than this to come in, in ms: a long one runs its words closer together. */
const SENTENCE_MAX_MS = 1500;
/** How long a sentence waits for this page's voice to start on it before it comes in on its own time, in ms. */
const VOICE_GRACE_MS = 2500;
/** The voice's pace while a sentence's length is not known yet, in words a second (the face's own guess for the word it plates). */
const WORDS_PER_SECOND = 2.6;
/** A word starts to show this far ahead of the voice reaching it, in words: it is there as it is said, not after. */
const LEAD_WORDS = 0.7;
/** The fastest the count of words said may move, in words a second: what was held back comes in quickly, never all at once. */
const CATCH_UP_PER_SECOND = 45;
/** A sentence whose audio stopped within this much of its end was heard out, in seconds; sooner than that, the voice was stopped. */
const HEARD_OUT_S = 0.3;
/** How far past its last word a sentence's count runs before it is settled, in words: the last word has fully come in. */
const SETTLE_PAST = 2;

/** One arriving sentence's time: where its count stands and what moves it. */
type Pace = {
  /** How many words have been said, as `--said` holds it. */
  said: number;
  /** The characters up to the end of each word (a word's length plus the gap after it): the voice's place is read against these. */
  ends: number[];
  /** When nothing stood before it and nothing sounded, in ms: the wait for the voice counts from here. */
  readyAt: number | null;
  /** When it began to come in on its own time, in ms. */
  startedAt: number | null;
  /** Whether the voice has been on it, and whether it had reached the sentence's end when last heard. */
  sounded: boolean;
  heardOut: boolean;
  /** Its words are all owed now: the count runs out to the end. */
  finishing: boolean;
  /** Every word is in. */
  settled: boolean;
};

/** How many of a sentence's words the voice has said, from the share of its audio that has sounded: a long word takes longer than a short one. */
function wordsAt(share: number, ends: number[]): number {
  const total = ends[ends.length - 1] ?? 0;
  if (total === 0) return ends.length;
  const reached = Math.min(1, Math.max(0, share)) * total;
  let word = 0;
  while (word < ends.length && ends[word] <= reached) word++;
  if (word >= ends.length) return ends.length;
  const from = word === 0 ? 0 : ends[word - 1];
  return word + (reached - from) / (ends[word] - from);
}

/** The share of a sentence's audio that has sounded: of its length once known, else of the length its words would take at the usual pace. */
function shareOf(sound: CompanionSoundProgress, words: number): number {
  return sound.elapsed / (sound.duration ?? Math.max(0.4, words / WORDS_PER_SECOND));
}

/**
 * Used by this module's CompanionReply: brings the words of its arriving sentences in, in time with the voice where this page has one.
 *
 * WHAT IT MOVES. Each arriving sentence is a span marked `data-companion-arriving-sentence` (with its turn and index), and its words
 * are spans that carry their place (CompanionSentence). This hook writes one number on the sentence each animation frame, `--said`,
 * the count of its words said so far; the stylesheet shows a word once the count passes its place. While any sentence is still
 * coming in the paragraph is marked `data-companion-arriving`, which holds the answering dots back, and a sentence whose words are
 * all in is marked `data-companion-settled`, which gives it back the band of the sentence being spoken. Nothing here is React state:
 * a word coming in redraws nothing.
 *
 * WHOSE TIME. Where this page sounds the companion (`useCompanionVoiceClock`: the switch on, the floor held):
 * - a sentence the voice is on comes in as its audio sounds, a little ahead of each word (`LEAD_WORDS`), long words taking longer;
 * - a sentence waits, unseen, while the one before it is still coming in or while anything else is sounding;
 * - the voice moving past it, stopping or being cut brings in whatever of it was still owed, and after a stop or a cut what
 *   waits behind it comes in on its own time at once;
 * - a sentence the voice has not started on `VOICE_GRACE_MS` after its turn came (its speech was refused, the page's audio is not
 *   unlocked) comes in on its own time, and so does the rest of that paragraph without waiting again.
 * Where the page has no voice (the switch off, another page holding the floor, a fixture), every sentence comes in on its own time:
 * `WORD_STEP_MS` a word, never longer than `SENTENCE_MAX_MS`, one sentence after another.
 *
 * `arriving` is the arriving sentences' ids joined: the loop starts when it changes and stops itself when every one has settled.
 */
export function useWordsInTime(rootRef: RefObject<HTMLElement | null>, arriving: string): void {
  const clock = useCompanionVoiceClock();
  const clockRef = useRef(clock);
  const paces = useRef(new Map<string, Pace>());
  const voiceMissed = useRef(false);

  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  // Before the paint the sentences first appear in: the dots are held back from their first frame.
  useLayoutEffect(() => {
    if (arriving !== '') rootRef.current?.setAttribute('data-companion-arriving', '');
  }, [rootRef, arriving]);

  useEffect(() => {
    if (arriving === '') return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const root = rootRef.current;
      if (!root) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const voice = clockRef.current;
      const sound = voice?.active ? voice.progress() : null;
      if (voice?.cut) voiceMissed.current = true;
      let blocked = false;
      for (const sentence of root.querySelectorAll<HTMLElement>('[data-companion-arriving-sentence]')) {
        const id = sentence.dataset.companionArrivingSentence ?? '';
        let pace = paces.current.get(id);
        if (!pace) {
          let reached = 0;
          const ends = [...sentence.querySelectorAll('[data-companion-word]')].map((word) => (reached += (word.textContent?.length ?? 0) + 1));
          pace = { said: 0, ends, readyAt: null, startedAt: null, sounded: false, heardOut: false, finishing: false, settled: false };
          paces.current.set(id, pace);
        }
        if (pace.settled) continue;
        const words = pace.ends.length;
        const mine = sound !== null && sound.turnId === sentence.dataset.turn && String(sound.index) === sentence.dataset.index;
        let target = pace.said;
        if (pace.finishing) target = words + SETTLE_PAST;
        else if (mine) {
          pace.sounded = true;
          voiceMissed.current = false;
          target = wordsAt(shareOf(sound, words), pace.ends) + LEAD_WORDS;
          pace.heardOut = sound.duration !== null && sound.elapsed >= sound.duration - HEARD_OUT_S;
          if (sound.duration !== null && sound.elapsed >= sound.duration) pace.finishing = true;
        } else if (pace.sounded || (sound !== null && sound.turnId === sentence.dataset.turn && sound.index > Number(sentence.dataset.index))) {
          // The voice was on it and is no longer, or is already past it: whatever is owed comes in. Stopped short of its end with
          // nothing sounding after it, the voice was stopped: what waits behind it does not wait for a voice that is not coming.
          pace.finishing = true;
          if (pace.sounded && !pace.heardOut && sound === null) voiceMissed.current = true;
        } else if (blocked || sound !== null) {
          pace.readyAt = null;
        } else {
          pace.readyAt ??= now;
          const grace = voice?.active && !voiceMissed.current ? VOICE_GRACE_MS : 0;
          if (now - pace.readyAt >= grace) {
            if (grace > 0) voiceMissed.current = true;
            pace.startedAt ??= now;
            target = (now - pace.startedAt) / Math.min(WORD_STEP_MS, SENTENCE_MAX_MS / Math.max(1, words)) + LEAD_WORDS;
            if (target >= words + 1) pace.finishing = true;
          }
        }
        if (target > pace.said) pace.said = Math.min(target, pace.said + CATCH_UP_PER_SECOND * dt);
        if (pace.said >= words + SETTLE_PAST) {
          pace.settled = true;
          sentence.setAttribute('data-companion-settled', '');
        }
        sentence.style.setProperty('--said', pace.said.toFixed(3));
        if (!pace.settled) blocked = true;
      }
      if (blocked) frame = requestAnimationFrame(tick);
      else root.removeAttribute('data-companion-arriving');
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rootRef, arriving]);
}
