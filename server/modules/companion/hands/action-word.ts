import type { CompanionActionTarget, CompanionCeremonyAction } from '@/shared/companion-types.js';

/**
 * THE CHECK OF HIS WORD: the pure judgment `take_action` makes before anything in the house moves. No I/O, no clock of its own and no
 * import but the contract's types, so it is shown by replaying rows from her log (`.verify/kaylee-action-word.mjs`) and by nothing else.
 *
 * Ruling 3, his words, as he re-ruled it on 2026-10-29: "only on my explicit spoken word for that specific card, never on her own
 * judgment"; "My 'yes' should count. When the action on the panel is the only one and I say yes, that is my word for it"; and, the same
 * day, "Keep the full ceremony only for the actions that change the house: queue, hide, show, rework, answer, recut, stop, resume,
 * kick, resume_run, clear_memory", with the lapse raised to thirty minutes and a re-arm that accepts "my next yes without me having to
 * say the title". Those eleven are the only actions that wait for his word; open and close_followup are done at once
 * (`hands/direct-tools.ts`) and never reach this file. The rules that keep it so, each one a way to fail closed:
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
 *   - THE READ-BACK. A sentence of hers that names the target stands in the log after the ceremony began (`armedFrom`), in ANY of her
 *     turns, and before his line (for her memory, whose house name is the common word "memory", it must also hold the action's word or
 *     say "your memory").
 *   - THE LAPSE AND THE RE-ARM. An action waits thirty minutes (`expiresAt`). One that lapsed is prepared again by the same action on the
 *     same target and content, which RE-ARMS it: the new card keeps the first prepare's stamp as `armedFrom` and has a fresh `expiresAt`, so
 *     her read-back from before the lapse still stands for his YES, and a yes spoken after the lapse and before the re-arm is his word. Only
 *     a bare yes rides on that old read-back: a line that names the target and says the action is an order of its own, and it needs a
 *     read-back after the re-arm (`preparedAt`), as it does under a fresh ceremony. The binding below holds across the re-arm.
 *   - HIS WORD IS EITHER a line that names the target and holds the action's word, or an ASSENT (`isAssent`): a yes word (yes, yeah, yep,
 *     yup, sure, okay, ok, alright, correct, "go ahead", "do it", "fire it", "send it", "please do", "that's right") carried by nothing but
 *     "please", "it", "that" and "now" ("Yes.", "Sure, go ahead.", "Do it now."). Anything more ("Go on.", "Okay, so.", "Yes, queue it.")
 *     is no bare assent; the last goes through the name-and-verb checks as a named order. The action's own word beside "it" is never a
 *     yes ("Forget it.", "Stop it.", "Cut it.": what he says to decline). The panel holds one action, so a yes is for it; a question
 *     mark ("Yes?") still takes it back.
 *   - A BARE YES is bound to the read-back it answers: it counts only as his FIRST spoken line after her NEWEST read-back of the target,
 *     with no spoken line of his after it. A named order keeps the newest-line rule.
 *   - THE HEAD OF A LONG TITLE. A spoken name with a tail ("Technician intake form for the scheduler — skills, certifications, …") is also
 *     named by all the significant words of its head, when the head holds two or more; a trailing prepositional phrase of the head
 *     ("for the scheduler") is optional while two significant words remain without it ("open the technician intake form"). The full name
 *     still names it. Nobody says a tail.
 *   - AN ORDER, NOT A NO OR A QUESTION. The match is a bag of words, so "Don't queue Kaylee's eyes." holds the name and the verb. A line
 *     that ends in `?`, opens with a question word, or holds a negator is refused (`takesItBack`); a plain order is never refused, so
 *     the cure for a false refusal is to say the order again. A word that is part of the target's own name is not read as a negator.
 *     The action that retires a whole bank (`clear_memory`) is stricter: only a line that opens with its word is an order, so a statement
 *     about her memory ("My memory is clear.") never fires it.
 *   - Every time is judged so that a stamp that does not parse fails: each comparison is written as the thing that must hold, never as
 *     the thing that must not, because `NaN` is neither greater nor smaller than anything. The stamps are the store's own (fixed-width
 *     ISO-8601 UTC, which `heardSince` and `pending_json` hold and `isStoreStamp` judges); this file does not re-judge their shape.
 *
 * KNOWN LIMIT, SIBLINGS: the check holds ONE target and cannot see the cards beside it, so a line that names a shorter-named sibling's
 * words fires the pending card whose name those words cover ("Queue kaylee eyes." fires a pending card `kaylee`; a card `restorly--chat`
 * is covered by "restorly" alone, `chat` being a filler word). What holds the line is the full name in the card's `say` and, for a FULL
 * action, in her read-back, which he hears before he speaks; this file adds nothing to it.
 *
 * A press's logged text is the cleaned transcript (the transcription drops filler sounds and repeated words), and `take_action`
 * carries it verbatim, so the match against `said` is on the text as logged, trimmed with its whitespace folded.
 */

