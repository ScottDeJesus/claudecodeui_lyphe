import type { CompanionActionKind, CompanionActionTarget, CompanionPendingAction } from '@/shared/companion-types.js';

/**
 * THE CHECK OF HIS WORD: the pure judgment `take_action` makes before anything in the house moves. No I/O, no clock of its own and no
 * import but the contract's types, so it is shown by replaying rows from her log (`.verify/kaylee-action-word.mjs`) and by nothing else.
 *
 * Ruling 3, his words: "only on my explicit spoken word for that specific card, never on her own judgment, and never from a bare yes".
 * The rules that keep it so, each one a way to fail closed:
 *
 *   - HIS WORD IS A PRESS. Only a line of his talk button counts: a log row with role `operator` and via `spoken`. A typed line neither
 *     fires an action nor stands in as one, and the empty press (logged as `''`) names nothing.
 *   - THE NAME. Every significant word of the target's `spoken` name, or of its house name read as words, must be among his words, in
 *     any order. Requiring every significant word keeps "yes" and "that one" from naming anything; accepting either name keeps a
 *     misheard possessive ("Kaylee's eyes" heard as "Kaylee eyes") from refusing a clear request. A name with no significant word
 *     at all names nothing, because "every one of none" is true of any line; and a name whose only significant words are the
 *     action's own (the card "Epic queue" under a queue) names nothing either, because the one word would serve as the verb and as
 *     the name and a bare "Queue." would fire it. `canBeNamed` tells the prepare which targets these are, and it must not put one on
 *     the panel; `checkHisWord` refuses one that got there anyway, in words that say so.
 *   - THE VERB IS NOT THE NAME. When a name holds a word of the action's own beside others (the card "Probe eyes accept" under a queue,
 *     `accept` being a queue word), the words of the name he used are taken out of his line, one for one, and the action's word must
 *     stand in what is left: "Queue probe eyes accept." fires, the bare name and "Open probe eyes accept." do not, and a name that is the
 *     verb as well ("Queue queue drying") is ordered by saying the verb once more. A misheard "cue probe eyes accept" names the card
 *     and says no verb of its own, so it is refused.
 *   - THE READ-BACK. A sentence of hers that names the target stands in the log after the card went up and before his line.
 *   - AN ORDER, NOT A NO OR A QUESTION. The match is a bag of words, so "Don't queue Kaylee's eyes." holds the name and the verb. A line
 *     that ends in `?`, opens with a question word, or holds a negator is refused (`takesItBack`); a plain order is never refused, so
 *     the cure for a false refusal is to say the order again. A word that is part of the target's own name is not read as a negator.
 *   - Every time is judged so that a stamp that does not parse fails: each comparison is written as the thing that must hold, never as
 *     the thing that must not, because `NaN` is neither greater nor smaller than anything. The stamps are the store's own (fixed-width
 *     ISO-8601 UTC, which `heardSince` and `pending_json` hold and `isStoreStamp` judges); this file does not re-judge their shape.
 *
 * KNOWN LIMIT, SIBLINGS: the check holds ONE target and cannot see the cards beside it, so a line that names a shorter-named sibling's
 * words fires the pending card whose name those words cover ("Queue kaylee eyes." fires a pending card `kaylee`; a card `restorly--chat`
 * is covered by "restorly" alone, `chat` being a filler word). What holds the line is the full name in the card's `say` and in her
 * read-back, which he hears before he speaks; this file adds nothing to it.
 *
 * A press's logged text is the cleaned transcript (the transcription drops filler sounds and repeated words), and `take_action`
 * carries it verbatim, so the match against `said` is on the text as logged, trimmed with its whitespace folded.
 */

/**
 * The words that fire each action, the first of each list the one a refusal names and the one the prepare's answer tells her to listen
 * for. Multi-word entries are read as words (`wordsOf`) and held as a run. Consumed by `hands-tools.ts` (the prepare's answer names
 * them) and by `holdsActionWord` here.
 */
export const ACTION_WORDS: Readonly<Record<CompanionActionKind, readonly string[]>> = {
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
  open: ['open', 'show', 'pull up', 'bring up'],
  close_followup: ['close', 'done', 'tick', 'check off'],
};

/** Words that carry no name: articles, the kinds of thing a target can be, and the ways he is polite or points. Never required of his line. */
const NOT_SIGNIFICANT: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'of', 'to', 'for', 'on', 'in', 'at', 'and',
  'card', 'plan', 'feature', 'epic', 'run', 'page', 'chat', 'session', 'follow', 'up', 'followup',
  'please', 'it', 'its', 'my', 'this', 'that',
]);

