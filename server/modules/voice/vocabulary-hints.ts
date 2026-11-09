/**
 * What each transcriber is told about the account's vocabulary up front, so a house word is spelled right at the source and the net
 * under it (`vocabulary-match.ts`) has less to catch. The home server gets the spellings alone as one line, for its cleanup to
 * respell sound-alikes by; Gemini, the backup, gets the spellings with how they sound. Pure text from a list, no storage.
 */

import type { VocabularyEntry } from '@/shared/types.js';

import { soundsAsWritten } from './vocabulary-match.js';

/**
 * The sentence appended to BOTH forms of Gemini's transcription instruction: the names that may be spoken, written exactly as
 * spelled, each with how it sounds when that differs from how it reads. Leads with a space so it joins the instruction as
 * it stands; empty for an empty vocabulary. Consumed by `gemini-transcribe.ts`.
 */
export function geminiVocabularyBlock(vocabulary: readonly VocabularyEntry[]): string {
  if (vocabulary.length === 0) return '';
  const names = vocabulary.map((entry) => (soundsAsWritten(entry) ? entry.spelling : `${entry.spelling} (sounds like "${entry.pronunciation}")`));
  return ` These names may be spoken; write them exactly as spelled: ${names.join(', ')}.`;
}

/**
 * The longest `prompt` line the home server is sent. The box reads a new line once, and a longer line costs the first cleanup after it
 * changes more: measured 2026-11-08, about 1.3 s plus 2 s per 1,000 characters (1.5 s for the seed's 79 characters, 5.6 s for 2,200, 14 to
 * 15.5 s for the 6,199 the vocabulary check allows at most, which outlasts the 15 s wait), then 0.8 s while the box holds it. 2,000
 * characters costs a first press some 5 s and holds some 100 words of 20 characters, far more than a house vocabulary is.
 */
const MAX_VOCABULARY_LINE_CHARS = 2_000;

/**
 * The account's vocabulary as the one line the home server takes in its `prompt` field: the spellings as a list, "Word1, Word2, Word3.".
 * The box's cleanup uses it to respell a word it heard as a sound-alike of one of these. Spellings only, in the account's order. A line
 * that would pass `MAX_VOCABULARY_LINE_CHARS` is cut to its first whole entries (the rest are still corrected after the box, by their
 * misheard forms), so a long list never makes the first press after an edit outlast the wait. Empty for an empty vocabulary, and the
 * caller then sends no `prompt`. Consumed by `speech-transcriber.ts`.
 */
export function homeServerVocabularyLine(vocabulary: readonly VocabularyEntry[]): string {
  const spellings = vocabulary.map((entry) => entry.spelling);
  while (lineOf(spellings).length > MAX_VOCABULARY_LINE_CHARS) spellings.pop();
  return lineOf(spellings);
}

/** The spellings as the box's one line, "Word1, Word2.", and `''` for none. */
function lineOf(spellings: readonly string[]): string {
  return spellings.length === 0 ? '' : `${spellings.join(', ')}.`;
}