/**
 * The words that fire each action, the first of each list the one a refusal names and the one the prepare's answer tells her to listen
 * for. Multi-word entries are read as words (`wordsOf`) and held as a run. Consumed by `hands-tools.ts` (the prepare's answer names
 * them) and by `holdsActionWord` here.
 */
export const ACTION_WORDS: Readonly<Record<CompanionCeremonyAction, readonly string[]>> = {
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
 * The names a target is known by: what he says it by (`spoken`) and its house name read as words — a card's `name`, a run's `plan`
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

/** `namesOf`, plus the head of a long spoken name and that head less its trailing phrase: the names he may say the target by. */
function sayableNamesOf(target: CompanionActionTarget): string[] {
  const head = headOf(target.spoken);
  if (head === null) return namesOf(target);
  const short = shortHeadOf(head);
  return [...namesOf(target), head, ...(short === null ? [] : [short])];
}

/**
 * The shortest name the check takes for the target: the head less its trailing phrase, else the head, else `spoken`. What the prepare's
 * answer tells her to listen for, so she never asks him for a title the server takes shorter. Consumed by `action-prompts.ts` (`nextStepFor`).
 */
export function shortNameOf(target: CompanionActionTarget): string {
  const head = headOf(target.spoken);
  return head === null ? target.spoken : (shortHeadOf(head) ?? head);
}

/**
 * True when every significant word of the target's `spoken`, or of its house name read as words, or of the head of a long `spoken`, is among his words. Given the
 * `action`, a name made only of that action's own words names nothing (see the header). Bag-of-words by design: it holds ONE target and
 * cannot see its siblings, so a shorter-named card is covered by the longer name's words (the header's KNOWN LIMIT). Consumed by
 * `checkHisWord` below, which asks it of her read-back and of his line, and shown on its own by `.verify/kaylee-action-word.mjs`.
 */
export function namesTarget(said: string, target: CompanionActionTarget, action?: CompanionCeremonyAction): boolean {
  const heard = new Set(wordsOf(said));
  return sayableNamesOf(target).some((name) => {
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

/**
 * True when his words hold one of the action's words as a word of their own: "restart" does not hold "start", and "re cut" is held as the
 * run "re cut". The plain predicate over the whole line; `checkHisWord` asks the stricter one below, with the target's name set aside.
 * Shown on its own by `.verify/kaylee-action-word.mjs`.
 */
export function holdsActionWord(said: string, action: CompanionCeremonyAction): boolean {
  const words = wordsOf(said);
  return ACTION_WORDS[action].some((entry) => holdsRun(words, wordsOf(entry)));
}

/**
 * Whether his words say the action's word BESIDES the target's name: for each name of the target that his words cover, its significant
 * words are taken out of his line one occurrence each, and the action's word must stand in what is left; the name he used most fully
 * decides (the shortest remainder), so the check fails closed. Consumed by `checkHisWord` below, check 6.
 */
function holdsActionWordBesidesName(said: string, target: CompanionActionTarget, action: CompanionCeremonyAction): boolean {
  const heard = wordsOf(said);
  let remainder: string[] | null = null;
  for (const name of sayableNamesOf(target)) {
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

/** Words that may stand before the verb of an order without making it a statement: "Please clear your memory.", "Okay, go ahead and clear it." */
const ORDER_LEAD_INS: ReadonlySet<string> = new Set(['please', 'okay', 'ok', 'alright', 'yes', 'yeah', 'yep', 'sure', 'now', 'go', 'ahead', 'and', 'so', 'then', 'just', 'hey']);

/**
 * The actions that retire a whole bank at once. Only a line that OPENS with their word (after the lead-ins) is an order for them: `clear` and
 * `empty` are also adjectives and "memory" is the whole name, so "My memory is clear." and "You could wipe your memory later." hold the
 * name and the verb as a bag of words and would otherwise fire it.
 */
const ORDERED_VERB_FIRST: ReadonlySet<CompanionCeremonyAction> = new Set(['clear_memory']);

/** Whether the line's first word after the lead-ins is one of the action's words ("Clear your memory." does; "My memory is clear." does not). */
function opensWithActionWord(said: string, action: CompanionCeremonyAction): boolean {
  const words = wordsOf(said);
  const start = words.findIndex((word) => !ORDER_LEAD_INS.has(word));
  const rest = start === -1 ? [] : words.slice(start);
  return ACTION_WORDS[action].some((entry) => wordsOf(entry).every((word, at) => rest[at] === word));
}

/**
 * Whether the line is a no or a question and so no order: it ends in `?`, opens with a question word, or holds a negator. The target's own
 * name words are set aside first, so a card called "No more polling" or "Do not disturb" can still be ordered. A heuristic by design, and a
 * closed one: it can refuse a plain order that happens to say "no" ("Queue it, no problem"), never accept a refusal. An `assent` is made of
 * yes words and four carriers, so it holds no negator and "Do it." is no question: only its `?` is read.
 */
function takesItBack(said: string, target: CompanionActionTarget, assent: boolean): boolean {
  if (said.trim().endsWith('?')) return true;
  if (assent) return false;
  const nameWords = new Set(namesOf(target).flatMap(wordsOf));
  const words = wordsOf(said).filter((word) => !nameWords.has(word));
  return words.some((word) => NEGATORS.has(word)) || (words.length > 0 && QUESTION_OPENERS.has(words[0]));
}

/** Whether the line is no order for an action in `ORDERED_VERB_FIRST`: it does not open with the action's word. Every other action is ordered by the bag of words. */
const isNoVerbFirstOrder = (said: string, action: CompanionCeremonyAction): boolean => ORDERED_VERB_FIRST.has(action) && !opensWithActionWord(said, action);

/** The runs of words that are his yes (`wordsOf` forms: "that's right" is `thats right`), longest first so "please do" is read whole. */
const YES_RUNS: ReadonlyArray<readonly string[]> = [
  ['that', 'is', 'right'], ['thats', 'right'], ['go', 'ahead'], ['please', 'do'], ['do', 'it'], ['fire', 'it'], ['send', 'it'],
  ['yes'], ['yeah'], ['yep'], ['yup'], ['sure'], ['okay'], ['ok'], ['alright'], ['correct'],
];

/** The words that may stand beside a yes without being more than a yes. */
const YES_CARRIERS: ReadonlySet<string> = new Set(['please', 'it', 'that', 'now']);

/**
 * Whether the line is his yes to the pending action, and so his word for it with no name said: a yes run (`YES_RUNS`) carried by nothing
 * but "please", "it", "that" and "now". The action's own word beside "it" is never a yes, so "Forget it.", "Stop it.", "Pause it." and
 * "Cut it." (what he says to decline) fire nothing. "Yes.", "Sure, go ahead." and "Do it now." are assents; "Go on.", "Okay, so.",
 * "Yes, queue it.", "Hey." and "Please." are not. The `?` of "Yes?" is judged by `takesItBack`, not here. Consumed by `checkHisWord`
 * below, and shown on its own by `.verify/kaylee-action-word.mjs`.
 */
export function isAssent(said: string): boolean {
  const words = wordsOf(said);
  let saidYes = false;
  for (let at = 0; at < words.length;) {
    const run = YES_RUNS.find((candidate) => candidate.every((word, offset) => words[at + offset] === word));
    if (run !== undefined) {
      saidYes = true;
      at += run.length;
      continue;
    }
    if (!YES_CARRIERS.has(words[at])) return false;
    at += 1;
  }
  return saidYes;
}

/**
 * Whether a sentence of hers reads the action back: it names the target. Her memory's house name is the common word "memory", so by that
 * alone a sentence about her memory in passing ("Let me check my memory for that.") would count as the read-back; it counts only beside the
 * action's word, or by the name he says ("your memory").
 */
function readsBack(text: string, target: CompanionActionTarget, action: CompanionCeremonyAction): boolean {
  if (!namesTarget(text, target, action)) return false;
  if (target.kind !== 'memory') return true;
  const heard = new Set(wordsOf(text));
  return holdsActionWord(text, action) || significantWordsOf(target.spoken, action).every((word) => heard.has(word));
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

type Heard = { id: number; at: string; role: 'operator' | 'kaylee'; via: 'typed' | 'spoken' | null; text: string };

/** The newest of `rows` (the greatest log id), or `null` for none. */
const newestOf = (rows: readonly Heard[]): Heard | null => rows.reduce<Heard | null>((newest, row) => (newest === null || row.id > newest.id ? row : newest), null);

/**
 * The checks of `take_action`, in order, on rows from her log (`heardSince(armedFrom)`'s, oldest first): his line, or the one sentence that
 * refuses.
 *
 *   1. nothing is pending (`pending` is `null`), or what is pending can be named by no line of his (`canBeNamed`);
 *   2. it lapsed: `now` is past `expiresAt` (the sentence says to prepare it again, which re-arms it);
 *   3. his word is not found. It is the newest line he SPOKE after `armedFrom`, and at or before `expiresAt`, equal to `said`. The refusal
 *      points at his newest spoken line only when the check would take it passed as `said`;
 *   4. no sentence of hers reading the target back (`readsBack`) stands between the start of the ceremony and that line: for a bare yes
 *      (`isAssent`) the start is `armedFrom`, so a re-arm keeps the read-back from before the lapse; for an order it is `preparedAt`,
 *      this prepare's own stamp. One that stands only AFTER the line is its own sentence ("He asked before you read it back"), which also
 *      names a line of his spoken since. A bare yes must also be his FIRST spoken line after her NEWEST read-back with none of his after
 *      it, else it is refused;
 *   5. a no or a question (`takesItBack`), and a line that is no assent and does not name the target;
 *   6. a line that is no assent and holds none of the action's words besides the target's name (`holdsActionWordBesidesName`) or, for
 *      `clear_memory`, does not open with its word. An assent (`isAssent`) is his word for the one action on the panel and needs neither.
 *
 * A spoken line equal to `said` but logged before the ceremony began is refused with check 3's sentence, as is a typed one. Each refusal says
 * what to do. `pending` takes `null` so the caller hands over whatever her state holds and check 1 is made here, in the one place the
 * sentences live. `preparedAt` is this prepare's stamp; `armedFrom` is the stamp the ceremony began (the same, or the first prepare's across
 * a re-arm). Consumed by `hands-tools.ts` (`take_action`).
 */
export function checkHisWord(input: {
  pending: { action: CompanionCeremonyAction; target: CompanionActionTarget; preparedAt: string; armedFrom: string; expiresAt: string; say: string } | null;
  said: string;
  now: string;
  lines: Heard[];
}): { ok: true; line: { id: number; at: string; text: string } } | { ok: false; sentence: string } {
  const { pending, said, now, lines } = input;
  if (!pending) return refusal('Nothing is waiting for his word; prepare it first.');
  const { action, target } = pending;
  if (!canBeNamed(target, action)) {
    return refusal(`No line of his can fire this: "${target.spoken}" has no word of its own that is not the action itself or a filler word. Cancel it and tell him it cannot be done by voice.`);
  }

  const armedMs = Date.parse(pending.armedFrom);
  const preparedMs = Date.parse(pending.preparedAt);
  const expiresMs = Date.parse(pending.expiresAt);
  // Written as "not still alive" so that a `now` or an `expiresAt` that does not parse reads as lapsed.
  if (!(Date.parse(now) <= expiresMs)) return refusal(`It lapsed at ${clockOf(pending.expiresAt)}. Prepare it again: that re-arms it, and his yes since then still counts.`);

  // A blank `said` equals the empty press's `''` once folded; it must name no line.
  const wanted = foldedText(said);
  const afterTheArm = (stamp: string): boolean => Date.parse(stamp) > armedMs;
  const isHisSpokenSaid = (row: Heard): boolean => wanted !== '' && row.role === 'operator' && row.via === 'spoken' && foldedText(row.text) === wanted;

  const firing = newestOf(lines.filter((row) => isHisSpokenSaid(row) && afterTheArm(row.at) && Date.parse(row.at) <= expiresMs));
  if (firing === null) {
    // The pointer names only a line this check would take if she passed it, so the call it invites is never refused the same way.
    const newestSpoken = newestOf(lines.filter((row) => row.role === 'operator' && row.via === 'spoken' && afterTheArm(row.at) && Date.parse(row.at) <= expiresMs));
    const pointer = newestSpoken === null ? '' : ` His newest spoken line since then is logged as "${newestSpoken.text}"; if that is what he meant, pass it to take_action exactly so.`;
    return refusal(`That is not a line he spoke after the card went up. He must say it aloud: ${pending.say}.${pointer}`);
  }

  const assent = isAssent(said);
  // What a re-arm inherits is his yes, so only a bare yes stands on a read-back from before this prepare; an order needs one of this prepare's.
  // Under a fresh ceremony `armedFrom` and `preparedAt` are one stamp.
  const readBackSince = assent ? armedMs : preparedMs;
  const readsItBack = (row: Heard): boolean => row.role === 'kaylee' && Date.parse(row.at) > readBackSince && readsBack(row.text, target, action);
  const readBacks = lines.filter(readsItBack);
  // His line came before a read-back of hers: say so, and name the line of his spoken since that read-back, if any.
  const askedBefore = (readBack: Heard): string => {
    const since = newestOf(lines.filter((row) => row.role === 'operator' && row.via === 'spoken' && row.id > readBack.id));
    const spokenSince = since === null ? '' : ` He has spoken since: his newest line is logged as "${since.text}"; if that is his yes, pass it to take_action exactly so.`;
    return `He asked before you read it back. Read it back, then pass what he says next.${spokenSince}`;
  };
  if (!readBacks.some((row) => row.id < firing.id)) {
    const later = readBacks.find((row) => row.id > firing.id);
    return refusal(later === undefined ? `You have not read it back to him yet. Say it back first: ${pending.say}.` : askedBefore(later));
  }
  // A bare yes answers the read-back it follows: not any yes within the wait, and not one he has spoken past.
  const newestReadBack = assent ? newestOf(readBacks) : null;
  if (newestReadBack !== null) {
    if (newestReadBack.id > firing.id) return refusal(askedBefore(newestReadBack));
    const spokenAfterReadBack = lines.filter((row) => row.role === 'operator' && row.via === 'spoken' && row.id > newestReadBack.id);
    if (spokenAfterReadBack.length !== 1 || spokenAfterReadBack[0].id !== firing.id) {
      return refusal('A bare yes counts only as his first spoken line after your newest read-back, with none of his after it. Read it back again, then pass what he says next.');
    }
  }

  const notAnOrder = `That is a no or a question, not an order. He must say the order itself, aloud: ${pending.say}.`;
  if (takesItBack(said, target, assent)) return refusal(notAnOrder);
  if (!assent) {
    if (!namesTarget(said, target, action)) return refusal(`His words do not name ${target.spoken}.`);
    if (!holdsActionWordBesidesName(said, target, action)) return refusal(`His words do not say ${ACTION_WORDS[action][0]}.`);
    if (isNoVerbFirstOrder(said, action)) return refusal(notAnOrder);
  }

  return { ok: true, line: { id: firing.id, at: firing.at, text: firing.text } };
}
