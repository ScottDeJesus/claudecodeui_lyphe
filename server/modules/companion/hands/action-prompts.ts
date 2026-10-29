import type { CompanionActionKind } from '@/shared/companion-types.js';
import type { DispatcherAsk } from '@/shared/types.js';

/**
 * THE WORDS OF AN ACTION: what he says to fire it, what it is called in the past tense on his panel, and the texts the card and
 * her read-back are made of (the prompt as the card draws it, and the head of an Accept she reads aloud). Strings in, strings
 * out; no I/O.
 *
 * `SAY_VERB` is the verb of `say` ("Queue Kaylee's eyes"), and each is chosen to hold one of the action's own words
 * (`ACTION_WORDS` in `action-word.ts`) so his saying `say` aloud always passes the check of his word. `DONE_VERB` is what the
 * panel's system line says after the act ("On your word: queued Kaylee's eyes."); `doneOf` joins it to the target.
 *
 * Consumers: `action-recipe.ts` (the prepare), `hands-tools.ts` (the answers to her) and `action-doors.ts` (the answers and
 * the briefs a door carries).
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

/** The action done, for the panel's system line and her answer after a take. Consumed by `hands-tools.ts`. */
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

/** The refusal of an open while no page holds the floor: the open is sent to that page alone. Consumed by `hands-tools.ts` (the prepare) and `action-doors.ts` (the take). */
export const NO_FLOOR = 'No page of his holds the floor; he must open your panel first.';

/** What he says to fire the action on `spoken`: `<Verb> <spoken>`. Consumed by `action-recipe.ts`. */
export const sayOf = (action: CompanionActionKind, spoken: string): string => `${SAY_VERB[action]} ${spoken}`;

/**
 * The action done, on its target: "queued Kaylee's eyes". Clearing her memory is the one whose past tense already names what it
 * acted on ("cleared her memory"), so nothing follows it. Consumed by `hands-tools.ts` (the panel's system line and her answer).
 */
export const doneOf = (action: CompanionActionKind, spoken: string): string => (action === 'clear_memory' ? DONE_VERB[action] : `${DONE_VERB[action]} ${spoken}`);

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
