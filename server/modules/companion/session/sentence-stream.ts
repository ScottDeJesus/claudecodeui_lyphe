import type { CompanionSound } from '@/shared/companion-types.js';

/**
 * Her words, cut into sentences and read once. The model streams text a few characters at a time;
 * `createSentenceStream` finds where each sentence ends, and `parseExpression` turns one raw sentence
 * into the three things the rest of the house wants: the leading `mood`, the `display` text the panel
 * draws, and her `sounds` as offsets into it.
 *
 * Both are PURE: no I/O and no import beyond the contract's types, so they are proven on real
 * strings under `tsx`. The sentence cut depends on the text alone, never on how the deltas happened
 * to be sized — the same paragraph pushed a character at a time or all at once yields the same
 * sentences. A sentence ends where the next one can begin: after a terminator run (`.` `!` `?` `…`
 * and any closing quote) and its whitespace, a lowercase letter carries her sentence on, because she
 * never begins one in lowercase — so a quotation inside a sentence stays one breath, and a wrong join
 * costs a little latency and no words.
 *
 * The sounds the parse keeps are the caller's list, never one of its own: the account's `gemini.soundTags`
 * (the voice module's settings), which `session/companion-turns.ts` hands it for every sentence of a turn and
 * `session/companion-message.ts` hands `fillRegister` at every push. She is taught exactly the sounds the parse
 * keeps, so she is never taught a sound the filter then deletes.
 *
 * Consumers: `session/companion-turns.ts` (the stream, one per turn and flushed at the end of each
 * text block, and the parse of every sentence it emits).
 */

/** A sentence longer than this is a run-on and is cut at its last comma or space; every piece is at most this long. */
const MAX_SENTENCE_CHARS = 300;

const TERMINATORS = new Set(['.', '!', '?', '…']);

/** Characters that may close a quotation or parenthesis right after the terminator: `He said "no." Then…` ends at the quote. */
const CLOSERS = new Set(['"', "'", ')', '”', '’']);

/**
 * Abbreviations whose full stop does not end a sentence, lower-cased with their own dots. Small on
 * purpose: a longer list starts swallowing real sentence ends ("etc." before a new sentence still
 * keeps the next one attached, which costs a little latency and no words).
 */
