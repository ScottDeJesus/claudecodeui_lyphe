import { randomUUID } from 'node:crypto';

import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { companionDb, userDb } from '@/modules/database/index.js';
import type { CompanionCeremonyAction } from '@/shared/companion-types.js';
import type { RelayedPress } from '@/shared/relayed-press-types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import type { CompanionStoredPending } from '../companion-pending.js';
import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { carryOut, endLapsedAction, isCarryingOut, withdrawStandingAction } from './action-end.js';
import { fireAction } from './action-doors.js';
import { clockOf, doneOf, nextStepFor, recordedAs, rearmStepFor, SAY_VERB, systemLine } from './action-prompts.js';
import { prepareRecipe, type PrepareInput } from './action-recipe.js';
import { rearmOf } from './action-rearm.js';
import { checkHisWord } from './action-word.js';
import { directTools } from './direct-tools.js';

/**
 * Her hands: `prepare_action`, `take_action` and `cancel_action` for the eleven actions that change the house (queue, hide, show,
 * rework, answer, recut, stop, resume, kick, resume_run, clear_memory), and `open` and `close_followup` (`direct-tools.ts`), which do
 * not wait. Whether he agreed to one, and when, is KAYLEE'S judgment, made in the conversation like everything else he says, and no
 * one else's (Scott, 2026-10-30): the server reads none of his words, a line he typed on her panel counts as much as one he spoke, and
 * she cancels with `cancel_action` when he declines or she judges he does not want it. What the SERVER holds is that the action is on
 * his panel and she read it back since it went up, in two steps:
 *
 *   1. `prepare_action` resolves the target, checks the action can be done now, PINS what it acts on (`action-recipe.ts`), checks
 *      that every line it carries is one of his lines of the last 30 minutes, records the action in `companion_actions` and
 *      puts it on her panel as the ONE pending action (`store.setPending`), replacing one already standing. It answers what she does
 *      next (`nextStepFor`: read it back in her own words, then decide whether he agreed). It lapses thirty minutes on. A prepare of the same thing as
 *      the ceremony before it, once that lapsed, was refused by the door or was replaced, RE-ARMS it (`action-rearm.ts`): the new action
 *      keeps the first prepare's stamp as `armedFrom`, so her read-back from before still counts.
 *   2. `take_action(said)` fires it when she calls it, only if `checkHisWord` (`action-word.ts`) answers ok on the rows of her log
 *      since `armedFrom`: she read it back to him. It also chooses which line of his is the RECORD of his word (the one `said` equals,
 *      else his newest). Otherwise it is refused with the sentence that says what is missing and the action stays on his panel, its row
 *      keeping that sentence as its `answer`. A take that fires answers with the line it recorded (`recordedAs`), so she sees when it is not the one
 *      she passed. `cancel_action` takes it down.
 *
 * A take fires through the house's own door (`action-doors.ts`) carrying kaylee--press's record of his word: who, when, what he
 * said, which line of his it was. It CLAIMS the action's row first (the firing line is written on it), and from then to the end
 * of the door nothing else may end, replace or fire that action (`action-end.ts`): his ×, a newer prepare, a lapse, a Clear and a
 * second take all leave it to the take. The row then ends with the door's outcome and sentence, a `system` line goes on her
 * panel, and the pending action leaves it. Each of the three first ends an action it finds past its time `expired`; nothing times
 * a lapse out. None of the three is read-only: each changes what waits on him.
 *
 * Each description is her prompt's own line for the tool (`toolLine`).
 *
 * Consumer: `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */

/** How long an action waits for his word before it lapses (and a prepare of the same one re-arms it). */
const WAIT_MS = 30 * 60_000;

const ACTIONS = ['queue', 'hide', 'show', 'rework', 'answer', 'recut', 'stop', 'resume', 'kick', 'resume_run', 'clear_memory'] as const satisfies readonly CompanionCeremonyAction[];

/**
 * What the schema says to an `action` that is not one of the eleven: the list, and where the two that need no ceremony went. Her prompt
 * says it too, but a call that still sends `open` or `close_followup` is told where to go, not only what it may not send.
 */
const WRONG_ACTION = `action is one of ${ACTIONS.join(', ')}. To bring something up on his screen call the open tool, and to tick off a follow-up call the close_followup tool: they act at once and are not prepared.`;

/** The refusal while a take is carrying the action out: another prepare, take or cancel waits for its answer. */
const BEING_CARRIED_OUT = 'The action on his panel is being carried out now; wait for its answer.';

/** Whether a take of this process is carrying out the action that stands on his panel (after settling a lapse and any orphan). */
function standingIsOut(deps: CompanionToolDeps): boolean {
  endLapsedAction(deps.userId, deps.store);
  const standing = deps.store.readState().pending;
  return standing !== null && isCarryingOut(deps.userId, standing.id);
}

