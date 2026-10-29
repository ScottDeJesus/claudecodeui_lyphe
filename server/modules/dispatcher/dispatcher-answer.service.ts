import { relayRecord } from '@/shared/relay-record.js';
import type { RelayedPress } from '@/shared/relayed-press-types.js';
import type { DispatcherAnswerOutcome, DispatcherAsk, ProviderPermissionDecision } from '@/shared/types.js';

import type { DispatcherCommandResult } from './dispatcher-ask.transport.js';
import { firstLine } from './dispatcher-ask.transport.js';

/**
 * The operator's answer to a prompt this lane raised, read and carried to the plan.
 *
 * THE ANSWER IS HIS, WORD FOR WORD, and it goes through the dispatcher's own doors and no other. THERE ARE THREE
 * DOORS: the plan's card and the phone's push, where he presses, and Kaylee, who carries his SPOKEN word for that
 * specific card with kaylee--press's record of it — who spoke, when, and what he said (`relayRecord`) — which the
 * dispatcher's door checks and lands as a `relayed` line beside the act.
 *
 * - `accept` — Queue runs `dispatcher accept --lock <token> --by app:<door> <plans…>` and the plans join the
 *   queue, starting when their turn comes; Hide is the same with `--hidden`, approved and held out of the
 *   queue until he Shows them. The token is the census he was shown, re-checked by the verb itself
 *   (`lock.stale`), so an answer whose plans moved on since approves NOTHING and the current prompt is
 *   raised again. `--by` names his press — the card, the phone or Kaylee — in `approved_by`; Kaylee's adds
 *   `--relay <record>`, whose target is the card the Accept acts on (the epic when the lock names several plans,
 *   else the plan) and whose token is the `--lock`. A plan is approved ONCE
 *   per load (`store.approve`): an answer that reaches a plan already approved approves nothing and exits
 *   `ACCEPT_ALREADY_APPROVED_EXIT`, which is an answer that arrived second — `already-answered`, never a
 *   refusal to put the prompt back for.
 * - Rework approves nothing (the ask already stamped `prompted_at`, which is the hold standing down,
 *   exactly as the intent-lock hook's Rework does) and sends his typed notes verbatim to the designer:
 *   `dispatcher tell <target> --brief -`, once per designer target the Accept names. On Kaylee's door each
 *   `tell` adds `--relay <record>` naming its own target; the notes stay his words on stdin and the record is never
 *   written into them.
 * - `questions` — the round's answers verbatim, as `Q:`/`A:` pairs in the designer's own question
 *   words, through `dispatcher tell <target> --brief -` (with its `--relay` on Kaylee's door).
 *
 * A DECISION THAT IS NOT AN ANSWER IS NOT CARRIED: a skip, a label the prompt never offered, a Rework
 * with no notes. `readReply` answers `null`, and the prompt stays up — the operator's word is still owed.
 */

/** The Rework answer's POSITION among the Accept prompt's three (`intent_lock.OPTIONS`: Queue, Hide, Rework). */
export const REWORK_OPTION = 2;

/**
 * `dispatcher accept`'s exit code for a plan that was approved already (`accept.ALREADY_APPROVED_EXIT`),
 * apart from every other refusal's 2. The dispatcher's own constant is the source; change one, change both.
 */
const ACCEPT_ALREADY_APPROVED_EXIT = 3;

/** One answer, read: an approval (into the queue, or hidden), a Rework's notes, or a questions round as one brief. */
export type AskReply =
  | { kind: 'accept'; hidden: boolean }
  | { kind: 'rework'; notes: string }
  | { kind: 'answers'; brief: string };

/**
 * Which door the press came through — named in `approved_by` (`app:card`, `app:phone`, `app:kaylee`). `'card'` is
 * the plan's own card in the Roadmap tab's In flight face and the Runs widget, which answers over its own HTTP door
 * (`dispatcher-answer.routes.ts`) rather than through a runtime's gateway; `'phone'` is a push's
 * button, which walks that gateway (`ntfy-action.routes.ts`); `'kaylee'` is his spoken word carried by Kaylee,
 * which arrives through `DispatcherAsks.answerOnHisWord` with its record (`CarryRelay`) and is refused without one.
 */
