// Her name, in words. The page's ears decide on Moonshine's transcript and the server's press door strips Gemini's, both
// with the rules below, so what her name sounds like has one home.
//
// No recognizer separates "Kaylee" from "Kelly" by spelling (measured 2026-10-30 on 70 clips: Moonshine base wrote her
// name as Kaylee, Kaley, Killy and Kelly; Gemini wrote one of his four real "Kaylee"s as "Gilly"). So her default name
// opens on a FAMILY of sounds, and POSITION does the separating: her name must open what he says, after greetings only.
// In the middle of a sentence it never opens, and "Hey Kelly …" opening a sentence opens a press, by design.
//
// Pure: no I/O, no imports. Every word comparison is made on `foldWords` output.

/** The default name's folded form: the one whose family below stands in for it. */
const DEFAULT_NAME_FOLDED = 'kaylee';

/** Single spellings a recognizer wrote for the default name, or is known to. */
const FAMILY_SPELLINGS: ReadonlySet<string> = new Set([
  'kaylee', 'kayleigh', 'kayley', 'kaley', 'kailey', 'kaylie', 'caley', 'cayley', 'keely', 'keeley',
  'killy', 'kelly', 'callie', 'cali', 'kylie', 'gilly', 'haley', 'hailey', 'hayley',
]);

/** The shape of the rest: a hard k/c/g/q, one to three vowels (y counts), one or two l, then an -ee/-ey/-ie/-y ending. Kayly yes; Kyle, Cole, Kale, Cale and Call no. */
const FAMILY_SHAPE = /^[kcgq][aeiouy]{1,3}l{1,2}(ee|ey|ie|i|y|eigh|ei|ea)$/;

/** What the closing cut leaves behind at the end of his words and takes with it: a space, comma, semicolon, colon or dash. A sentence's own . ? or ! is not here. */
const TRAILING_PUNCTUATION = /[\s,;:\-–—]/u;

/** A first syllable of the default name, as a recognizer writes it when the clip stops mid-name. */
const FIRST_SYLLABLES: ReadonlySet<string> = new Set(['kay', 'kai', 'k']);

/** The words that may stand before her name: hey, hi, hello, okay, ok, oh, and a (a recognizer's "A. Kelly"). */
export const WAKE_GREETINGS: readonly string[] = ['hey', 'hi', 'hello', 'okay', 'ok', 'oh', 'a'];

/** The phrases that hold the mic when they end what he said. */
export const HOLD_PHRASES: readonly string[] = [
  'hold on', 'hang on', 'let me think', 'let me see', 'one second', 'one sec', 'just a second', 'just a sec',
  'give me a second', 'give me a sec', 'wait a second', 'wait a sec', 'bear with me',
];

const FOLDED_HOLD_PHRASES: readonly (readonly string[])[] = HOLD_PHRASES.map((phrase) => foldWords(phrase));

/** One folded word and the span of the original text it came from, so a cut lands on his own characters. */
type FoldedWord = { word: string; start: number; end: number };

/**
 * The folded words of `text`, each with the character span of its run in the original. A run is letters, digits and
 * apostrophes; the apostrophes ' and ’ drop out of the word. Anything else between runs is a break, so a run that
 * folds to several words (only an exotic case-mapping does that) hands them all the run's own span.
 */
function foldedWords(text: string): FoldedWord[] {
  const folded: FoldedWord[] = [];
  for (const run of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
    const start = run.index ?? 0;
    const end = start + run[0].length;
    for (const word of run[0].toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u)) {
      if (word) folded.push({ word, start, end });
    }
  }
  return folded;
}

/** His words as compared: lower case, apostrophes dropped, every other run of non-letters and non-digits one space, split. */
export function foldWords(text: string): string[] {
  return foldedWords(text).map((entry) => entry.word);
}

/**
 * Whether the word at `at` (or "kay lee" as two) is her name as a recognizer writes it: the measured family for the
 * default name, Kaylee; the name's own folded spelling for any other, one word or two (a longer name matches on its
 * first two). `length` is how many words matched; 1 when nothing did.
 */
export function isHerName(words: readonly string[], at: number, name: string): { matched: boolean; length: 1 | 2 } {
  const word = words[at];
  if (word === undefined) return { matched: false, length: 1 };
  const nameWords = foldWords(name);
  if (nameWords.join(' ') === DEFAULT_NAME_FOLDED) {
    if (FAMILY_SPELLINGS.has(word) || FAMILY_SHAPE.test(word)) return { matched: true, length: 1 };
    if (word === 'kay' && words[at + 1] === 'lee') return { matched: true, length: 2 };
    return { matched: false, length: 1 };
  }
  const target = nameWords.slice(0, 2);
  if (target.length === 0 || word !== target[0]) return { matched: false, length: 1 };
  if (target.length === 2) return words[at + 1] === target[1] ? { matched: true, length: 2 } : { matched: false, length: 1 };
  return { matched: true, length: 1 };
}