function prepareAction(deps: CompanionToolDeps, input: PrepareInput): Promise<ToolTextResult> {
  return guardedToolResult('prepare_action', 'put the action on his panel', async () => {
    if (standingIsOut(deps)) return deps.refuse(BEING_CARRIED_OUT);

    const result = await prepareRecipe(deps, input);
    if (!result.ok) return deps.refuse(result.sentence);
    const { pin, readBack, ...fields } = result.prepared;
    // The recipe awaited: a take may have begun meanwhile, and the action it is carrying out is not this one's to replace. Nothing
    // below awaits, so what is read here is what is replaced.
    if (standingIsOut(deps)) return deps.refuse(BEING_CARRIED_OUT);

    // A lapse found just now was ended above, so it is the newest row if it is the one this prepare re-arms.
    const rearm = rearmOf(deps.userId, { ...fields, pin });
    const preparedMs = Date.now();
    const preparedAt = new Date(preparedMs).toISOString();
    const pending: CompanionStoredPending = {
      ...fields,
      id: randomUUID(),
      preparedAt,
      expiresAt: new Date(preparedMs + WAIT_MS).toISOString(),
      armedFrom: rearm?.armedFrom ?? preparedAt,
      pin,
    };
    companionDb.openAction(deps.userId, {
      id: pending.id,
      action: pending.action,
      target_json: JSON.stringify(pending.target),
      pin_json: JSON.stringify(pin),
      prompt: pending.prompt,
      carried_json: JSON.stringify(pending.carried),
      prepared_at: pending.preparedAt,
      expires_at: pending.expiresAt,
      armed_from: rearm?.armedFrom ?? null,
    });
    // The newer action replaces the older one on his panel; the older row says so. A lapse found just now was ended above.
    const replaced = deps.store.readState().pending;
    if (replaced !== null) companionDb.endAction(deps.userId, replaced.id, { outcome: 'replaced' });
    try {
      deps.store.setPending(pending);
    } catch (error) {
      companionDb.endAction(deps.userId, pending.id, { outcome: 'cancelled' });
      throw error;
    }

    const { action, target } = pending;
    const replacing = replaced === null ? '' : ` That replaced "${replaced.say}", which was waiting.`;
    const nextStep = rearm === null ? nextStepFor(readBack) : rearmStepFor(readBack, rearm.endedAs);
    return textResult(`On his panel, waiting for his answer: ${SAY_VERB[action].toLowerCase()} ${target.spoken}. ${nextStep} It lapses at ${clockOf(pending.expiresAt)}.${replacing}`);
  });
}

/** His press as the door's record carries it: the account that spoke, the line's time, words and log id, and the Accept's lock token. */
function pressOf(userId: number, standing: CompanionStoredPending, line: { id: number; at: string; text: string }): RelayedPress {
  const ask = standing.pin.ask;
  return {
    account: { id: userId, name: userDb.getUserById(userId)?.username ?? '' },
    saidAt: line.at,
    words: line.text,
    press: line.id,
    token: ask?.kind === 'accept' ? ask.token : null,
  };
}

function takeAction(deps: CompanionToolDeps, said: string): Promise<ToolTextResult> {
  return guardedToolResult('take_action', 'carry out the action', async () => {
    const nowMs = Date.now();
    const lapsed = endLapsedAction(deps.userId, deps.store, nowMs);
    const standing = lapsed ?? deps.store.readState().pending;
    if (lapsed === null && standing !== null && isCarryingOut(deps.userId, standing.id)) return deps.refuse(BEING_CARRIED_OUT);
    // A lapsed action reads no lines: the check answers the lapse first, with the sentence that says when. A live one reads every line since
    // its ceremony began, which for a re-arm is the first prepare's stamp: her read-back from before the lapse stands.
    const lines = standing === null || lapsed !== null ? [] : companionDb.heardSince(deps.userId, standing.armedFrom);
    const newestLine = companionDb.newestOperatorLine(deps.userId, true);
    const verdict = checkHisWord({ pending: standing, said, now: new Date(nowMs).toISOString(), lines, newestLine });
    if (!verdict.ok) {
      // The row says why the take did not fire it, as her answer does.
      if (standing !== null && lapsed === null) companionDb.noteRefusal(deps.userId, standing.id, verdict.sentence);
      return deps.refuse(verdict.sentence);
    }
    // `checkHisWord` refuses a take with nothing pending, so a pass here means an action stands; the check is for the type.
    if (standing === null) throw new Error('The check of his word passed a take with nothing pending.');

    const { line } = verdict;
    // Held from here to the end of the door, with no await between: the row is claimed first thing, so a second take, his ×, a newer
    // prepare, a lapse and a Clear all leave the action to this one (`action-end.ts`).
    return carryOut(deps.userId, standing.id, async () => {
      if (!companionDb.claimAction(deps.userId, standing.id, { said: line.text, said_at: line.at, said_log_id: line.id })) {
        return deps.refuse('That action is no longer waiting for his word: it has ended, or another call is carrying it out. Look at his panel, and prepare it again if he still wants it.');
      }
      const answer = await fireAction(deps, standing, pressOf(deps.userId, standing, line));
      companionDb.endAction(deps.userId, standing.id, { outcome: answer.outcome, said: line.text, said_at: line.at, said_log_id: line.id, answer: answer.said });
      deps.store.appendLog({ role: 'system', text: systemLine(standing, answer.outcome, answer.said) });
      // Only the card this take fired: a Clear and a prepare after it may have put another on his panel while the door was out.
      if (deps.store.readState().pending?.id === standing.id) deps.store.setPending(null);
      if (answer.outcome === 'refused') return deps.refuse(`Not done: ${answer.said}`);
      const happened = doneOf(standing.action, standing.target.spoken);
      return textResult(`Done on his word: ${happened}${answer.outcome === 'already' ? ' (it was already so)' : ''}. ${answer.said} ${recordedAs(line.text)}`);
    });
  });
}