/** A straight, a curly (either way) or a modifier apostrophe: all dropped, so "Kaylee's" is the one word "kaylees" however it was written. */
const APOSTROPHES = /['‘’ʼ]/g;

/**
 * His words as compared: lower case, apostrophes dropped, every other run of non-letters and non-digits one space, as the list of
 * words that leaves. `''` and a line of punctuation are no words. Consumed by this file's name and action checks, and shown on its own
 * by `.verify/kaylee-action-word.mjs`.
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
function ownWordsOf(action: CompanionActionKind): Set<string> {
  return new Set(ACTION_WORDS[action].flatMap(wordsOf));
}

/**
 * The words of a name that must be said: its own words less the ones that carry no name. With an `action`, a name whose every such word
 * is one of that action's own names nothing (an empty list): the word would be the verb and the name at once.
 */
function significantWordsOf(name: string, action?: CompanionActionKind): string[] {
  const significant = wordsOf(name).filter((word) => !NOT_SIGNIFICANT.has(word));
  if (action === undefined) return significant;
  const own = ownWordsOf(action);
  return significant.every((word) => own.has(word)) ? [] : significant;
}

/**
 * The names a target is known by: what he says it by (`spoken`) and its house name read as words — a card's `name`, a run's `plan`
 * when it has one and else its `runId`, a page's `pageId`. A chat and a follow-up are named by `spoken` alone.
 */
function namesOf(target: CompanionActionTarget): string[] {
  switch (target.kind) {
    case 'card':
      return [target.spoken, target.name];
    case 'run':
      return [target.spoken, target.plan ?? target.runId];
    case 'page':
      return [target.spoken, target.pageId];
    case 'chat':
    case 'followup':
      return [target.spoken];
  }
}

/**
 * True when every significant word of the target's `spoken`, or of its house name read as words, is among his words. Given the
 * `action`, a name made only of that action's own words names nothing (see the header). Bag-of-words by design: it holds ONE target and
 * cannot see its siblings, so a shorter-named card is covered by the longer name's words (the header's KNOWN LIMIT). Consumed by
 * `checkHisWord` below, which asks it of her read-back and of his line, and shown on its own by `.verify/kaylee-action-word.mjs`.
 */
export function namesTarget(said: string, target: CompanionActionTarget, action?: CompanionActionKind): boolean {
  const heard = new Set(wordsOf(said));
  return namesOf(target).some((name) => {
    const needed = significantWordsOf(name, action);
    return needed.length > 0 && needed.every((word) => heard.has(word));
  });
}

/**
 * Whether any line of his could name the target under the action: some name of it holds a significant word that is not the action's own.
 * A target that fails this (a chat called "Session", a card called "Epic queue" under a queue) can never be fired by voice, so the
 * prepare must refuse it at once instead of putting a card on the panel that only lapses. Consumed by `checkHisWord` below, and by the
 * prepare in `action-recipe.ts` (the hands' next file), which asks it of every target before the card goes up.
 */
export function canBeNamed(target: CompanionActionTarget, action: CompanionActionKind): boolean {
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

/**
 * True when his words hold one of the action's words as a word of their own: "restart" does not hold "start", and "pull it up" does not
 * hold "pull up". The plain predicate over the whole line; `checkHisWord` asks the stricter one below, with the target's name set aside.
 * Shown on its own by `.verify/kaylee-action-word.mjs`.
 */
export function holdsActionWord(said: string, action: CompanionActionKind): boolean {
  const words = wordsOf(said);
  return ACTION_WORDS[action].some((entry) => holdsRun(words, wordsOf(entry)));
}

/**
 * Whether his words say the action's word BESIDES the target's name: for each name of the target that his words cover, its significant
 * words are taken out of his line one occurrence each, and the action's word must stand in what is left; the name he used most fully
 * decides (the shortest remainder), so the check fails closed. Consumed by `checkHisWord` below, check 6.
 */
function holdsActionWordBesidesName(said: string, target: CompanionActionTarget, action: CompanionActionKind): boolean {
  const heard = wordsOf(said);
  let remainder: string[] | null = null;
  for (const name of namesOf(target)) {
    const needed = significantWordsOf(name);
    const left = [...heard];
    const covered = needed.length > 0 && needed.every((word) => {
      const at = left.indexOf(word);
      if (at === -1) return false;
      left.splice(at, 1);
      return true;
    });
    if (covered && (remainder === null || left.length < remainder.length)) remainder = left;
  }
  return remainder !== null && ACTION_WORDS[action].some((entry) => holdsRun(remainder, wordsOf(entry)));
}

/** Words that turn an order into a refusal: `dont`, `cant` and the rest are "don't" and "can't" with the apostrophe dropped (`wordsOf`). */
const NEGATORS: ReadonlySet<string> = new Set([
  'no', 'nope', 'not', 'never', 'without', 'cannot',
  'dont', 'doesnt', 'didnt', 'cant', 'couldnt', 'wont', 'wouldnt', 'shouldnt', 'isnt', 'arent', 'wasnt', 'werent', 'havent', 'hasnt',
]);

/** Words a question opens with ("Should I queue it?"). Only the line's first word is read. */
const QUESTION_OPENERS: ReadonlySet<string> = new Set(['should', 'can', 'could', 'would', 'do', 'does', 'is', 'are', 'will']);

/**
 * Whether the line is a no or a question and so no order: it ends in `?`, opens with a question word, or holds a negator. The target's
 * own name words are set aside first, so a card called "No more polling" or "Do not disturb" can still be ordered. A heuristic by design,
 * and a closed one: it can refuse a plain order that happens to say "no" ("Queue it, no problem"), never accept a refusal.
 */
function takesItBack(said: string, target: CompanionActionTarget): boolean {
  if (said.trim().endsWith('?')) return true;
  const nameWords = new Set(namesOf(target).flatMap(wordsOf));
  const words = wordsOf(said).filter((word) => !nameWords.has(word));
  return words.some((word) => NEGATORS.has(word)) || (words.length > 0 && QUESTION_OPENERS.has(words[0]));
}

/** A line as the match reads it: trimmed, every run of whitespace one space. */
const foldedText = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** A stamp's local HH:MM, as the panel's card and the prepare's answer say when it lapses; a stamp that does not parse is "an unknown time", never echoed. */
function clockOf(stamp: string): string {
  const moment = new Date(stamp);
  if (Number.isNaN(moment.getTime())) return 'an unknown time';
  return `${String(moment.getHours()).padStart(2, '0')}:${String(moment.getMinutes()).padStart(2, '0')}`;
}

const refusal = (sentence: string): { ok: false; sentence: string } => ({ ok: false, sentence });

/**
 * The checks of `take_action`, in order, on rows from her log (`heardSince`'s, oldest first): his line, or the one sentence that refuses.
 *
 *   1. nothing is pending (`pending` is `null`), or what is pending can be named by no line of his (`canBeNamed`);
 *   2. it lapsed: `now` is past `expiresAt`;
 *   3. no line he SPOKE after `preparedAt`, and at or before `expiresAt`, equals `said`. The firing line is the newest such line, so
 *      a line he says again after her read-back is the one that counts;
 *   4. no sentence of hers naming the target stands between `preparedAt` and that line;
 *   5. `said` does not name the target;
 *   6. `said` holds none of the action's words besides the target's name (`holdsActionWordBesidesName`), or is a no or a question and not
 *      an order (`takesItBack`).
 *
 * A spoken line equal to `said` but logged before the prepare is refused with check 3's sentence, as is a typed one: neither is a line
 * he spoke after the card went up. Each refusal says what to do. `pending` takes `null` so the caller hands over whatever her state
 * holds and check 1 is made here, in the one place the sentences live. Consumed by `hands-tools.ts` (`take_action`).
 */
export function checkHisWord(input: {
  pending: Pick<CompanionPendingAction, 'action' | 'target' | 'preparedAt' | 'expiresAt' | 'say'> | null;
  said: string;
  now: string;
  lines: Array<{ id: number; at: string; role: 'operator' | 'kaylee'; via: 'typed' | 'spoken' | null; text: string }>;
}): { ok: true; line: { id: number; at: string; text: string } } | { ok: false; sentence: string } {
  const { pending, said, now, lines } = input;
  if (!pending) return refusal('Nothing is waiting for his word; prepare it first.');
  if (!canBeNamed(pending.target, pending.action)) {
    return refusal(`No line of his can fire this: "${pending.target.spoken}" has no word of its own that is not the action itself or a filler word. Cancel it and tell him it cannot be done by voice.`);
  }

  const preparedMs = Date.parse(pending.preparedAt);
  const expiresMs = Date.parse(pending.expiresAt);
  // Written as "not still alive" so that a `now` or an `expiresAt` that does not parse reads as lapsed.
  if (!(Date.parse(now) <= expiresMs)) return refusal(`It lapsed at ${clockOf(pending.expiresAt)}; prepare it again.`);

  // A blank `said` equals the empty press's `''` once folded; it must name no line.
  const wanted = foldedText(said);
  const afterThePrepare = (stamp: string): boolean => Date.parse(stamp) > preparedMs;
  const spokenLines: typeof lines = wanted === ''
    ? []
    : lines.filter((row) =>
      row.role === 'operator'
      && row.via === 'spoken'
      && afterThePrepare(row.at)
      && Date.parse(row.at) <= expiresMs
      && foldedText(row.text) === wanted);
  const firing = spokenLines.reduce<(typeof lines)[number] | null>((newest, row) => (newest === null || row.id > newest.id ? row : newest), null);
  if (firing === null) return refusal(`That is not a line he spoke after the card went up. He must say it aloud: ${pending.say}.`);

  const readBack = lines.some((row) => row.role === 'kaylee' && row.id < firing.id && afterThePrepare(row.at) && namesTarget(row.text, pending.target, pending.action));
  if (!readBack) return refusal(`You have not read it back to him yet. Say it back first: ${pending.say}.`);

  if (!namesTarget(said, pending.target, pending.action)) return refusal(`His words do not name ${pending.target.spoken}.`);
  if (!holdsActionWordBesidesName(said, pending.target, pending.action)) return refusal(`His words do not say ${ACTION_WORDS[pending.action][0]}.`);
  if (takesItBack(said, pending.target)) return refusal(`That is a no or a question, not an order. He must say the order itself, aloud: ${pending.say}.`);

  return { ok: true, line: { id: firing.id, at: firing.at, text: firing.text } };
}