/** How many words from the front are greetings. */
function countGreetings(words: readonly string[]): number {
  let count = 0;
  while (count < words.length && WAKE_GREETINGS.includes(words[count])) count += 1;
  return count;
}

/**
 * "yes" when her name opens the words, after greetings only. "unsure" for greetings and nothing else, or (default name)
 * greetings then a first syllable of it (kay, kai, k): the clip may have stopped mid-name, so the page asks again.
 * The syllable need only follow a greeting: more words may come after it ("Hey Kay, open the roadmap" is "unsure", one more
 * check and then "no"), and a syllable with no greeting before it ("Kay, open the roadmap") is "no".
 * Else "no": no words, her name past the first word, anything.
 */
export function opensWithName(text: string, name: string): 'yes' | 'unsure' | 'no' {
  const words = foldWords(text);
  const greetings = countGreetings(words);
  if (greetings === words.length) return words.length === 0 ? 'no' : 'unsure';
  if (isHerName(words, greetings, name).matched) return 'yes';
  const isDefaultName = foldWords(name).join(' ') === DEFAULT_NAME_FOLDED;
  if (isDefaultName && greetings > 0 && FIRST_SYLLABLES.has(words[greetings])) return 'unsure';
  return 'no';
}

/** The index of the "over" that starts a close phrase ENDING the words ("over to you" and her name, nothing after), else -1. */
function closeStartIndex(words: readonly string[], name: string): number {
  for (const nameLength of [1, 2] as const) {
    const over = words.length - nameLength - 3;
    if (over < 0 || words[over] !== 'over' || words[over + 1] !== 'to' || words[over + 2] !== 'you') continue;
    const herName = isHerName(words, over + 3, name);
    if (herName.matched && herName.length === nameLength) return over;
  }
  return -1;
}

/** True when the words end with "over to you" and her name. "Hand it over to you" closes nothing: it has no name after it. */
export function endsWithClose(text: string, name: string): boolean {
  return closeStartIndex(foldWords(text), name) !== -1;
}

/** True when the words end with one of HOLD_PHRASES. The words stay his: "hold on to that" does not end with a hold. */
export function endsWithHold(text: string): boolean {
  const words = foldWords(text);
  return FOLDED_HOLD_PHRASES.some((phrase) => (
    phrase.length > 0 && words.length >= phrase.length && phrase.every((word, offset) => words[words.length - phrase.length + offset] === word)
  ));
}

/**
 * Gemini's transcript of a name press, less its opening greeting and name and its closing "over to you, <name>".
 * The two cuts are independent, each made in the ORIGINAL text at the matched words' own character positions, so every
 * other character stays as Gemini wrote it. After the opening cut the leading punctuation and spaces go and the first
 * letter is upper-cased; after the closing cut the trailing spaces and a trailing comma, semicolon, colon or dash go,
 * and a sentence's own . ? or ! stays. A text with neither cut comes back trimmed and otherwise untouched. A transcript
 * that is only her close ("Over to you, Kaylee.") comes back `{ rest: '', called: false, closed: true }`.
 */
export function stripCall(text: string, name: string): { rest: string; called: boolean; closed: boolean } {
  const entries = foldedWords(text);
  const words = entries.map((entry) => entry.word);

  const greetings = countGreetings(words);
  const herName = isHerName(words, greetings, name);
  const called = herName.matched;
  const openCutEnd = called ? entries[greetings + herName.length - 1].end : 0;

  // A close phrase that began inside the opening cut is no close: the name cannot be both.
  const closeAt = closeStartIndex(words, name);
  const closed = closeAt !== -1 && (!called || closeAt >= greetings + herName.length);
  const closeCutStart = closed ? entries[closeAt].start : text.length;

  let rest = text.slice(openCutEnd, closeCutStart);
  if (called) rest = rest.replace(/^[\s\p{P}]+/u, '').replace(/^\p{L}/u, (letter) => letter.toUpperCase());
  if (closed) rest = rest.slice(0, trailingCutStart(rest));
  return { rest: rest.trim(), called, closed };
}

/** Where the trailing run of spaces, commas, semicolons, colons and dashes of `text` begins: one pass from the end (a `[…]+$` regex rescans a long run from every start). */
function trailingCutStart(text: string): number {
  let start = text.length;
  while (start > 0 && TRAILING_PUNCTUATION.test(text[start - 1])) start -= 1;
  return start;
}
