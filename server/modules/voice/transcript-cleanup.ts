/**
 * Transcript cleanup: the house's own post-processor of a transcript, for the chat mic and Kaylee's press alike. Two steps, in this
 * order. First, when it is asked to (the account's `cleanTranscripts` setting is on, and for the home server's text only when the
 * box's own cleanup did not run: the box cleans its transcript itself and the house does not do it again, bar one question it puts to
 * a tidied text, whether it is nothing but fillers, which the box leaves in), it removes what a person does not mean to say (um, uh,
 * a word said twice, a cut-off "w-what") and nothing else. A false positive that drops a real word is worse than a missed filler, so
 * every rule below leans toward leaving the text alone. It is English: the lists and the repeat rule know English words, so a speaker
 * of another language turns the setting off in Settings → Voice. Second, always, the account's vocabulary replaces each misheard form
 * of a house word with its spelling (`vocabulary-match.ts`), on the box's text too; an empty vocabulary does nothing.
 */

import type { VocabularyEntry } from '@/shared/types.js';
import { STANDALONE_EDGE_AFTER, STANDALONE_EDGE_BEFORE, WORD_EDGE_AFTER, WORD_EDGE_BEFORE } from '@/shared/word-edges.js';

import { correctMisheardWords } from './vocabulary-match.js';

//----------------- THE LISTS: edit these; the code below only reads them ------------

/**
 * Sounds that are filler wherever they stand alone as a word, written exactly as listed. Matched case-insensitively and never
 * inside a longer word, a hyphenated one, a format string, a path or an address, so "uh-huh" and "mm-hmm" (both mean yes), "HH:mm:ss",
 * "mm/dd" and "er.ts" survive. An ALL-CAPS "ER" or "MM" is left alone (the emergency room, a unit): a transcriber writes the
 * sound in lower case or capitalised. "er" lives here, not below, because "err" is a word.
 */
const FILLER_SOUNDS = ['er'];

/**
 * Filler sounds a person draws out: the last letter may repeat, so "um" also reads "umm" and "ummmm", and "hmm" reads "hmmmm".
 * Each is a filler at its listed length or longer ("mm" is two m's, never one). The same edges as `FILLER_SOUNDS` apply.
 */
const DRAWN_OUT_FILLER_SOUNDS = ['um', 'uh', 'ah', 'erm', 'hmm', 'mm', 'mhm'];

/**
 * Phrases that are filler only when SET OFF: at least one comma against them, and the other side a comma or the edge of a
 * sentence. "Can you, you know, restart it?" loses it; "Do you know where it is?" and "as you know, it works" keep theirs.
 */
const SET_OFF_FILLER_PHRASES = ['you know'];

/**
 * Words that usually lead into what follows. A comma after one of them belongs to a filler that cut the clause short ("I want
 * to, uh, check"), so it leaves with the filler; after any other word the comma stays ("Well, uh, I think" keeps "Well,").
 * A wrong guess here costs a comma. A hyphenated repeat of one ("the-the") is a stutter, where "yo-yo" and "bye-bye" are words.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'this', 'these', 'those', 'that', 'my', 'your', 'our', 'their', 'his', 'her', 'its',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'into',
  'and', 'or', 'but', 'if', 'as', 'than', 'not',
  'i', 'you', 'we', 'they', 'he', 'she', 'it',
  'is', 'am', 'are', 'was', 'were', 'be', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would', 'should',
]);

/**
 * Words a clause strictly cannot end on: articles and possessive determiners, "and/or/but/if/as/than", "to" and "of", the
 * subject pronouns that are never objects (not "you", "it", "her": "Thank you, you did great"), modals (they end a clause only
 * in an ellipsis) and subject contractions. A comma, ellipsis or dash between two copies lets a repeat go ONLY when the copy
 * ends on one of these: "the, the lane" and "I want to, I want to go" are a restart, where "Restart the server, the server
 * crashed" and "I tried it, it failed" are two clauses. Copies with only spaces between them need no such word.
 */
const NEVER_ENDS_A_CLAUSE = new Set([
  'a', 'an', 'the', 'my', 'your', 'our', 'their', 'its',
  'and', 'or', 'but', 'if', 'as', 'than', 'to', 'of',
  'i', 'we', 'they', 'he', 'she',
  'can', 'could', 'will', 'would', 'should', 'must', 'might', 'may', 'shall',
  "i'm", "i'd", "i'll", "i've", "we're", "we'd", "we'll", "we've", "they're", "they'd", "they'll", "they've",
  "you're", "you'd", "you'll", "you've", "he's", "she's", "it's", "that's", "there's", "here's", "what's", "who's", "let's",
]);

