import type { CompanionActionTarget, CompanionCeremonyAction } from '@/shared/companion-types.js';

import { clockOf } from './action-prompts.js';

/**
 * THE ONE CHECK OF `take_action`: that the action on his panel was read back to him, and which line of his is the record of what he
 * said. The pure judgment `take_action` makes before anything in the house moves. No I/O, no clock of its own and no import but the
 * contract's types and the prompts' clock, so it is shown by replaying rows from her log (`.verify/kaylee-action-word.mjs`) and by nothing else.
 *
 * The server does not read his words, and it does not decide when to fire. Whether a line of his was a yes, and when, is Kaylee's
 * judgment, made in conversation the way she judges everything else he says (Scott, 2026-10-30: "He definitely wants Kaylee to decide,
 * and no one else; no scripted word"; "a typed line on her panel counts too"). No yes list, no no list, no name match and no action word
 * is compared with a line of his, a line he typed is as good as one he spoke, and cancelling is her call too (`cancel_action`).
 *
 * What the server keeps is ONE check, each part a way to fail closed. It is not proof that he answered: her sentences are logged as she
 * produces them, so her read-back and her `take_action` can be one turn with nothing of his since the card went up. That is the operator's
 * ruling (Scott, 2026-10-30, no floor), and the read-back detector below is the whole of what the server checks.
 *
 *   - THE READ-BACK. A sentence of hers that names the target stands in the log after the ceremony began (`armedFrom`), in ANY of her
 *     turns (for her memory, whose house name is the common word "memory", it must also hold the action's word or say "your memory").
 *   - THE LAPSE AND THE RE-ARM. An action waits thirty minutes (`expiresAt`). One that lapsed, was refused by the door or was replaced is
 *     prepared again by the same action on the same target and content, which RE-ARMS it (`action-rearm.ts`): the new card keeps the
 *     first prepare's stamp as `armedFrom` and has a fresh `expiresAt`, so her read-back from before still stands, for an hour from that
 *     first prepare and no longer: a prepare past that is a fresh ceremony and wants a read-back of its own.
 *   - Every time is judged so that a stamp that does not parse fails: each comparison is written as the thing that must hold, never as
 *     the thing that must not, because `NaN` is neither greater nor smaller than anything. The stamps are the store's own (fixed-width
 *     ISO-8601 UTC, which `heardSince` and `pending_json` hold and `isStoreStamp` judges); this file does not re-judge their shape.
 *
 * THE RECORD. The record of an act carries one line of his by its id in her log: the dispatcher's relay door requires an integer `press`
 * (`dispatcher shapes relay`), and the row's claim (`claimAction`) is written with the same id. So the check always hands `take_action` a real
 * line: the one since `armedFrom` that equals what `take_action` was handed (once folded), else his newest since `armedFrom`, else his newest
 * line with words in it, of any age (`newestLine`, the record an `open` carries). It is the record, never a test: `said` differing from the log refuses
 * nothing, and a take with no line of his since the read-back is not refused. Only a log that holds no line of his at all has nothing to record.
 *
 * KNOWN LIMIT, SIBLINGS: the read-back detector holds ONE target and cannot see the cards beside it, so a sentence of hers that says the
 * words of a shorter-named pending card in passing ("kaylee" for a card `kaylee`) counts as its read-back. What holds the line is the full
 * name the prepare's answer tells her to read back, in her own words.
 */

/**
 * The words that mark each action. A name made only of them names nothing (`significantWordsOf`, so `canBeNamed`), and `holdsActionWord`
 * uses them to keep a passing mention of the common word "memory" from counting as a read-back of the clear.
 */
const ACTION_WORDS: Readonly<Record<CompanionCeremonyAction, readonly string[]>> = {
  queue: ['queue', 'accept', 'approve'],
  hide: ['hide'],
  show: ['show', 'unhide'],
  rework: ['rework', 're work'],
  answer: ['answer', 'answers'],
  recut: ['recut', 're cut', 'cut'],
  stop: ['stop', 'pause'],
  resume: ['resume', 'start', 'unpause'],
  kick: ['kick', 'wake'],
  resume_run: ['resume', 'rerun', 're run', 'continue'],
  clear_memory: ['clear', 'wipe', 'erase', 'empty', 'forget everything'],
};

/** Words that carry no name: articles, the kinds of thing a target can be, and the ways she is polite or points. Never required of her read-back. */
const NOT_SIGNIFICANT: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'on', 'in', 'at', 'and',
  'card', 'plan', 'feature', 'epic', 'run', 'page', 'chat', 'session', 'follow', 'up', 'followup',
  'please', 'it', 'its', 'my', 'this', 'that',
]);

