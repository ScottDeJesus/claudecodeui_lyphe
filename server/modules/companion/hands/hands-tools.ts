import { randomUUID } from 'node:crypto';

import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { companionDb, userDb } from '@/modules/database/index.js';
import type { CompanionActionKind } from '@/shared/companion-types.js';
import type { RelayedPress } from '@/shared/relayed-press-types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import type { CompanionStoredPending } from '../companion-pending.js';
import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { carryOut, endLapsedAction, isCarryingOut, withdrawStandingAction } from './action-end.js';
import { fireAction } from './action-doors.js';
import { clockOf, doneOf, nextStepFor, NO_FLOOR, SAY_VERB } from './action-prompts.js';
import { prepareRecipe, type PrepareInput } from './action-recipe.js';
import { ACTION_TIER, actionsOfTier, checkHisWord } from './action-word.js';

/**
 * Her hands: `prepare_action`, `take_action` and `cancel_action`. She may do anything in the house he asks for, and none of it on
 * her own judgment (ruling 3, re-ruled 2026-10-29: "only on my explicit spoken word for that specific card, never on her own judgment";
 * "My 'yes' should count"). Two actions are harmless (open, close_followup: `ACTION_TIER`) and fire on his first word, with no
 * read-back; the eleven others keep "the full read-back-then-word ceremony". The SERVER holds that line, in two steps:
 *
 *   1. `prepare_action` resolves the target, checks the action can be done now, PINS what it acts on (`action-recipe.ts`), checks
 *      that every line it carries is one of his spoken lines of the last 30 minutes, records the action in `companion_actions` and
 *      puts it on her panel as the ONE pending action (`store.setPending`), replacing one already standing. It answers what she does
 *      next, by tier (`nextStepFor`), and the words that fire it. It lapses five minutes on.
 *   2. `take_action(said)` fires it, only when `checkHisWord` (`action-word.ts`) answers ok on the rows of her log since the prepare: his
 *      line was SPOKEN, it is his yes or it names the target and says the action's word, and it is an order; and for a FULL action she
 *      read it back to him first. A LIGHT action also fires on the request that led to the prepare, his last line before it
 *      (`heardBefore`). Otherwise it is refused with the sentence that says what is missing and the action stays on his panel, its row
 *      keeping that sentence as its `answer`. `cancel_action` takes it down.
 *
 * A take fires through the house's own door (`action-doors.ts`) carrying kaylee--press's record of his word: who, when, what he
 * said, which press of his it was. It CLAIMS the action's row first (the firing line is written on it), and from then to the end
 * of the door nothing else may end, replace or fire that action (`action-end.ts`): his ×, a newer prepare, a lapse, a Clear and a
 * second take all leave it to the take. The row then ends with the door's outcome and sentence, a `system` line goes on her
 * panel, and the pending action leaves it. Each of the three first ends an action it finds past its time `expired`; nothing times
 * a lapse out. None of the three is read-only: each changes what waits on him.
 *
 * Each description is her prompt's own line for the tool (`toolLine`).
 *
 * Consumer: `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */

/** How long an action waits for his word. */
const WAIT_MS = 5 * 60_000;

const ACTIONS = ['queue', 'hide', 'show', 'rework', 'answer', 'recut', 'stop', 'resume', 'kick', 'resume_run', 'open', 'close_followup', 'clear_memory'] as const satisfies readonly CompanionActionKind[];