/** Spoken numbers: they may stand twice in a row ("twenty one, one hundred") and they make a "mm" after them a unit ("five mm"). */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty',
  'ninety', 'hundred', 'thousand', 'million', 'billion',
];

/**
 * Words that may stand twice in a row on purpose: grammar ("he had had enough", "I know that that is true"), emphasis and
 * acknowledgement ("no, no, no", "very very good", "yeah, yeah"), and the spoken numbers.
 */
const MAY_BE_SAID_TWICE = new Set([
  'had', 'that',
  'no', 'yes', 'yeah', 'yep', 'okay', 'ok', 'right', 'sure', 'fine', 'now', 'well', 'again', 'come', 'go',
  'very', 'really', 'so', 'bye', 'ha', 'wow', 'please', 'sorry', 'hey', 'hello', 'wait', 'stop',
  ...NUMBER_WORDS,
]);

/**
 * Two-letter prefixes that make a real word out of "prefix-word" even when the word starts with the prefix ("re-render",
 * "de-dedupe"). A fragment of three or four letters is never a stutter without a space after its dash, so no longer prefix is listed.
 */
const PREFIXES_THAT_LOOK_LIKE_STUTTERS = new Set(['re', 'de', 'un', 'co', 'ex']);

/** Real hyphenated words that a stutter rule would otherwise shorten. */
const REAL_HYPHENATED_WORDS = new Set(['t-test']);

// ---------------------------

/**
 * Left in the text where a removed filler opened a sentence; the next lowercase letter after it becomes a capital. A private-use
 * character, so it can never be a character a person said.
 */
const RECAPITALISE_NEXT = '';

