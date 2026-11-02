/**
 * The vocabulary's two text replacements, one engine: the misheard forms of a transcript become the entry's spelling (the net
 * under both transcribers), and the spellings of a sentence Kaylee is about to say become their pronunciation (her speech).
 * Both are "replace these whole words or phrases, longest first, and touch nothing else".
 */

import type { VocabularyEntry } from '@/shared/types.js';
import { STANDALONE_EDGE_AFTER, STANDALONE_EDGE_BEFORE } from '@/shared/word-edges.js';

/** One replacement: the words to find and what stands in their place. */
type Replacement = { find: string; replaceWith: string };

/** What may join the words of a phrase: any run of spaces and hyphens, so "life CLI", "life  CLI" and "life-CLI" are one phrase. */
const PHRASE_JOINER = /[\s-]+/u;

/**
 * What a replaced word may carry away with it: a possessive ("Kailee's" → "Kaylee's", "dactyls'") or a plural "s", kept as it
 * was said. After the tail the word edge applies again, so "Kaileex" is still a different word.
 */
const TAIL = "(?:['’]s|s['’]|['’]|s)?";

/**
 * A phrase in the one form two spellings of it share: lower case, every run of spaces and hyphens one space. The key a match is
 * looked up by, and the form the validation compares in. Consumed by `vocabulary-check.ts` (duplicates, conflicts).
 */
export function phraseKey(phrase: string): string {
  return phrase.trim().toLowerCase().split(PHRASE_JOINER).filter(Boolean).join(' ');
}

/** The phrase as a pattern: its words literal, the joiner between them flexible. */
function phrasePattern(phrase: string): string {
  return phrase
    .trim()
    .split(PHRASE_JOINER)
    .filter(Boolean)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s-]+');
}

/**
 * Replaces every whole-word or whole-phrase occurrence of each `find` with its `replaceWith`, in one pass over the text so a
 * replacement is never itself replaced. Case-insensitive; the longest phrase wins where two start at the same place. A word
 * edge refuses a letter, digit, `_`, apostrophe or hyphen on either side and a `:` `/` `@` or joining `.`, so a word inside a longer
 * word, an identifier, a path, a file name or an e-mail address is never touched. The text comes back byte for byte when nothing matched.
 */
function replacePhrases(text: string, replacements: readonly Replacement[]): string {
  const replacementByKey = new Map<string, string>();
  const patterns: Array<{ key: string; pattern: string }> = [];
  for (const { find, replaceWith } of replacements) {
    const key = phraseKey(find);
    if (key === '' || replacementByKey.has(key)) continue;
    replacementByKey.set(key, replaceWith);
    patterns.push({ key, pattern: phrasePattern(find) });
  }
  if (patterns.length === 0) return text;

  // The longest first: an alternation takes the first alternative that fits, so "life CLI" is tried before anything shorter.
  const alternatives = patterns.sort((a, b) => b.key.length - a.key.length).map(({ pattern }) => pattern).join('|');
  const matcher = new RegExp(`${STANDALONE_EDGE_BEFORE}(${alternatives})(${TAIL})${STANDALONE_EDGE_AFTER}`, 'giu');
  return text.replace(matcher, (match, found: string, tail: string) => {
    const replacement = replacementByKey.get(phraseKey(found));
    return replacement === undefined ? match : replacement + tail;
  });
}

/**
 * Whether the entry is said as it is written: the pronunciation holds the same letters and digits as the spelling, ignoring
 * case, spaces and punctuation ("Kaylee" and "kay-lee" are one; "lypheCli" and "life C-L-I" are not). Respelling such an
 * entry would change nothing a voice can hear, so it is left out. Consumed by `vocabulary-hints.ts` (the Gemini block leaves out
 * "sounds like" for such an entry) and `respellForSpeech` below.
 */
export function soundsAsWritten(entry: VocabularyEntry): boolean {
  const letters = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return letters(entry.pronunciation) === letters(entry.spelling);
}

/**
 * The net under both transcribers: every misheard form in the vocabulary, found as a whole word or phrase in any case, becomes
 * the entry's spelling exactly. A possessive or plural tail stays ("Kailee's" → "Kaylee's"). A word that is in no entry's
 * misheard list is never touched. Consumed by `transcript-cleanup.ts`, the one step both transcribers' text passes through.
 */
export function correctMisheardWords(text: string, vocabulary: readonly VocabularyEntry[]): string {
  return replacePhrases(
    text,
    vocabulary.flatMap((entry) => entry.misheard.map((form) => ({ find: form, replaceWith: entry.spelling }))),
  );
}

/**
 * The text as Kaylee's voice should be told it: each spelling that is said differently from how it is written ("lypheCli",
 * said "life C-L-I") replaced by its pronunciation, longest spelling first so "lypheCli" goes before "Lyphe". For synthesis
 * only: what the person reads, and what is logged, keeps the spelling. Consumed by `gemini-speech.ts` (Kaylee's sentences)
 * and `voice-provider.ts` (the chat's read-aloud).
 */
export function respellForSpeech(text: string, vocabulary: readonly VocabularyEntry[]): string {
  return replacePhrases(
    text,
    vocabulary.filter((entry) => !soundsAsWritten(entry)).map((entry) => ({ find: entry.spelling, replaceWith: entry.pronunciation })),
  );
}
