import { relayRecord } from '@/shared/relay-record.js';
import type { RelayAnswer, RelayOrder } from '@/shared/relayed-press-types.js';
import type { DispatcherAsk } from '@/shared/types.js';

import { shownCommand } from './dispatcher-answer.service.js';
import type { AskReply, CarriedAnswer } from './dispatcher-answer.service.js';
import { firstLine, runDispatcherCommand } from './dispatcher-ask.transport.js';
import type { CommandDependencies } from './dispatcher-ask.transport.js';

/**
 * Kaylee's acts on his spoken word, carried to the dispatcher (`createDispatcherModule().relay`).
 *
 * TWO KINDS OF ORDER, TWO ROADS. The four that ANSWER AN OPEN PROMPT (`LockRelayOrder`: Queue, Hide, Rework, a questions round) go
 * through the book of the open asks (`dispatcher-asks.service.ts`, `answerOnHisWord`), which finds its own record of the prompt and
 * carries that — a re-cut or answered prompt is refused there. Every other act is a dispatcher verb of its own and is run here,
 * straight: `hide`, `unhide`, `cut`, `stop`, `resume`, `kick` and `tell`, each with `--relay <record>` (kaylee--press's record of his
 * word, whose target is the card the verb acts on). A `tell`'s brief stays his words verbatim, on stdin; the record is never
 * written into it.
 *
 * The dispatcher decides what each verb means and prints its own refusal, and its first line comes back untouched as `said`. Nothing
 * here throws: an exit other than 0 — a refusal, a command that never answered — is `refused`.
 */

/** The orders that answer an open prompt: they carry the `ask` she read back to him. */
export type LockRelayOrder = Extract<RelayOrder, { ask: DispatcherAsk }>;

/** The orders that are a verb of their own — the ones `relayOrder` runs. */
export type VerbRelayOrder = Exclude<RelayOrder, LockRelayOrder>;

// Used by `dispatcher.module.ts`, whose `relay` sends a lock order to the book and any other to `relayOrder`.
export function isLockOrder(order: RelayOrder): order is LockRelayOrder {
  return 'ask' in order;
}

// Used by `dispatcher.module.ts`: the reply his word makes to the prompt, in the shape the book carries.
export function replyOfLockOrder(order: LockRelayOrder): AskReply {
  switch (order.verb) {
    case 'queue': return { kind: 'accept', hidden: false };
    case 'hide-lock': return { kind: 'accept', hidden: true };
    case 'rework-lock': return { kind: 'rework', notes: order.notes };
    case 'answers': return { kind: 'answers', brief: order.brief };
  }
}

/**
 * What the book carried, as the door that asked hears it. `already-answered` reads as `already`; a refusal that carries no
 * line of the dispatcher's (a reply that ran no verb) gets the lane's own sentence, so she is never handed a blank refusal.
 */
// Used by `dispatcher.module.ts`.
export function relayAnswerOf(carried: CarriedAnswer): RelayAnswer {
  if (carried.outcome === 'refused') return { outcome: 'refused', said: carried.said || 'the dispatcher took no word of it' };
  return { outcome: carried.outcome === 'took' ? 'took' : 'already', said: carried.said };
}

/**
 * A plan's or an epic's name as the dispatcher holds it (`store.NAME_RE`: lower case, digits and dashes, a letter or digit first),
 * with an epic's `.arc` allowed. The lane is the door: a name that begins with `-` would be read by the dispatcher as an option
 * (`stop --help` prints its usage and exits 0, which would read as `took`), so a name of any other shape is refused before a spawn.
 */
const CARD_NAME = /^[a-z0-9][a-z0-9-]*(\.arc)?$/;

/**
 * The dispatcher command one verb order runs, with the stdin it needs (`tell`'s brief). The record's target is the card the verb
 * acts on, and it carries no `token`: the door takes one on an Accept alone, so the lane writes none for any verb here.
 */
function commandOf(order: VerbRelayOrder): { args: string[]; stdin?: string } {
  const record = relayRecord({ ...order.press, token: null }, order.name);
  switch (order.verb) {
    case 'hide': return { args: ['hide', order.name, '--relay', record] };
    case 'show': return { args: ['unhide', order.name, '--relay', record] };
    case 'recut': return { args: ['cut', order.name, '--relay', record] };
    case 'stop':
    case 'resume': return { args: [order.verb, order.name, '--relay', record] };
    // `kick` names no plan: the daemon is woken for the whole house, and the record's target is the card he asked about.
    case 'kick': return { args: ['kick', '--relay', record] };
    case 'tell': return { args: ['tell', order.name, '--brief', '-', '--relay', record], stdin: order.brief };
  }
}

// Used by `dispatcher.module.ts` for every order that is not an answer to an open prompt. `say` is the lane's
// journal: one line per verb run, the command and what the dispatcher said — the place his act is read back.
export async function relayOrder(
  order: VerbRelayOrder,
  commands: CommandDependencies,
  say: (message: string) => void,
): Promise<RelayAnswer> {
  if (!CARD_NAME.test(order.name)) {
    say(`[Dispatcher] Kaylee's ${order.verb} on his word named no plan or epic the dispatcher could hold — nothing was run`);
    return { outcome: 'refused', said: 'that is not the name of a plan or an epic; name the card again' };
  }
  const { args, stdin } = commandOf(order);
  const result = await runDispatcherCommand(commands, args, stdin);
  // A command that never exited (killed at its bound, or never started) has no line of the dispatcher's: the transport fills
  // `stderr` with Node's own `Command failed: <bin> <argv>`, whose argv holds the record — his account and his words. The lane's
  // sentence stands in, in the journal and in `said`, and it does not claim nothing happened: a verb acts before it prints.
  const line = result.exit === null
    ? `the dispatcher did not answer within ${Math.round(commands.timeoutMs / 1000)} s or could not be started; the act may have gone through, so read the card before asking again`
    : firstLine(result.stdout) || firstLine(result.stderr);
  say(`[Dispatcher] ${order.name}: Kaylee's ${order.verb} on his word ran \`${shownCommand(args)}\` → exit ${result.exit ?? 'none'}: ${line || '(nothing)'}`);
  if (result.exit === 0) return { outcome: 'took', said: line };
  return { outcome: 'refused', said: line || `the dispatcher exited ${result.exit} and said nothing` };
}
