// Her mood words and the faces they draw. Her sentences open with one word in brackets (`[delighted] …`); the page has nine
// faces, and every word she may use is gathered into one of them. `faceEngine.ts` reads the sentence's mood through `moodOf`.

import type { CompanionFaceMood } from '@/shared/companion-types';

/** The words each face answers to. Her eight own words are the faces; the rest are near-synonyms (and "bright", her one other word in 386 recorded replies). */
const MOOD_WORDS: Record<Exclude<CompanionFaceMood, 'neutral'>, readonly string[]> = {
  delighted: ['delighted', 'bright', 'happy', 'excited', 'cheerful', 'joyful'],
  playful: ['playful', 'teasing', 'cheeky'],
  gentle: ['gentle', 'warm', 'kind'],
  thoughtful: ['thoughtful', 'curious', 'pensive'],
  brisk: ['brisk', 'quick', 'crisp', 'focused'],
  soft: ['soft', 'tender', 'calm'],
  whispered: ['whispered', 'whisper', 'hushed', 'quiet'],
  mock_serious: ['mock serious', 'deadpan', 'serious'],
};

const FACE_OF_WORD = new Map<string, CompanionFaceMood>(
  Object.entries(MOOD_WORDS).flatMap(([face, words]) => words.map((word) => [word, face as CompanionFaceMood] as const)),
);

/** How far her head leans, in degrees (positive is clockwise), while she wears a mood that leans. The other seven stand straight. */
const MOOD_TILT: Partial<Record<CompanionFaceMood, number>> = { playful: -4, thoughtful: 2 };

/**
 * Used by `faceEngine.ts`: the face a mood word draws. The word is the server's lower-cased one to three words; a hyphen is
 * read as a space ("mock-serious"). A word the map does not know, or none, is neutral.
 */
export function moodOf(word: string | null): CompanionFaceMood {
  if (word === null) return 'neutral';
  return FACE_OF_WORD.get(word.trim().toLowerCase().replace(/[-\s]+/g, ' ')) ?? 'neutral';
}

/** Used by `faceEngine.ts`: the lean of a mood's face in degrees, 0 for a mood that stands straight. */
export function moodTilt(mood: CompanionFaceMood): number {
  return MOOD_TILT[mood] ?? 0;
}
