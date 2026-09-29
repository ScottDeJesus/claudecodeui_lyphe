import type { DispatcherAsk, ProviderPermissionDecision } from '@/shared/types.js';

import type { DispatcherCommandResult } from './dispatcher-ask.transport.js';
import { firstLine } from './dispatcher-ask.transport.js';

/**
 * The operator's answer to a prompt this lane raised, read and carried to the plan.
 *
 * THE ANSWER IS HIS, WORD FOR WORD, and it goes through the dispatcher's own doors and no other:
 *
 * - `accept` — Accept runs `dispatcher accept --lock <token> --by app:<door> <plans…>`, Queue the same
 *   with `--paused`. The token is the census he was shown, re-checked by the verb itself (`lock.stale`),
 *   so an Accept whose plans moved on since approves NOTHING and the current prompt is raised again.
 *   `--by` names his press — the panel or the phone — in `approved_by`.
 * - Rework approves nothing (the ask already stamped `prompted_at`, which is the hold standing down,
 *   exactly as the intent-lock hook's Rework does) and sends his typed notes verbatim to the designer:
 *   `dispatcher tell <target> --brief -`, once per designer target the Accept names.
 * - `questions` — the round's answers verbatim, as `Q:`/`A:` pairs in the designer's own question
 *   words, through `dispatcher tell <target> --brief -`.
 *
 * A DECISION THAT IS NOT AN ANSWER IS NOT CARRIED: a skip, a label the prompt never offered, a Rework
 * with no notes. `readReply` answers `null`, and the prompt stays up — the operator's word is still owed.
 */

/** The Rework answer's POSITION among the Accept prompt's three (`intent_lock.OPTIONS`: Accept, Queue, Rework). */
export const REWORK_OPTION = 2;

/** One answer, read: an approval (live or paused), a Rework's notes, or a questions round as one brief. */
export type AskReply =
  | { kind: 'accept'; paused: boolean }
  | { kind: 'rework'; notes: string }
  | { kind: 'answers'; brief: string };

/** Which door the press came through — named in `approved_by` (`app:panel`, `app:phone`). */
export type AnswerDoor = 'panel' | 'phone';

/** The one string an answers or notes map holds for `question`, trimmed — `''` for none. */
function textAt(map: unknown, question: string): string {
  const value = map !== null && typeof map === 'object' ? (map as Record<string, unknown>)[question] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The reply a panel or phone decision carries for `ask`, or `null` when it carries none.
 *
 * The panel answers in `updatedInput.answers` (question text → chosen label), and a Rework's notes ride
 * beside them in `updatedInput.notes` under the same question — the option that takes a note opens a
 * field for it (`needsNote`). The phone answers the same shape with a label alone, and its Rework
 * button opens the app instead, because a button cannot carry the notes. Used by
 * `dispatcher-asks.service.ts`.
 */
export function readReply(ask: DispatcherAsk, decision: ProviderPermissionDecision): AskReply | null {
  if (!decision.allow) return null;
  const input = decision.updatedInput as { answers?: unknown; notes?: unknown } | undefined;
  if (ask.kind === 'accept') {
    const chosen = textAt(input?.answers, ask.question);
    const [accept, queue, rework] = ask.options.map((option) => option.label);
    if (chosen === accept) return { kind: 'accept', paused: false };
    if (chosen === queue) return { kind: 'accept', paused: true };
    const notes = textAt(input?.notes, ask.question);
    return chosen === rework && notes !== '' ? { kind: 'rework', notes } : null;
  }
  const pairs = ask.questions.map((question) => ({ question: question.text, answer: textAt(input?.answers, question.text) }));
  if (pairs.every((pair) => pair.answer === '')) return null;
  const brief = pairs
    .map((pair) => `Q: ${pair.question}\nA: ${pair.answer === '' ? '(no answer)' : pair.answer}`)
    .join('\n\n');
  return { kind: 'answers', brief };
}

export type AnswerDependencies = {
  /** Runs one `dispatcher <args>`, with `stdin` when given — `runDispatcherCommand`, bound by the composition root. */
  run: (args: readonly string[], stdin?: string) => Promise<DispatcherCommandResult>;
  /** One line to the journal per verb an answer ran: what was run, and what the dispatcher said. */
  say: (message: string) => void;
};

/** The command a reply runs, as the journal shows it — the brief is on stdin, never in argv. */
function shown(args: readonly string[]): string {
  return `dispatcher ${args.join(' ')}`;
}

/**
 * Carries one reply to the plan, answering whether the dispatcher took ALL of it. A verb that refused
 * or never answered is `false`: the caller puts the prompt back up for the operator (a stale Accept's
 * current prompt among them), and the dispatcher's own line is in the journal beside the command.
 * Used by `dispatcher-asks.service.ts`.
 */
export async function carryReply(
  dependencies: AnswerDependencies,
  ask: DispatcherAsk,
  reply: AskReply,
  door: AnswerDoor,
): Promise<boolean> {
  const runs: Array<{ args: string[]; stdin?: string }> = [];
  if (reply.kind === 'accept' && ask.kind === 'accept') {
    runs.push({ args: ['accept', '--lock', ask.token, '--by', `app:${door}`, ...(reply.paused ? ['--paused'] : []), ...ask.plans] });
  } else if (reply.kind === 'rework' && ask.kind === 'accept') {
    for (const target of ask.rework) runs.push({ args: ['tell', target, '--brief', '-'], stdin: reply.notes });
  } else if (reply.kind === 'answers' && ask.kind === 'questions') {
    runs.push({ args: ['tell', ask.target, '--brief', '-'], stdin: reply.brief });
  }
  if (runs.length === 0) return false;
  let tookAll = true;
  for (const { args, stdin } of runs) {
    const result = await dependencies.run(args, stdin);
    const said = firstLine(result.stdout) || firstLine(result.stderr) || '(nothing)';
    dependencies.say(`[Dispatcher] ${ask.plan}: the operator's ${door} answer ran \`${shown(args)}\` → exit ${result.exit ?? 'none'}: ${said}`);
    if (result.exit !== 0) tookAll = false;
  }
  return tookAll;
}