function cancelAction(deps: CompanionToolDeps): Promise<ToolTextResult> {
  return guardedToolResult('cancel_action', 'take the action off his panel', () => {
    // His × ends an action through the same function.
    const withdrawal = withdrawStandingAction(deps.userId, deps.store);
    if (withdrawal === null) return textResult('Nothing was waiting for his word.');
    if (withdrawal.ended === 'busy') return deps.refuse(BEING_CARRIED_OUT);
    const { standing } = withdrawal;
    return textResult(
      withdrawal.ended === 'expired'
        ? `It had lapsed at ${clockOf(standing.expiresAt)}; it is off his panel and nothing was done.`
        : `Took it off his panel: ${standing.say}. Nothing was done.`,
    );
  });
}

/** The `said` field of `take_action`, in the prompt's register: his line as logged, the record of what he said. */
const SAID_DESCRIPTION = `His line as your log holds it, spoken or typed: the record of what he said. You decide, from the conversation, whether and when he agreed; there are no set words. The server only confirms you read the action back to him, and records his logged line that equals what you pass; when none equals it, it records his newest line instead and your answer says which. Read it back to him first, and when you judge he agreed, pass his line exactly as logged. Never a line you wrote, and never a call on your own words.`;

/** One line of his, carried: the field the two arrays of lines share. */
const carriedLines = z.array(z.string().trim().min(1).max(8000)).min(1).max(20);

/**
 * The definitions of `prepare_action`, `take_action` and `cancel_action` (the order her prompt lists them) and of `open` and
 * `close_followup` (`directTools`), built with the SDK's `tool()` and zod. None is read-only. Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */
export function handsTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'prepare_action',
      toolLine('prepare_action'),
      {
        action: z.enum(ACTIONS, { error: WRONG_ACTION }).describe('queue, hide and rework answer an open Accept prompt (hide and rework also act with none open); answer sends his answers to an open questions round; show, recut, stop, resume and kick act on a card; resume_run resumes a stopped chain with his rulings; clear_memory forgets every memory you keep. Opening something and ticking off a follow-up are not prepared: they are the open and close_followup tools.'),
        target: z.string().trim().min(1).max(300).describe('What it acts on, with every word of the name as he said it, even a word that is also an action ("probe eyes accept" is one card\'s name, though accept is also what queue is called): a card (feature or epic) by its name or title, a run by the id list_runs prints or by its plan and task, your memory as "your memory". When the answer lists several cards the name fits, call again with the full name of the one he meant.'),
        words: carriedLines.optional().describe('For rework (his notes) and resume_run (his rulings): his own lines, spoken or typed, each exactly as he said it in the last 30 minutes. Never your words.'),
        answers: z.array(z.object({ question: z.number().int().min(1), words: carriedLines })).max(20).optional().describe('For answer: one group per question he answered, by its number from 1, each group his own lines, spoken or typed, exactly as he said them.'),
      },
      (args) => prepareAction(deps, args),
    ),
    tool(
      'take_action',
      toolLine('take_action'),
      { said: z.string().trim().min(1).max(8000).describe(SAID_DESCRIPTION) },
      (args) => takeAction(deps, args.said),
    ),
    tool('cancel_action', toolLine('cancel_action'), {}, () => cancelAction(deps)),
    ...directTools(deps),
  ];
}
