/**
 * What each transcriber is told about the account's vocabulary up front, so a house word is spelled right at the source and the
 * net under it (`vocabulary-match.ts`) has less to catch. Gemini takes instructions, so it gets the spellings with how they
 * sound; Whisper takes none, so it gets a prompt of the spellings alone. Pure text from a list, no storage.
 */

import type { VocabularyEntry } from '@/shared/types.js';

import { soundsAsWritten } from './vocabulary-match.js';

/**
 * Whisper's `prompt` is limited to 224 tokens. Names tokenise badly, so the cap is counted in characters and set where even one
 * token per character stays under the limit.
 */
const WHISPER_PROMPT_MAX_CHARS = 200;

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
 * Whisper's `prompt` for the account's vocabulary: the spellings as a short list of names, which steers its spelling of them
 * (it takes no instruction, only text to continue in the style of). Entries are dropped from the END, whole, until it fits
 * `WHISPER_PROMPT_MAX_CHARS`; empty for an empty vocabulary, and the caller then sends no prompt. Consumed by `voice-provider.ts` and
 * `local-transcribe.ts`, whose service reads the same list as the names to respell sound-alikes to.
 */
export function whisperVocabularyPrompt(vocabulary: readonly VocabularyEntry[]): string {
  const names: string[] = [];
  // The closing full stop counts.
  let length = 1;
  for (const { spelling } of vocabulary) {
    const added = spelling.length + (names.length === 0 ? 0 : 2);
    if (length + added > WHISPER_PROMPT_MAX_CHARS) break;
    names.push(spelling);
    length += added;
  }
  return names.length === 0 ? '' : `${names.join(', ')}.`;
}