/** Who answers for each action, as the system line quotes it; an open and a close have no sentence worth quoting. */
const SOURCE: Readonly<Partial<Record<CompanionActionKind, string>>> = {
  queue: 'The dispatcher', hide: 'The dispatcher', show: 'The dispatcher', rework: 'The dispatcher', answer: 'The dispatcher',
  recut: 'The dispatcher', stop: 'The dispatcher', resume: 'The dispatcher', kick: 'The dispatcher', resume_run: 'The runner',
};

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
    if (input.action === 'open' && deps.store.readState().floor === null) return deps.refuse(NO_FLOOR);
    // The recipe awaited: a take may have begun meanwhile, and the action it is carrying out is not this one's to replace. Nothing
    // below awaits, so what is read here is what is replaced.
    if (standingIsOut(deps)) return deps.refuse(BEING_CARRIED_OUT);

    const preparedMs = Date.now();
    const pending: CompanionStoredPending = {
      ...fields,
      id: randomUUID(),
      preparedAt: new Date(preparedMs).toISOString(),
      expiresAt: new Date(preparedMs + WAIT_MS).toISOString(),
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

    const { action, target, say } = pending;
    const replacing = replaced === null ? '' : ` That replaced "${replaced.say}", which was waiting.`;
    return textResult(
      `On his panel, waiting for his word: ${SAY_VERB[action].toLowerCase()} ${target.spoken}. ${nextStepFor(action, target, say, readBack)} `
      + `A line he typed never fires it. It lapses at ${clockOf(pending.expiresAt)}.${replacing}`,
    );
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

/** The panel's system line for an action that went through its door, in the words he reads: "On your word: queued Kaylee's eyes. The dispatcher said: …". */
function systemLine(standing: CompanionStoredPending, outcome: 'took' | 'already' | 'refused', said: string): string {
  const { action, target } = standing;
  const source = SOURCE[action];
  // An open and a close have no sentence worth quoting when they went through; when they were refused, the reason is the whole news.
  const quote = said === '' ? '' : source === undefined ? ` ${said}` : ` ${source} said: ${said}`;
  if (outcome === 'refused') return `Not done, on your word: ${standing.say}.${quote}`;
  return `On your word: ${doneOf(action, target.spoken)}.${outcome === 'already' ? ' It was already so.' : ''}${source === undefined ? '' : quote}`;
}

/**
 * The rows of her log the check of his word reads for the standing action: every line since the prepare and, for a LIGHT action, his last
 * line before it, the request that led to the prepare (`heardBefore`: null once an action has fired on it). A FULL action reads none of
 * the lines before its prepare.
 */
function heardForAction(userId: number, standing: CompanionStoredPending): ReturnType<typeof companionDb.heardSince> {
  const since = companionDb.heardSince(userId, standing.preparedAt);
  if (ACTION_TIER[standing.action] !== 'light') return since;
  const request = companionDb.heardBefore(userId, standing.preparedAt);
  return request === null ? since : [request, ...since];
}

function takeAction(deps: CompanionToolDeps, said: string): Promise<ToolTextResult> {
  return guardedToolResult('take_action', 'carry out the action', async () => {
    const nowMs = Date.now();
    const lapsed = endLapsedAction(deps.userId, deps.store, nowMs);
    const standing = lapsed ?? deps.store.readState().pending;
    if (lapsed === null && standing !== null && isCarryingOut(deps.userId, standing.id)) return deps.refuse(BEING_CARRIED_OUT);
    // A lapsed action reads no lines: the check answers the lapse first, with the sentence that says when.
    const lines = standing === null || lapsed !== null ? [] : heardForAction(deps.userId, standing);
    const verdict = checkHisWord({ pending: standing, said, now: new Date(nowMs).toISOString(), lines });
    if (!verdict.ok) {
      // The row says why his line did not fire it, as her answer does.
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
      return textResult(`Done on his word: ${happened}${answer.outcome === 'already' ? ' (it was already so)' : ''}. ${answer.said}`);
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

/**
 * The `said` field of `take_action`, in the prompt's register: his newest spoken line, as logged. For the eleven FULL actions it follows your
 * read-back and is his yes or the line that names the card and says the action; for the LIGHT ones (open, close_followup) it may also
 * be the request he made just before you prepared.
 */
const SAID_DESCRIPTION = `His newest spoken line, exactly as logged: his yes ("Yes.", "Go ahead.") or a line that names the card on his panel and says the action. For ${actionsOfTier('full').join(', ')}, say it back to him in plain words first and pass the line he says after that. For ${actionsOfTier('light').join(', ')} no read-back is needed: pass the request he made just before you prepared, or his first spoken yes. Never a line you wrote and never a line he typed. The server checks the line and refuses what does not count, so when he spoke a line that names the card and plausibly says the action (a transcript may hear "queue" as "cue"), pass it as logged rather than asking him to say it again.`;

/** One line of his, carried: the field the two arrays of lines share. */
const spokenLines = z.array(z.string().trim().min(1).max(8000)).min(1).max(20);

/**
 * The definitions of `prepare_action`, `take_action` and `cancel_action` (the order her prompt lists them), built with the SDK's
 * `tool()` and zod. None is read-only. Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */
export function handsTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'prepare_action',
      toolLine('prepare_action'),
      {
        action: z.enum(ACTIONS).describe('queue, hide and rework answer an open Accept prompt (hide and rework also act with none open); answer sends his answers to an open questions round; show, recut, stop, resume and kick act on a card; resume_run resumes a stopped chain with his rulings; open brings a card, run, page or chat up on his screen; close_followup ticks off one of his follow-ups; clear_memory forgets every memory you keep.'),
        target: z.string().trim().min(1).max(300).describe('What it acts on, with every word of the name as he said it, even a word that is also an action ("probe eyes accept" is one card\'s name, though accept is also what queue is called): a card (feature or epic) by its name or title, a run by the id list_runs prints or by its plan and task, a page by its id or title, a chat by its name or id, a follow-up as #<id> from list_followups, your memory as "your memory". When the answer lists several cards the name fits, call again with the full name of the one he meant. For open, write the kind in front ("chat: …") if the name could be more than one.'),
        words: spokenLines.optional().describe('For rework (his notes) and resume_run (his rulings): his own spoken lines, each exactly as he said it in the last 30 minutes. Never your words, never a line he typed.'),
        answers: z.array(z.object({ question: z.number().int().min(1), words: spokenLines })).max(20).optional().describe('For answer: one group per question he answered, by its number from 1, each group his own spoken lines exactly as he said them.'),
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
  ];
}
