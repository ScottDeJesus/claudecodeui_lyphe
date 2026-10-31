import type { CompanionActionKind } from '@/shared/companion-types';

/**
 * The words of the action waiting for his word, each a locale key with its English: one place, so the action's two drawings
 * say the same thing. Used by this module's CompanionActionCard (the whole card: its sentence, the title over his lines, its
 * times and lapse) and CompanionActionLine (the card in one line: its sentence and lapse, on the station's phone).
 */

/** A locale key and its English, for the words that change with the action. */
type Words = { key: string; english: string };

/** Each action as a sentence, the verb before the target it acts on — the server's `SAY_VERB` (hands/action-prompts.ts) names it the same way. */
export const ACTION_SENTENCE: Readonly<Record<CompanionActionKind, Words>> = {
  queue: { key: 'companion.action.verb.queue', english: 'Queue <target/>' },
  hide: { key: 'companion.action.verb.hide', english: 'Hide <target/>' },
  show: { key: 'companion.action.verb.show', english: 'Show <target/>' },
  rework: { key: 'companion.action.verb.rework', english: 'Rework <target/>' },
  answer: { key: 'companion.action.verb.answer', english: 'Send the answers to <target/>' },
  recut: { key: 'companion.action.verb.recut', english: 'Re-cut <target/>' },
  stop: { key: 'companion.action.verb.stop', english: 'Stop <target/>' },
  resume: { key: 'companion.action.verb.resume', english: 'Resume <target/>' },
  kick: { key: 'companion.action.verb.kick', english: 'Kick <target/>' },
  resume_run: { key: 'companion.action.verb.resumeRun', english: 'Resume the run <target/>' },
  open: { key: 'companion.action.verb.open', english: 'Open <target/>' },
  close_followup: { key: 'companion.action.verb.closeFollowup', english: 'Close the follow-up on <target/>' },
  clear_memory: { key: 'companion.action.verb.clearMemory', english: 'Clear <target/>' },
};

/** What his carried lines are to the action, said over them; the actions that carry none fall to the last. */
export const CARRIED_TITLE: Readonly<Partial<Record<CompanionActionKind, Words>>> = {
  rework: { key: 'companion.action.carried.rework', english: 'Your notes · sent word for word' },
  answer: { key: 'companion.action.carried.answer', english: 'Your answers · sent word for word' },
  resume_run: { key: 'companion.action.carried.resumeRun', english: 'Your rulings · sent word for word' },
};
export const CARRIED_OTHER: Words = { key: 'companion.action.carried.other', english: 'Your words · sent word for word' };

/** A stamp on his clock, 24-hour `14:07`: the clock she says the lapse in ("It lapses at 14:07"). Empty for a stamp that is not a time. */
export function hourMinute(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