/** A straight, a curly (either way) or a modifier apostrophe: all dropped, so "Kaylee's" is the one word "kaylees" however it was written. */
const APOSTROPHES = /['‘’ʼ]/g;

/**
 * A text as compared: lower case, apostrophes dropped, every other run of non-letters and non-digits one space, as the list of words
 * that leaves. `''` and a line of punctuation are no words. Consumed by this file's read-back detector, and by `action-recipe.ts`
 * (`clear_memory` needs a target that says "memory").
 */
export function wordsOf(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

/** Every single word the action's own words are made of: `pull up` is `pull` and `up`. */
function ownWordsOf(action: CompanionCeremonyAction): Set<string> {
  return new Set(ACTION_WORDS[action].flatMap(wordsOf));
}

/**
 * The words of a name that must be said: its own words less the ones that carry no name. With an `action`, a name whose every such word
 * is one of that action's own names nothing (an empty list): the word would be the verb and the name at once.
 */
function significantWordsOf(name: string, action?: CompanionCeremonyAction): string[] {
  const significant = wordsOf(name).filter((word) => !NOT_SIGNIFICANT.has(word));
  if (action === undefined) return significant;
  const own = ownWordsOf(action);
  return significant.every((word) => own.has(word)) ? [] : significant;
}

/**
 * The names a target is known by: what she says it by (`spoken`) and its house name read as words — a card's `name`, a run's `plan`
 * when it has one and else its `runId`, a page's `pageId`, her memory's the one word "memory" (so "Clear my memory." names it as
 * surely as "Clear your memory."; "your" is the one significant word of `spoken` that "my" is not, and "memory" is the other). A chat,
 * a follow-up and a check are named by `spoken` alone (a check by its label).
 */
function namesOf(target: CompanionActionTarget): string[] {
  switch (target.kind) {
    case 'card':
      return [target.spoken, target.name];
    case 'run':
      return [target.spoken, target.plan ?? target.runId];
    case 'page':
      return [target.spoken, target.pageId];
    case 'memory':
      return [target.spoken, 'memory'];
    case 'chat':
    case 'followup':
    case 'check':
      return [target.spoken];
  }
}

/** What cuts a long title from its detail: the first of these in a spoken name ends its head. */
const TAIL_SPLITTERS = [' — ', ' – ', ': ', ' ('] as const;

/** The head of a spoken name that has a tail, when the head holds at least two significant words; else `null`. */
function headOf(spoken: string): string | null {
  const cuts = TAIL_SPLITTERS.map((splitter) => spoken.indexOf(splitter)).filter((at) => at > 0);
  if (cuts.length === 0) return null;
  const head = spoken.slice(0, Math.min(...cuts));
  return significantWordsOf(head).length >= 2 ? head : null;
}

/** Where a trailing prepositional phrase of a head opens: the whitespace or comma before one of these words. */
const TAIL_PREPOSITION = /[\s,;]+(?:for|of|to|on|in|at|with|from|by|about|under)(?=[\s,;.]|$)/gi;

/**
 * The head less its trailing prepositional phrase ("Technician intake form" of "Technician intake form for the scheduler"): cut at the
 * first preposition that leaves two or more significant words; else `null`, and the phrase is required.
 */
function shortHeadOf(head: string): string | null {
  for (const match of head.matchAll(TAIL_PREPOSITION)) {
    const short = head.slice(0, match.index).trim();
    if (significantWordsOf(short).length >= 2) return short;
  }
  return null;
}

/** `namesOf`, plus the head of a long spoken name and that head less its trailing phrase: the names she may read the target back by. */
function sayableNamesOf(target: CompanionActionTarget): string[] {
  const head = headOf(target.spoken);
  if (head === null) return namesOf(target);
  const short = shortHeadOf(head);
  return [...namesOf(target), head, ...(short === null ? [] : [short])];
}

/**
 * True when every significant word of the target's `spoken`, or of its house name read as words, or of the head of a long `spoken`, is
 * among the words of `text`. Given the `action`, a name made only of that action's own words names nothing (see `canBeNamed`).
 * Bag-of-words by design: it holds ONE target and cannot see its siblings (the header's KNOWN LIMIT). Consumed by `readsBack` below.
 */
function namesTarget(text: string, target: CompanionActionTarget, action?: CompanionCeremonyAction): boolean {
  const heard = new Set(wordsOf(text));
  return sayableNamesOf(target).some((name) => {
    const needed = significantWordsOf(name, action);
    return needed.length > 0 && needed.every((word) => heard.has(word));
  });
}

/**
 * Whether any sentence of hers could name the target under the action: some name of it holds a significant word that is not the
 * action's own. A target that fails this (a chat called "Session", a card called "Epic queue" under a queue) can never be recognised in
 * a read-back, so a take would be refused for want of one however often she said it; the prepare must refuse it at once instead of
 * putting a card on the panel that only lapses. Consumed by `checkHisWord` below, and by the prepare in `action-recipe.ts`, which asks
 * it of every target before the card goes up.
 */
export function canBeNamed(target: CompanionActionTarget, action: CompanionCeremonyAction): boolean {
  return namesOf(target).some((name) => significantWordsOf(name, action).length > 0);
}

/** Whether `run` (one or more words) stands in `words` as written, side by side and in order. */
function holdsRun(words: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0) return false;
  for (let start = 0; start + run.length <= words.length; start += 1) {
    if (run.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}

/** True when `text` holds one of the action's words as a word of its own: "restart" does not hold "start", and "re cut" is held as the run "re cut". */
function holdsActionWord(text: string, action: CompanionCeremonyAction): boolean {
  const words = wordsOf(text);
  return ACTION_WORDS[action].some((entry) => holdsRun(words, wordsOf(entry)));
}

/**
 * Whether a sentence of hers reads the action back: it names the target. Her memory's house name is the common word "memory", so by that
 * alone a sentence about her memory in passing ("Let me check my memory for that.") would count as the read-back; it counts only beside the
 * action's word, or by the name she says it by ("your memory"). Consumed by `checkHisWord` below, and by the drivers under `.verify/`
 * that look for her read-back in a log.
 */
export function readsBack(text: string, target: CompanionActionTarget, action: CompanionCeremonyAction): boolean {
  if (!namesTarget(text, target, action)) return false;
  if (target.kind !== 'memory') return true;
  const heard = new Set(wordsOf(text));
  return holdsActionWord(text, action) || significantWordsOf(target.spoken, action).every((word) => heard.has(word));
}

/** A line as the match reads it: trimmed, every run of whitespace one space. */
const foldedText = (text: string): string => text.trim().replace(/\s+/g, ' ');

const refusal = (sentence: string): { ok: false; sentence: string } => ({ ok: false, sentence });

/** A row of her log as `heardSince` answers it: his lines (`operator`, spoken or typed) and hers (`kaylee`). */
type Heard = { id: number; at: string; role: 'operator' | 'kaylee'; text: string };

/** The last of rows already in log order, or `null` when there are none. */
const newestOf = (rows: readonly Heard[]): Heard | null => rows[rows.length - 1] ?? null;

/**
 * The checks of `take_action`, in order, on rows from her log (`heardSince(armedFrom)`'s): the line of his that is the record of his
 * word, or the one sentence that refuses.
 *
 *   1. nothing is pending (`pending` is `null`), or what is pending can be named by no sentence of hers (`canBeNamed`);
 *   2. it lapsed: `now` is past `expiresAt` (the sentence says to prepare it again, which re-arms it);
 *   3. no sentence of hers reading the target back (`readsBack`) stands after `armedFrom`.
 *
 * Past those three the take passes, and the record is chosen (see THE RECORD above): the line of his that equals `said` once folded, else
 * his newest since `armedFrom`, else `newestLine`. Whether he agreed, and when, was hers to decide before she called. Each refusal says what to
 * do. `pending` takes `null` so the caller hands over whatever her state holds and check 1 is made here, in the one place the sentences
 * live. `armedFrom` is the stamp the ceremony began (the prepare's own stamp, or the first prepare's across a re-arm). `newestLine` is his
 * newest operator line with words in it, of any age, or `null` when the log holds none. Consumed by `hands-tools.ts` (`take_action`).
 */
export function checkHisWord(input: {
  pending: { action: CompanionCeremonyAction; target: CompanionActionTarget; armedFrom: string; expiresAt: string } | null;
  said: string;
  now: string;
  lines: Heard[];
  newestLine: Heard | null;
}): { ok: true; line: { id: number; at: string; text: string } } | { ok: false; sentence: string } {
  const { pending, said, now, lines, newestLine } = input;
  if (!pending) return refusal('Nothing is on his panel; prepare it first.');
  const { action, target } = pending;
  if (!canBeNamed(target, action)) {
    return refusal(`Nothing you say can be recognised as reading this back: "${target.spoken}" has no word of its own that is not the action itself or a filler word. Cancel it and tell him it cannot be done from here.`);
  }

  // Written as "not still alive" so that a `now` or an `expiresAt` that does not parse reads as lapsed.
  if (!(Date.parse(now) <= Date.parse(pending.expiresAt))) {
    return refusal(`It lapsed at ${clockOf(pending.expiresAt)}. Prepare it again: that re-arms it, and your read-back from before the lapse still stands.`);
  }

  const armedMs = Date.parse(pending.armedFrom);
  const afterTheArm = (row: Heard): boolean => Date.parse(row.at) > armedMs;
  const inOrder = [...lines].sort((a, b) => a.id - b.id).filter(afterTheArm);

  if (!inOrder.some((row) => row.role === 'kaylee' && readsBack(row.text, target, action))) {
    return refusal(`You have not read it back to him yet. Read it back to him plainly in your own words first: what you will do, and to what, naming "${target.spoken}" in full. Then call again.`);
  }

  const wanted = foldedText(said);
  const hisLines = inOrder.filter((row) => row.role === 'operator' && foldedText(row.text) !== '');
  // A press with no words is a log row too (`companion-press.ts`); the dispatcher's relay refuses empty `words`, so it is never the record.
  const withWords = newestLine !== null && foldedText(newestLine.text) !== '' ? newestLine : null;
  const record = newestOf(hisLines.filter((row) => foldedText(row.text) === wanted)) ?? newestOf(hisLines) ?? withWords;
  if (record === null) {
    return refusal('Nothing of his stands in the log to record as his word. Ask him, then call again.');
  }

  return { ok: true, line: { id: record.id, at: record.at, text: record.text } };
}