const ABBREVIATIONS = new Set(['e.g.', 'i.e.', 'etc.', 'vs.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'jr.', 'sr.', 'cf.']);

/** A list number at the start of a sentence — `1.`, `- 2.` — which `parseExpression` strips as a marker and so must arrive whole. */
const LEADING_LIST_NUMBER = /^\s*(?:[-*•]\s+)?\d+\.$/;

type Cut = { end: number; next: number };
/** A sentence end whose whitespace runs to the buffer's end, so what follows it has not arrived: `waitingEnd` is where it would fall. */
type WaitingCut = { waitingEnd: number };

/** Whether the text ending at `terminatorIndex` (a `.`) ends in an abbreviation, a list number, or neither. */
function dotDoesNotEndSentence(text: string, terminatorIndex: number): boolean {
  const upToDot = text.slice(0, terminatorIndex + 1);
  if (LEADING_LIST_NUMBER.test(upToDot)) return true;
  const lastSpace = Math.max(upToDot.lastIndexOf(' '), upToDot.lastIndexOf('\t'));
  // Leading punctuation is ignored so "(e.g." and "\"Dr." match their bare forms.
  const token = upToDot.slice(lastSpace + 1).replace(/^[^A-Za-z0-9]+/, '').toLowerCase();
  return ABBREVIATIONS.has(token);
}

/**
 * What the whitespace after a terminator run says, read from `gapStart` (its first character): the
 * sentence `'ends'` when the gap holds a newline or the next character is not a lowercase letter, it
 * `'goes-on'` when a lowercase letter follows (she never begins a sentence in lowercase, so that
 * letter carries the one before it on), and it is `'undecided'` while the buffer ends inside the gap.
 * A gap of more than 300 whitespace characters ends the sentence without waiting for what follows it,
 * so a flood of spaces cannot hold the buffer open and be rescanned at every push.
 */
function readGapAfterTerminator(text: string, gapStart: number): 'ends' | 'goes-on' | 'undecided' {
  let at = gapStart;
  for (; at < text.length && /\s/.test(text[at]); at += 1) {
    if (text[at] === '\n' || at - gapStart >= MAX_SENTENCE_CHARS) return 'ends';
  }
  if (at === text.length) return 'undecided';
  // A lowercase letter outside the BMP is a surrogate pair a delta may have split: its first half alone decides nothing.
  if (at + 1 === text.length && /[\uD800-\uDBFF]/.test(text[at])) return 'undecided';
  return /^\p{Ll}/u.test(text.slice(at, at + 2)) ? 'goes-on' : 'ends';
}

/**
 * The first sentence end in `text` that is already decided, or null. A terminator run (`.` `!` `?` `…`
 * with any closing quote or bracket after it) is decided only by what comes AFTER it: no whitespace (a
 * digit of "3.5", a letter of "e.g.") does not end the sentence; whitespace holding a newline ends it;
 * whitespace and then a lowercase letter does not, so a quotation inside her sentence (`I've drafted
 * "Reply with PONG." for that chat`) and "3 p.m. today" stay one sentence, while any other character
 * after the whitespace ends it. The end of the buffer right after the run decides nothing (null); inside
 * its whitespace it answers a `WaitingCut`, so a delta that splits a terminator from its neighbour
 * changes nothing and the run-on cut can tell an end still arriving from none. A newline always ends a sentence.
 */
function findCut(text: string): Cut | WaitingCut | null {
  // The last terminator of the run just walked ("?!", "...", `."`), -1 when the characters behind
  // this one are not such a run. A closer keeps the run alive; any other character ends it.
  let terminatorIndex = -1;
  // A cut past 300 characters is replaced by the run-on cut, so nothing further is read: one large push
  // then costs each piece a bounded scan, not a walk of everything still pending.
  const scanEnd = Math.min(text.length, MAX_SENTENCE_CHARS + 1);
  for (let index = 0; index < scanEnd; index += 1) {
    const char = text[index];
    if (char === '\n') return { end: index, next: index + 1 };
    if (TERMINATORS.has(char)) terminatorIndex = index;
    else if (!CLOSERS.has(char)) terminatorIndex = -1;
    if (terminatorIndex === -1) continue;
    const following = text[index + 1];
    if (following === undefined) return null; // undecided: the next delta says what follows
    if (!/\s/.test(following)) continue;
    if (text[terminatorIndex] === '.' && dotDoesNotEndSentence(text, terminatorIndex)) continue;
    const gap = readGapAfterTerminator(text, index + 1);
    if (gap === 'undecided') return { waitingEnd: index + 1 }; // the buffer ends inside the whitespace: the next delta says what follows it
    if (gap === 'goes-on') continue;
    return { end: index + 1, next: index + 1 };
  }
  return null;
}

/** How far back an opener can be and still hold a cut off: a tag or a mood is a few words, so a `<` or `[` further back than this is a stray, not a span. */
const SPAN_REACH_CHARS = 40;

/**
 * Whether position `index` of `text` falls inside a `<…>` or `[…]` span that has not closed yet. Only
 * the last `SPAN_REACH_CHARS` characters are read: a stray opener with no closer must not turn every
 * later cut off and tear a word in two, and reading only text before `index` keeps the answer the
 * same however the deltas were sized.
 */
function insideOpenSpan(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - SPAN_REACH_CHARS), index);
  return before.lastIndexOf('<') > before.lastIndexOf('>') || before.lastIndexOf('[') > before.lastIndexOf(']');
}

/**
 * Where to cut a run-on: at the last comma (kept with the piece) or space (dropped) inside the first
 * 300 characters, never inside a tag or bracket that opened just before it — a cut through
 * `<short pause>` would leave two pieces neither of which is a sound. A 300-character word with
 * neither is cut hard at 300.
 */
function findRunOnCut(text: string): Cut {
  for (let index = MAX_SENTENCE_CHARS - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char !== ',' && !/\s/.test(char)) continue;
    if (insideOpenSpan(text, index)) continue;
    return char === ',' ? { end: index + 1, next: index + 1 } : { end: index, next: index + 1 };
  }
  return { end: MAX_SENTENCE_CHARS, next: MAX_SENTENCE_CHARS };
}