/** The text before a candidate ends where a sentence opens: the start, after a full stop, question or exclamation mark, or after an opening quote that begins a line ("He said, “Um, …"). */
const SENTENCE_OPENING = /(?:^|[.?!…]["'”’)\]]*)\s*(?:["“‘]\s*)*$|[,:]\s*["“‘]\s*$/u;
/**
 * A letter or a digit: what makes a text words rather than only punctuation and space. Consumed by `removeDisfluencies` below and by
 * `speech-transcriber.ts`, which reads a home server answer with no such character as a clip with no speech.
 */
export const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;
const LAST_WORD = /([\p{L}\p{N}'’]+)\s*$/u;

/** A list entry as a pattern: spaces inside a phrase match any run of whitespace. */
function toPattern(entry: string): string {
  return entry.split(' ').join('\\s+');
}

//----------------- STUTTERED FRAGMENTS: "w-what", "th- the", "I-I-I" ------------

const STUTTERED_WORD = new RegExp(`${WORD_EDGE_BEFORE}((?:\\p{Script=Latin}{1,4}[-‐–—][ \\t]?)+)(\\p{Script=Latin}+)`, 'giu');
const FRAGMENT_PIECE = /(\p{Script=Latin}{1,4})([-‐–—])([ \t]?)/giu;

/**
 * The whole word for a cut-off start of it. Every fragment must be the start of the word that follows ("w-what", "th- the"); a
 * fragment that IS the word counts only for a function word ("the-the", "I-I"). A fragment of three or four letters is often a
 * word itself ("see—seems", "per-person"), so it counts only as a trailing-off mark: a hyphen with a space after it ("wha- what").
 * A prefix that makes a real word ("re-render") counts only when a space follows its dash. Anything else is returned untouched.
 */
function completeStutteredWord(match: string, fragments: string, word: string): string {
  const pieces = [...fragments.matchAll(FRAGMENT_PIECE)];
  const lowerWord = word.toLowerCase();
  const isStutter = pieces.every(([, fragment, dash, space]) => {
    const lowerFragment = fragment.toLowerCase();
    if (!lowerWord.startsWith(lowerFragment)) return false;
    if (lowerFragment === lowerWord) return FUNCTION_WORDS.has(lowerWord);
    const isHyphenWithSpace = (dash === '-' || dash === '‐') && space !== '';
    if (fragment.length > 2 && !isHyphenWithSpace) return false;
    return space !== '' || !PREFIXES_THAT_LOOK_LIKE_STUTTERS.has(lowerFragment);
  });
  if (!isStutter) return match;
  if (pieces.length === 1 && REAL_HYPHENATED_WORDS.has(`${pieces[0][1]}-${word}`.toLowerCase())) return match;

  // "W-what" opening a sentence: the word that stays takes the capital the fragment had.
  const fragmentWasCapitalised = /^\p{Lu}/u.test(fragments) && /^\p{Ll}/u.test(word);
  return fragmentWasCapitalised ? word[0].toUpperCase() + word.slice(1) : word;
}

//----------------- FILLERS: "um", "uh", ", you know," ------------

/** Every filler as one pattern: the exact sounds, the drawn-out ones (last letter repeated) and the set-off phrases. */
const FILLER_ALTERNATIVES = [
  ...FILLER_SOUNDS,
  ...DRAWN_OUT_FILLER_SOUNDS.map((sound) => `${sound}${sound.slice(-1)}*`),
  ...SET_OFF_FILLER_PHRASES.map(toPattern),
].join('|');

const FILLER = new RegExp(`(,[ \\t]*)?${STANDALONE_EDGE_BEFORE}(${FILLER_ALTERNATIVES})${STANDALONE_EDGE_AFTER}([ \\t]*,)?`, 'giu');
const NUMBER_WORD_SET = new Set(NUMBER_WORDS);

/** The last word of a text, lower-cased, or undefined when it ends on none. */
function lastWordOf(text: string): string | undefined {
  return LAST_WORD.exec(text)?.[1].toLowerCase();
}

function interruptsClause(textBefore: string): boolean {
  const lastWord = lastWordOf(textBefore);
  return lastWord !== undefined && FUNCTION_WORDS.has(lastWord);
}

/** A phrase filler stands only with a comma against it and a comma or a sentence edge on its other side. */
function isSetOff(leadComma: string | undefined, trailComma: string | undefined, textBefore: string, textAfter: string): boolean {
  if (!leadComma && !trailComma) return false;
  const leftIsEdge = Boolean(leadComma) || SENTENCE_OPENING.test(textBefore);
  const rightIsEdge = Boolean(trailComma) || /^\s*(?:[.?!…]|$)/u.test(textAfter);
  return leftIsEdge && rightIsEdge;
}

/**
 * What stands where a filler was, or the filler itself when it is not one here. Its own commas go; a comma before it stays
 * when the clause it cut was complete ("Well, uh, I think" → "Well, I think"). A filler that opened a sentence leaves a
 * mark that capitalises the word that now opens it.
 */
function replaceFiller(
  match: string,
  leadComma: string | undefined,
  filler: string,
  trailComma: string | undefined,
  offset: number,
  whole: string,
): string {
  const textBefore = whole.slice(0, offset);
  const isPhrase = /\s/.test(filler);
  const isShouted = filler.length > 1 && filler === filler.toUpperCase();
  // "5 mm" and "five mm" are lengths, not a hum.
  const isUnit = /^m+$/i.test(filler) && (/\d\s*$/.test(textBefore) || NUMBER_WORD_SET.has(lastWordOf(textBefore) ?? ''));
  if (isShouted || isUnit) return match;
  if (isPhrase && !isSetOff(leadComma, trailComma, textBefore, whole.slice(offset + match.length))) return match;

  const separator = leadComma && !interruptsClause(textBefore) ? ', ' : ' ';
  return (SENTENCE_OPENING.test(textBefore) ? RECAPITALISE_NEXT : '') + separator;
}

//----------------- REPEATS: "the the", "I want to, I want to go" ------------

const REPEAT_WORD = "[\\p{Script=Latin}\\p{N}]+(?:['’-][\\p{Script=Latin}\\p{N}]+)*";
/** What may stand between two copies besides spaces: commas, an ellipsis, a dash. Never a full stop, question or exclamation mark: "Go. Go." is two sentences. */
const PUNCTUATED_GAP = '(?:[\\s,…]|\\.{3}|[—–]|(?<=\\s)-(?=\\s))+';

/**
 * A word or phrase of up to three words, then one or more copies of it with `gap` between. The unit is tried shortest first
 * (lazy), so a run of any length collapses in one pass: "the the the the" is "the", not "the the".
 */
function repeatedUnitPattern(gap: string): RegExp {
  return new RegExp(`${WORD_EDGE_BEFORE}(${REPEAT_WORD}(?:${gap}${REPEAT_WORD}){0,2}?)(?:${gap}\\1${WORD_EDGE_AFTER})+`, 'giu');
}

/** Copies with only spaces between them: a stutter, whatever the words ("I I want", "the server the server"). */
const SPACED_REPEAT = repeatedUnitPattern('\\s+');
/** Copies with a comma, ellipsis or dash between them: a stutter only when the copy ends on a word a clause cannot end on. */
const PUNCTUATED_REPEAT = repeatedUnitPattern(PUNCTUATED_GAP);
const REPEAT_WORDS = new RegExp(REPEAT_WORD, 'giu');

/** Whether the unit's last word is one a clause cannot end on, so that a repeat across a comma, ellipsis or dash is a restart and not a new clause. */
function endsOnWordThatNeedsMore(unit: string): boolean {
  const words = unit.toLowerCase().replace(/’/g, "'").match(REPEAT_WORDS) ?? [];
  return NEVER_ENDS_A_CLAUSE.has(words[words.length - 1] ?? '');
}

/** A repeat is collapsed unless it may be meant: a number, a lone letter other than "a" and "I", or words that can stand twice. */
function isDisfluentRepeat(unit: string): boolean {
  const words = unit.toLowerCase().match(REPEAT_WORDS) ?? [];
  if (words.some((word) => /\p{N}/u.test(word))) return false;
  if (words.every((word) => MAY_BE_SAID_TWICE.has(word))) return false;
  if (words.length === 1 && words[0].length === 1 && words[0] !== 'a' && words[0] !== 'i') return false;
  return true;
}

//----------------- SPACING AND PUNCTUATION LEFT BEHIND ------------

/**
 * Fixes what the removals leave: the recapitalised sentence start (past the hesitation mark the filler dragged along: "Hmm... okay"
 * → "Okay"; a word with a capital inside it, an identifier like "useEffect", keeps its case), double spaces, the second of two
 * dashes that bounded a filler ("Okay—um—go" → "Okay—go"), a space after an opening quote, a space before punctuation, ", ."
 * and a stray comma or full stop at the start or a comma at the end. Runs only when something was removed.
 */
function tidy(text: string): string {
  return text
    .replace(
      new RegExp(`${RECAPITALISE_NEXT}[\\s.…,;:]*(\\p{Ll}[\\p{L}\\p{N}_]*)`, 'gu'),
      (_match, word: string) => (/\p{Lu}/u.test(word) ? word : word[0].toUpperCase() + word.slice(1)),
    )
    .split(RECAPITALISE_NEXT).join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([—–])[ \t]+[—–]/g, '$1')
    .replace(/([ \t])-[ \t]+-(?=[ \t])/g, '$1-')
    .replace(/(^|[\s(,:])(["“‘])[ \t]+/g, '$1$2')
    // A sentence-ending filler leaves its own full stop behind: "Okay. Um." → "Okay. ." → "Okay."
    .replace(/([.!?…])[ \t]+[.!?…]+/g, '$1')
    .replace(/[ \t]+([,.;:!?…])/g, '$1')
    .replace(/,([.!?…])/g, '$1')
    // A leading full stop or ellipsis is a leftover, unless a digit follows it (".5 mm").
    .replace(/^(?:[\s,;:]|[.…](?!\p{N}))+/u, '')
    .replace(/[\s,;:]+$/, '');
}

/**
 * Removes the disfluencies from one transcript: filler sounds ("um", "uh", "hmm"), a set-off "you know", a word or a short
 * phrase said twice in a row, and cut-off fragments ("w-what"), then fixes the spacing and punctuation they leave. Every other word
 * stays as spoken, in its order. Text with nothing to remove comes back byte for byte. A result with no letter or digit in it
 * (a lone "Um.") is `''`, which the callers already treat as "nothing was said".
 */
function removeDisfluencies(text: string): string {
  const withoutFragments = text.replace(STUTTERED_WORD, completeStutteredWord);
  const withoutFillers = withoutFragments.replace(FILLER, replaceFiller);
  const withoutSpacedRepeats = withoutFillers.replace(SPACED_REPEAT, (match, unit: string) => (isDisfluentRepeat(unit) ? unit : match));
  const withoutRepeats = withoutSpacedRepeats.replace(
    PUNCTUATED_REPEAT,
    (match, unit: string) => (isDisfluentRepeat(unit) && endsOnWordThatNeedsMore(unit) ? unit : match),
  );

  const cleaned = withoutRepeats === text ? text : tidy(withoutRepeats);
  return HAS_WORD_CHARACTER.test(cleaned) ? cleaned : '';
}

/**
 * What a transcript comes to before anyone reads it: its disfluencies removed when `removeFillers` is on, then, after that and
 * whatever the switch says, each misheard form of a house word in `vocabulary` replaced by its spelling. An empty vocabulary is
 * how that second step is turned off. Text with nothing to change comes back byte for byte; a lone "Um." with fillers removed is `''`.
 * Consumed by `speech-transcriber.ts` (the home server's text: `removeFillers` only when cleanup was asked and the box did not do it,
 * and the corrections always; and, with an empty vocabulary, to ask of any text with cleanup asked whether a lone filler is all it
 * holds) and `gemini-transcribe.ts` (the backup's text: `removeFillers` is the account's `cleanTranscripts`).
 */
export function cleanTranscript(text: string, options: { removeFillers: boolean; vocabulary: readonly VocabularyEntry[] }): string {
  const withoutDisfluencies = options.removeFillers ? removeDisfluencies(text) : text;
  return correctMisheardWords(withoutDisfluencies, options.vocabulary);
}
