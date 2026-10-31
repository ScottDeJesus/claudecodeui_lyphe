import type { CompanionActionKind, CompanionActionTarget } from '@/shared/companion-types.js';
import type { DispatcherAsk } from '@/shared/types.js';

import type { RearmedAfter } from './action-rearm.js';

/**
 * THE WORDS OF AN ACTION: what it is called as a command and in the past tense on his panel, and the texts the card and her read-back
 * are made of (the prompt as the card draws it, and the head of an Accept she reads aloud), and what the prepare's answer tells her to
 * do next. Strings in, strings out; no I/O.
 *
 * `SAY_VERB` is the verb of an action's one-line order ("Queue Kaylee's eyes", `sayOf`): the name the panel's record and her
 * read-back give the action. It is never a phrase for him to say: she reads the action back in her own words. `DONE_VERB` is what the
 * panel's system line says after the act ("On your word: queued Kaylee's eyes."); `doneOf` joins it to the target, and `systemLine`
 * is that line.
 *
 * Consumers: `action-recipe.ts` (the prepare), `hands-tools.ts` and `direct-tools.ts` (the answers to her and the panel's line) and
 * `action-doors.ts` (the answers and the briefs a door carries).
 * `nextStepFor` and `rearmStepFor` are the texts that tell her what to do after a prepare of one of the eleven.
 */

/** The action as a command, followed by the target's `spoken` name: the sentence the card's head draws. Consumed by `sayOf`, and by the prepare's answer ("on his panel: queue …"). */
export const SAY_VERB: Readonly<Record<CompanionActionKind, string>> = {
  queue: 'Queue',
  hide: 'Hide',
  show: 'Show',
  rework: 'Rework',
  answer: 'Send the answers to',
  recut: 'Re-cut',
  stop: 'Stop',
  resume: 'Resume',
  kick: 'Kick',
  resume_run: 'Resume the run',
  open: 'Open',
  close_followup: 'Close the follow-up on',
  clear_memory: 'Clear',
};

/** The action done, for the panel's system line and her answer after a take. Consumed by `doneOf`. */
export const DONE_VERB: Readonly<Record<CompanionActionKind, string>> = {
  queue: 'queued',
  hide: 'hid',
  show: 'showed',
  rework: 'reworked',
  answer: 'sent the answers to',
  recut: 're-cut',
  stop: 'stopped',
  resume: 'resumed',
  kick: 'kicked',
  resume_run: 'resumed the run',
  open: 'opened',
  close_followup: 'closed the follow-up on',
  clear_memory: 'cleared her memory',
};

/** The refusal of an open while no page holds the floor: the open is sent to that page alone. Consumed by `direct-tools.ts` (before the open's row is written) and `action-doors.ts` (`openOnFloor`). */
export const NO_FLOOR = 'No page of his holds the floor; he must open your panel first.';

/** The action's one-line order on `spoken`: `<Verb> <spoken>`, the stored `say` of a pending action and the head of her read-back. Consumed by `action-recipe.ts` and `direct-tools.ts`. */
export const sayOf = (action: CompanionActionKind, spoken: string): string => `${SAY_VERB[action]} ${spoken}`;

/**
 * The action done, on its target: "queued Kaylee's eyes". Clearing her memory is the one whose past tense already names what it
 * acted on ("cleared her memory"), so nothing follows it. Consumed by `hands-tools.ts` (her answer) and `systemLine` below.
 */
export const doneOf = (action: CompanionActionKind, spoken: string): string => (action === 'clear_memory' ? DONE_VERB[action] : `${DONE_VERB[action]} ${spoken}`);

/** How she reads an action back: plainly, in her own words, saying what she will do and to which card, run or page, by its full name (the server's check looks for the name). */
const READ_BACK_IN_HER_WORDS = 'Read it back to him plainly in your own words: what you will do, and to what, by its full name';

/**
 * What she does once it is read back, and the one check the server makes: the decision is hers. Both prepare answers end on it. No set
 * words fire the action and a typed line counts as much as a spoken one; the server confirms that she read it back and records the logged line that equals the one she passes.
 */
const SHE_DECIDES = 'Whether he agreed, and when, is your call from the conversation: there are no set words, and a line he typed counts as much as one he spoke. '
  + 'When you judge he agreed, call take_action with his line exactly as logged, which is the record of what he said. When he declines, or you judge he does not want it, call cancel_action. '
  + 'The server only confirms that you read it back and records the logged line that equals the one you pass (his newest line when none does, and the answer names it); never call take_action on your own words.';

/**
 * What the prepare's answer tells her to do next: read it back to him in her own words, then stop and decide from the conversation whether he agreed. `readBack` is the
 * recipe's sentence, what she has to cover. Consumed by `hands-tools.ts` (the prepare's answer).
 */
export function nextStepFor(readBack: string): string {
  return `${READ_BACK_IN_HER_WORDS}, then stop. What to cover: ${readBack} ${SHE_DECIDES}`;
}

