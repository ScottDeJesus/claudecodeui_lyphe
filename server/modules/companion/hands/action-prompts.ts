import type { CompanionActionKind, CompanionActionTarget, CompanionCeremonyAction } from '@/shared/companion-types.js';
import type { DispatcherAsk } from '@/shared/types.js';

import { ACTION_WORDS, shortNameOf } from './action-word.js';

/**
 * THE WORDS OF AN ACTION: what he says to fire it, what it is called in the past tense on his panel, and the texts the card and
 * her read-back are made of (the prompt as the card draws it, and the head of an Accept she reads aloud). Strings in, strings
 * out; no I/O.
 *
 * `SAY_VERB` is the verb of `say` ("Queue Kaylee's eyes"), and each of the eleven is chosen to hold one of the action's own words
 * (`ACTION_WORDS` in `action-word.ts`) so his saying `say` aloud always passes the check of his word; the two harmless actions (open,
 * close_followup) have a verb for the panel's lines alone, since no word of his is checked for them. `DONE_VERB` is what the
 * panel's system line says after the act ("On your word: queued Kaylee's eyes."); `doneOf` joins it to the target, and `systemLine`
 * is that line.
 *
 * Consumers: `action-recipe.ts` (the prepare), `hands-tools.ts` and `direct-tools.ts` (the answers to her and the panel's line) and
 * `action-doors.ts` (the answers and the briefs a door carries).
 * `nextStepFor` and `rearmStepFor` are the texts that tell her what to do after a prepare of one of the eleven.
 */

/** What he says first: the action as a command, followed by the target's `spoken` name. Consumed by `sayOf`, and by the prepare's answer ("waiting for his word: queue …"). */
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

/** What he says to fire the action on `spoken`: `<Verb> <spoken>`. Consumed by `action-recipe.ts`. */
export const sayOf = (action: CompanionActionKind, spoken: string): string => `${SAY_VERB[action]} ${spoken}`;

/**
 * The action done, on its target: "queued Kaylee's eyes". Clearing her memory is the one whose past tense already names what it
 * acted on ("cleared her memory"), so nothing follows it. Consumed by `hands-tools.ts` (her answer) and `systemLine` below.
 */
export const doneOf = (action: CompanionActionKind, spoken: string): string => (action === 'clear_memory' ? DONE_VERB[action] : `${DONE_VERB[action]} ${spoken}`);

/** The words of his that fire the action besides a yes: his own naming the target by the shortest name the check takes and saying the action's first word, or the full order. */
const orderingOf = (action: CompanionCeremonyAction, target: CompanionActionTarget, say: string): string => `words of his own naming ${shortNameOf(target)} and saying ${ACTION_WORDS[action][0]}, or "${say}"`;

/** What she does with his line, and the one binding on a bare yes: both prepare answers end on it. */
const TAKE_WITH_HIS_LINE = 'Then call take_action with his newest spoken line, exactly as logged; a line that came before your read-back is not his answer to it, '
  + 'and a bare yes counts only as the first thing he says after your newest read-back: if he said anything else first, read it back again.';

/**
 * What the prepare's answer tells her to do next: read it back to him in plain words, then stop. `readBack` is the recipe's sentence,
 * `say` the full order. The name she is told to listen for is the shortest the check takes (`shortNameOf`), never a long title it takes
 * shorter. Consumed by `hands-tools.ts` (the prepare's answer).
 */
export function nextStepFor(action: CompanionCeremonyAction, target: CompanionActionTarget, say: string, readBack: string): string {
  return `Read it back to him in plain words, then stop: ${readBack} His next spoken yes fires it, and so do ${orderingOf(action, target, say)}. ${TAKE_WITH_HIS_LINE}`;
}

/**
 * What the prepare's answer tells her after a RE-ARM: the same action on the same target had lapsed at `lapsedAt` and this takes its place.
 * Her read-back from before the lapse still stands for a bare yes he has spoken since, and for nothing else: when his newest spoken line is
 * such a yes she passes it at once and asks him nothing; an order that names it, other talk, or nothing since, and she reads it back again.
 * Consumed by `hands-tools.ts` (the prepare's answer).
 */
export function rearmStepFor(action: CompanionCeremonyAction, target: CompanionActionTarget, say: string, readBack: string, lapsedAt: string): string {
  return `Re-armed: it lapsed at ${clockOf(lapsedAt)} and this takes its place. Your read-back from before the lapse still stands for a yes he has said since, and for nothing else. `
    + `If his newest spoken line is a bare yes, call take_action now with his newest spoken line, exactly as logged, and ask him nothing. `
    + `If it is anything else (an order that names it, other talk) or he has said nothing since, read it back to him again and stop: ${readBack} His next spoken yes fires it, and so do ${orderingOf(action, target, say)}. ${TAKE_WITH_HIS_LINE}`;
}

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