/**
 * Turns streamed text into sentences. `push` takes the next delta — it may split a word, a tag or a
 * terminator anywhere — and calls `onSentence` once for each sentence the text now settles: a `.`,
 * `!`, `?` or `…` (with any closing quote after it) followed by whitespace and then anything but a
 * lowercase letter, or a newline. A lowercase letter after the whitespace carries the sentence on
 * (`I've drafted "Reply with PONG." for that chat` is one sentence), and while the buffer ends inside
 * that whitespace nothing is emitted yet. Abbreviations ("e.g.", "Dr."), decimal
 * numbers ("3.5") and a leading list number ("1.") stay whole, and a run-on past 300 characters is
 * cut at its last comma or space. `flush` emits what is left, and is called at the end of EACH text
 * block of a turn, not only at the turn's end: a block ends with no whitespace after its last
 * sentence, so without a flush the next block's first characters join it ("Let me check.[delighted]
 * Okay…" as one sentence, the mood dropped, spoken only after the tool between them returns).
 * Sentences arrive trimmed and never empty. Consumed by the companion session, one stream per turn.
 */
export function createSentenceStream(onSentence: (raw: string) => void): { push(delta: string): void; flush(): void } {
  let pending = '';

  const emit = (text: string): void => {
    const sentence = text.trim();
    if (sentence !== '') onSentence(sentence);
  };

  const drain = (): void => {
    for (;;) {
      pending = pending.replace(/^\s+/, '');
      if (pending === '') return;
      const found = findCut(pending);
      // An end within 300 that waits on the character after its whitespace holds the run-on cut off: the whole text keeps that sentence whole.
      if (found !== null && 'waitingEnd' in found && found.waitingEnd <= MAX_SENTENCE_CHARS) return;
      const cut = found !== null && 'end' in found ? found : null;
      // A sentence that will certainly pass 300 characters is cut now, whether or not its end has arrived.
      const needsRunOnCut = pending.length > MAX_SENTENCE_CHARS && (cut === null || cut.end > MAX_SENTENCE_CHARS);
      const chosen = needsRunOnCut ? findRunOnCut(pending) : cut;
      if (chosen === null) return;
      const sentence = pending.slice(0, chosen.end);
      // The buffer moves before the callback runs, so a throwing consumer cannot make a sentence repeat.
      pending = pending.slice(chosen.next);
      emit(sentence);
    }
  };

  return {
    push(delta: string): void {
      pending += delta;
      drain();
    },
    flush(): void {
      const rest = pending;
      pending = '';
      emit(rest);
    },
  };
}

/** Marks where a kept sound stood while the text is cleaned: a private-use character no markdown or whitespace rule touches. */
const SOUND_MARK = '\uE000';
const SOUND_MARK_PATTERN = /\uE000/g;

const MAX_MOOD_WORDS = 3;

/** A leading list marker (`- `, `* `, `+ `, `1. `, `2) `) or a heading's `#` run. */
const LEADING_MARKER = /^\s*(?:[-*+•]\s+|\d+[.)]\s+|#+(?:\s+|$))/;

function stripLeadingMarker(text: string): string {
  return text.replace(LEADING_MARKER, '');
}

/**
 * What follows the `<` of a comparison rather than a tag: whitespace or `=` (`x < y`, `a <= b`). A tag
 * has its name right against the `<` (`<whisper>`, `</whisper>`, `<br/>`, `<1>`), so every span that
 * does not open this way is a tag and is dropped — which keeps the words between two comparison signs
 * (`if x < y then keep it, but z > w`).
 */
const COMPARISON_OPENING = /^[\s=]/;

/**
 * Takes the leading `[mood]` off `text`: one to three words, lower-cased. A leading bracket of more
 * words is not a mood and is left for the bracket pass to drop.
 */
function takeLeadingMood(text: string): { mood: string | null; rest: string } {
  const match = /^\s*\[([^[\]]*)\]/.exec(text);
  if (match === null) return { mood: null, rest: text };
  const inner = match[1].trim().replace(/\s+/g, ' ');
  const wordCount = inner === '' ? 0 : inner.split(' ').length;
  if (wordCount < 1 || wordCount > MAX_MOOD_WORDS) return { mood: null, rest: text };
  return { mood: inner.toLowerCase(), rest: text.slice(match[0].length) };
}