export type AnswerDoor = 'card' | 'phone' | 'kaylee';

/**
 * What Kaylee's door carries beside the reply: his press (`RelayedPress`), and the card the Accept acts on — the target of
 * the Accept's record, which the dispatcher's door checks against the plans the verb names. Each `tell` names its own target.
 * Used by `dispatcher-asks.service.ts`, which computes `acceptTarget` from its newest picture.
 */
export type CarryRelay = { press: RelayedPress; acceptTarget: string };

/** One carried answer: what the dispatcher did, and its own first line saying so (`''` when it said nothing). */
export type CarriedAnswer = { outcome: DispatcherAnswerOutcome; said: string };

/** The one string an answers or notes map holds for `question`, trimmed — `''` for none. */
function textAt(map: unknown, question: string): string {
  const value = map !== null && typeof map === 'object' ? (map as Record<string, unknown>)[question] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * What an Accept's decision answers in `map` (`answers` or `notes`): the string at `question`, else the
 * decision's sole answer — the one non-blank string a plain question-keyed object holds, when it holds
 * exactly one; an array is no such map, so it has no sole answer — else `''`. A questions round never
 * reads this way: each of its questions is answered by its own key.
 */
function textAtAsk(map: unknown, question: string): string {
  const keyed = textAt(map, question);
  if (keyed !== '' || map === null || typeof map !== 'object' || Array.isArray(map)) return keyed;
  const held = Object.values(map).filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  return held.length === 1 ? held[0].trim() : '';
}

/**
 * The reply a card or phone decision carries for `ask`, or `null` when it carries none.
 *
 * The card answers in `updatedInput.answers` (question text → chosen label), and a Rework's notes ride
 * beside them in `updatedInput.notes` under the same question — the option that takes a note opens a
 * field for it (`needsNote`). The phone answers the same shape with a label alone, and its Rework
 * button opens the app instead, because a button cannot carry the notes. An Accept's answer is read by
 * the ask it answers — the label at `ask.question`, else the decision's sole answer — because
 * `dispatcher-asks.service.ts` books an ask as it was first raised (its `raised` map, read as `entry.ask`
 * in `answerFromCard`) while the card keys its answer by the census it draws now, so under the same
 * token and asked event a reworded census made every card press answer "the answer names no option the
 * prompt offered" until the server restarted; the ask's identity is its key (`keyOf`), and its sole
 * answer is the answer to that ask. Used by `dispatcher-asks.service.ts`.
 */
export function readReply(ask: DispatcherAsk, decision: ProviderPermissionDecision): AskReply | null {
  if (!decision.allow) return null;
  const input = decision.updatedInput as { answers?: unknown; notes?: unknown } | undefined;
  if (ask.kind === 'accept') {
    const chosen = textAtAsk(input?.answers, ask.question);
    const [queue, hide, rework] = ask.options.map((option) => option.label);
    if (chosen === queue) return { kind: 'accept', hidden: false };
    if (chosen === hide) return { kind: 'accept', hidden: true };
    const notes = textAtAsk(input?.notes, ask.question);
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

/**
 * The command a reply runs, as the journal shows it — the brief is on stdin, never in argv, and a `--relay` record is
 * named rather than copied: his words are in the store's `relayed` line, and the journal line stays one line.
 */
// Used by `dispatcher-relay.service.ts`, whose journal line names its command the same way.
export function shownCommand(args: readonly string[]): string {
  return `dispatcher ${args.map((arg, index) => (args[index - 1] === '--relay' ? '<record>' : arg)).join(' ')}`;
}

/**
 * Carries one reply to the plan, answering what the dispatcher did with it (`CarriedAnswer`). A verb
 * that refused or never answered is `refused`: the caller puts the prompt back up for the operator (a
 * stale Accept's current prompt among them). An Accept that found the plan approved already is
 * `already-answered`: nothing changed and the prompt is NOT put back, because the word that closed it
 * is the one that stands. The dispatcher's own line is in the journal beside each command, and its
 * first line comes back as `said` for a door that has an operator waiting on it — the card toasts it,
 * and it is the line the run that DECIDED the outcome printed: the refusing run's when one refused,
 * else the last run's.
 *
 * THE KAYLEE DOOR carries `relay` and nothing runs without it: every argv it builds adds `--relay <record>` (the Accept's
 * target is `relay.acceptTarget`, each `tell`'s is the designer it names; the Accept's token is its `--lock`, a `tell`'s is
 * none), and a Kaylee answer with no record is
 * `refused` before any verb runs, because the dispatcher would refuse it and a verb should never be spawned to be refused.
 * Every other door ignores `relay`. Used by `dispatcher-asks.service.ts`.
 */
export async function carryReply(
  dependencies: AnswerDependencies,
  ask: DispatcherAsk,
  reply: AskReply,
  door: AnswerDoor,
  relay?: CarryRelay,
): Promise<CarriedAnswer> {
  if (door === 'kaylee' && relay === undefined) return { outcome: 'refused', said: "Kaylee's answer carried no record of his word" };
  const press = door === 'kaylee' ? relay?.press : undefined;
  /**
   * `--relay <record>` for the act on `target`, on Kaylee's door; nothing on the others. THE LANE WRITES THE RECORD'S
   * `token`, never the press: the door takes one on an Accept alone, equal to its `--lock`, and refuses it on every other
   * act. So an Accept's record carries the lock of the ask this book holds (the one `--lock` carries beside it) and a
   * `tell` — a Rework's notes, an answers round — carries none, whatever token the press she read back held.
   */
  const relayed = (target: string, token: string | null): string[] =>
    (press === undefined ? [] : ['--relay', relayRecord({ ...press, token }, target)]);
  const runs: Array<{ args: string[]; stdin?: string }> = [];
  if (reply.kind === 'accept' && ask.kind === 'accept') {
    runs.push({
      args: ['accept', '--lock', ask.token, '--by', `app:${door}`, ...relayed(relay?.acceptTarget ?? ask.plan, ask.token), ...(reply.hidden ? ['--hidden'] : []), ...ask.plans],
    });
  } else if (reply.kind === 'rework' && ask.kind === 'accept') {
    for (const target of ask.rework) runs.push({ args: ['tell', target, '--brief', '-', ...relayed(target, null)], stdin: reply.notes });
  } else if (reply.kind === 'answers' && ask.kind === 'questions') {
    runs.push({ args: ['tell', ask.target, '--brief', '-', ...relayed(ask.target, null)], stdin: reply.brief });
  }
  if (runs.length === 0) return { outcome: 'refused', said: '' };
  let outcome: DispatcherAnswerOutcome = 'took';
  /** The last run's line, until the first refusal claims it — the run that DECIDED the outcome. */
  let said = '';
  let refusal: string | null = null;
  for (const { args, stdin } of runs) {
    const result = await dependencies.run(args, stdin);
    const line = firstLine(result.stdout) || firstLine(result.stderr);
    dependencies.say(`[Dispatcher] ${ask.plan}: the operator's ${door} answer ran \`${shownCommand(args)}\` → exit ${result.exit ?? 'none'}: ${line || '(nothing)'}`);
    said = line;
    if (result.exit === 0) continue;
    // Only an approval has an "already" to be told; a refusal of any verb outranks it, so a run that
    // carried more than one is never reported answered while part of it was not.
    if (args[0] === 'accept' && result.exit === ACCEPT_ALREADY_APPROVED_EXIT) {
      if (outcome === 'took') outcome = 'already-answered';
    } else {
      refusal ??= line;
      outcome = 'refused';
    }
  }
  return { outcome, said: refusal ?? said };
}