/** Why the earlier ceremony of the same thing ended, as the re-arm's sentence says it. Consumed by `rearmStepFor`. */
const ENDED_AS: Readonly<Record<RearmedAfter, string>> = {
  expired: 'it lapsed',
  refused: 'the house refused it when you took it',
  replaced: 'it was already on his panel',
};

/**
 * What the prepare's answer tells her after a RE-ARM: the same thing had been on his panel and `endedAs` says how that ended. Her
 * read-back from before still stands. When she had already judged that he agreed and nothing since changes it,
 * she takes it at once and asks him nothing; otherwise she reads it back again. Consumed by `hands-tools.ts` (the prepare's answer).
 */
export function rearmStepFor(readBack: string, endedAs: RearmedAfter): string {
  return `Re-armed: ${ENDED_AS[endedAs]}, and this takes its place. Your read-back from before still stands. `
    + `If you have already judged that he agreed to what you read back, and nothing he said since changes that, call take_action now with his line exactly as logged and ask him nothing. `
    + `If he has not answered yet, or you are unsure, ${READ_BACK_IN_HER_WORDS} again, then stop. What to cover: ${readBack} ${SHE_DECIDES}`;
}

/**
 * The sentence that tells her which line of his the take recorded as his word, so she sees when it is not the one she passed (the server
 * records the logged line `said` equals, else his newest). Consumed by `hands-tools.ts` (a take's answer).
 */
export const recordedAs = (lineText: string): string => `Recorded as his word: “${clipped(lineText.replace(/\s+/g, ' ').trim(), 160)}”.`;

/** A stamp's local HH:MM, as the prepare's answer says when an action lapses; a stamp that does not parse is "an unknown time". Consumed by `hands-tools.ts`. */
export function clockOf(stamp: string): string {
  const moment = new Date(stamp);
  if (Number.isNaN(moment.getTime())) return 'an unknown time';
  return `${String(moment.getHours()).padStart(2, '0')}:${String(moment.getMinutes()).padStart(2, '0')}`;
}

/** A text cut to `max` characters, ending in an ellipsis when cut. */
const clipped = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The first sentence of `text`, markdown marks set aside, at most 220 characters; `null` when there is none. */
export function firstSentence(text: string | null): string | null {
  const plain = (text ?? '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  if (plain === '') return null;
  const end = /[.!?](?:\s|$)/.exec(plain);
  return clipped(end === null ? plain : plain.slice(0, end.index + 1), 220);
}

/** The Accept prompt as the card draws it: its header, then the whole census. */
export function acceptPrompt(ask: Extract<DispatcherAsk, { kind: 'accept' }>): string {
  return [ask.header, ask.question].filter((part) => part.trim() !== '').join('\n\n');
}

/** A questions round as the card draws it: each question numbered, its options under it. */
export function questionsPrompt(ask: Extract<DispatcherAsk, { kind: 'questions' }>): string {
  return ask.questions.map((question, index) => [`${index + 1}. ${question.text}`, ...question.options.map((option) => `   - ${option}`)].join('\n')).join('\n\n');
}

/**
 * The head of an Accept, which she reads back: the census line (its plan or plans and its task count, the first block of the
 * prompt) and the first sentence of what the lead plan delivers (`delivers`, from the dispatcher's own plan row). The whole census is
 * on the card; the head is what she says aloud.
 */
export function acceptHead(ask: Extract<DispatcherAsk, { kind: 'accept' }>, delivers: string | null): string {
  const census = ask.question.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? ask.plan;
  // The caller closes the head with its own full stop, so the sentence's is taken off.
  const builds = firstSentence(delivers)?.replace(/[.!?]+$/, '') ?? null;
  return builds === null ? `the prompt reads "${census}"` : `the prompt reads "${census}", and it delivers: ${builds}`;
}

/** Who answers for each of the eleven, as the system line quotes it; an open and a close have no sentence worth quoting. */
const SOURCE: Readonly<Partial<Record<CompanionActionKind, string>>> = {
  queue: 'The dispatcher', hide: 'The dispatcher', show: 'The dispatcher', rework: 'The dispatcher', answer: 'The dispatcher',
  recut: 'The dispatcher', stop: 'The dispatcher', resume: 'The dispatcher', kick: 'The dispatcher', resume_run: 'The runner',
};

/**
 * The panel's system line for an action that went through its door, in the words he reads: "On your word: queued Kaylee's eyes. The
 * dispatcher said: …". Consumed by `hands-tools.ts` (a take) and `direct-tools.ts` (an open and a close).
 */
export function systemLine(done: { action: CompanionActionKind; target: CompanionActionTarget; say: string }, outcome: 'took' | 'already' | 'refused', said: string): string {
  const { action, target } = done;
  const source = SOURCE[action];
  // An open and a close have no sentence worth quoting when they went through; when they were refused, the reason is the whole news.
  const quote = said === '' ? '' : source === undefined ? ` ${said}` : ` ${source} said: ${said}`;
  if (outcome === 'refused') return `Not done, on your word: ${done.say}.${quote}`;
  return `On your word: ${doneOf(action, target.spoken)}.${outcome === 'already' ? ' It was already so.' : ''}${source === undefined ? '' : quote}`;
}