/** Markdown residue removed: `**`, `__`, paired single `*`/`_` emphasis, backticks. Underscores inside a word (`snake_case`) are not emphasis. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/\*([^*\s][^*]*?)\*/g, '$1')
    .replace(/(^|[^A-Za-z0-9_])_([^_\s][^_]*?)_(?![A-Za-z0-9_])/g, '$1$2')
    .replace(/`/g, '');
}

/**
 * Reads the angle spans of `text`: a sound on the allow-list becomes `SOUND_MARK` and its tag is
 * collected in order; every other span is dropped, leaving the words between an open and a close tag;
 * a span whose `<` is followed by whitespace or `=` (a "less than") stays as text. An unclosed `<` is
 * not a span and stays as written.
 */
function readAngleSpans(text: string, allowed: ReadonlySet<string>): { text: string; tags: string[] } {
  const tags: string[] = [];
  const replaced = text.replace(/<([^<>]*)>/g, (span, inner: string) => {
    const tag = inner.trim().replace(/\s+/g, ' ').toLowerCase();
    if (allowed.has(tag)) {
      tags.push(tag);
      return SOUND_MARK;
    }
    return tag === '' || !COMPARISON_OPENING.test(inner) ? '' : span;
  });
  return { text: replaced, tags };
}

/**
 * Builds the display text from the cleaned, whitespace-collapsed `norm` (sound marks still in it):
 * the marks come out, each recorded at the display length where it stood. A mark records the offset
 * BEFORE the space that follows the word it came after, so it sits on that word's end; a mark glued
 * between two words leaves one space behind; a space left in front of punctuation by a dropped span
 * is closed up.
 */
function buildDisplay(norm: string, tags: readonly string[]): { display: string; sounds: CompanionSound[] } {
  let display = '';
  let nextTag = 0;
  const sounds: CompanionSound[] = [];
  for (let index = 0; index < norm.length; index += 1) {
    const char = norm[index];
    if (char === SOUND_MARK) {
      sounds.push({ tag: tags[nextTag], at: display.trimEnd().length });
      nextTag += 1;
      const following = norm[index + 1];
      if (display !== '' && !display.endsWith(' ') && following !== undefined && following !== ' ' && following !== SOUND_MARK) display += ' ';
      continue;
    }
    if (char === ' ' && (display === '' || display.endsWith(' '))) continue;
    if (/[.,!?;:…]/.test(char) && display.endsWith(' ')) display = display.slice(0, -1);
    display += char;
  }
  return { display: display.trimEnd(), sounds };
}

/**
 * Reads one raw sentence of hers. A leading `[mood]` of one to three words is the `mood`; every
 * other square-bracket span is dropped. An angle tag whose text is on `soundTags` (compared lower
 * case) is a sound: it is removed from `display` and listed in `sounds` with its offset into
 * `display`; every other angle tag is dropped and the words inside it stay (`<whisper>secret</whisper>`
 * is "secret"). Markdown residue goes, whitespace collapses and the text is trimmed. The answer is
 * null when there is nothing to show: an empty `display` and no sounds. Consumed by the companion
 * session for every sentence she says.
 */
export function parseExpression(
  raw: string,
  soundTags: readonly string[]
): { mood: string | null; display: string; sounds: CompanionSound[] } | null {
  const allowed = new Set(soundTags.map((tag) => tag.trim().replace(/\s+/g, ' ').toLowerCase()));
  // The mark is the parse's own private-use character; one in her text would read as a sound with no tag.
  const input = raw.replace(SOUND_MARK_PATTERN, '');
  // A marker is stripped on both sides of the mood: "- [gentle] hi" and "[gentle] - hi" both mean "hi".
  const afterMarker = stripLeadingMarker(input);
  const { mood, rest } = takeLeadingMood(afterMarker);
  const angles = readAngleSpans(mood === null ? afterMarker : stripLeadingMarker(rest), allowed);
  const cleaned = stripMarkdown(angles.text.replace(/\[[^[\]]*\]/g, ''));
  const norm = cleaned
    .replace(/\s+/g, ' ')
    .replace(/ ([.,!?;:…])/g, '$1')
    .trim();
  const { display, sounds } = buildDisplay(norm, angles.tags);
  if (display === '' && sounds.length === 0) return null;
  return { mood, display, sounds };
}
