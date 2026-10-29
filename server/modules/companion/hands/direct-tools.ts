import { randomUUID } from 'node:crypto';

import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { companionDb } from '@/modules/database/index.js';
import type { CompanionActionTarget } from '@/shared/companion-types.js';
import type { RelayAnswer } from '@/shared/relayed-press-types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import type { CompanionPin } from '../companion-pending.js';
import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { closeFollowup, openOnFloor, throughDoor } from './action-doors.js';
import { carryOut } from './action-end.js';
import { firstSentence, NO_FLOOR, sayOf, systemLine } from './action-prompts.js';
import { findFollowup, findOpenTarget } from './action-targets.js';

/**
 * HER TWO HARMLESS HANDS: `open` and `close_followup`, one call each, with no ceremony. The operator's ruling of 2026-10-29: "no prepare,
 * no yes, no lapse. When I ask for it in any natural phrasing, a question included ("can you pull up", "show me", "bring up",
 * "open"), Kaylee opens it straight away in one call and says what she opened. A polite question is an order. If she is unsure which
 * page or chat I mean, she asks that, nothing else." Nothing here checks his word: there is no pending action, no card, no read-back
 * and no lapse, and a question mark is no reason to wait.
 *
 * A call resolves its target the way `prepare_action` resolves one (`action-targets.ts`), runs the door at once (`action-doors.ts`) and
 * answers in her voice what was opened or closed. A target that is not found, or fits several, answers the resolver's own sentence
 * (the names that fit), so she asks him which and asks nothing else. An open with no page holding the floor is refused (`NO_FLOOR`),
 * as it always was: the open is sent to that page alone.
 *
 * The call is recorded as a take is: a `companion_actions` row opened, claimed and ended inside `carryOut` (`action-end.ts`, so the
 * next prepare does not end it `refused` as an orphan), its outcome the door's, and a `system` line goes on her panel. The row's `said`
 * is his newest line of any kind, spoken or typed: the trigger of the record, never a gate. `expires_at` is `prepared_at`, since
 * nothing waits.
 *
 * Consumer: `hands-tools.ts` (`handsTools`).
 */

type DirectAction = 'open' | 'close_followup';

/**
 * Records and runs one harmless action: the row, the door and the panel's line, in the order a take does them. `door` answers at once
 * and never throws (`throughDoor`). Answers the door's own outcome and sentence.
 */
function goDirectly(
  deps: CompanionToolDeps,
  done: { action: DirectAction; target: CompanionActionTarget; pin: CompanionPin },
  door: () => RelayAnswer,
): Promise<RelayAnswer> {
  const { action, target, pin } = done;
  const id = randomUUID();
  // Held from this call, with no await before the row is claimed, to the end of the door, so an orphan sweep never finds it half done.
  return carryOut(deps.userId, id, async () => {
    const now = new Date().toISOString();
    const line = companionDb.newestOperatorLine(deps.userId);
    const trigger = line === null ? null : { said: line.text, said_at: line.at, said_log_id: line.id };
    companionDb.openAction(deps.userId, {
      id, action, target_json: JSON.stringify(target), pin_json: JSON.stringify(pin), prompt: null, carried_json: '[]', prepared_at: now, expires_at: now,
    });
    // With nothing of his in the log (a Clear emptied it) there is no line to write on the row; the row still ends below.
    if (trigger !== null) companionDb.claimAction(deps.userId, id, trigger);
    const answer = await throughDoor(`${action} on his request`, door);
    companionDb.endAction(deps.userId, id, { outcome: answer.outcome, ...trigger, answer: answer.said });
    deps.store.appendLog({ role: 'system', text: systemLine({ action, target, say: sayOf(action, target.spoken) }, answer.outcome, answer.said) });
    return answer;
  });
}

function openIt(deps: CompanionToolDeps, ref: string): Promise<ToolTextResult> {
  return guardedToolResult('open', 'bring it up on his screen', async () => {
    const found = await findOpenTarget(deps.house, ref);
    if (!found.ok) return deps.refuse(found.sentence);
    const { target, open } = found.value;
    // The resolver awaited, so the floor is read after it, and the door reads it again: nothing between them awaits.
    if (deps.store.readState().floor === null) return deps.refuse(NO_FLOOR);
    const answer = await goDirectly(deps, { action: 'open', target, pin: { open } }, () => openOnFloor(deps, open, target.spoken));
    return answer.outcome === 'refused' ? deps.refuse(`Not done: ${answer.said}`) : textResult(answer.said);
  });
}

function closeIt(deps: CompanionToolDeps, ref: string): Promise<ToolTextResult> {
  return guardedToolResult('close_followup', 'tick the follow-up off', async () => {
    const found = findFollowup(deps.userId, ref);
    if (!found.ok) return deps.refuse(found.sentence);
    const { value: target } = found;
    const answer = await goDirectly(deps, { action: 'close_followup', target, pin: { followupId: target.id } }, () => closeFollowup(deps, target.id));
    if (answer.outcome === 'refused') return deps.refuse(`Not done: ${answer.said}`);
    // The follow-up's own full stop would sit inside the quote and be followed by the sentence's: the quote ends without it.
    const closed = (firstSentence(target.text) ?? target.text).replace(/[.!?]+$/, '');
    return textResult(answer.outcome === 'already' ? answer.said : `Closed: "${closed}". ${answer.said}`);
  });
}

/**
 * The definitions of `open` and `close_followup` (the order her prompt lists them), built with the SDK's `tool()` and zod. Neither is
 * read-only. Consumed by `hands-tools.ts` (`handsTools`), which hands them to `tools/companion-tools.ts` with the rest of her hands.
 */
export function directTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'open',
      toolLine('open'),
      {
        target: z.string().trim().min(1).max(300).describe('What to bring up, as he named it: a card (feature or epic) by its name or title, a run by the id list_runs prints or by its plan and task, a page by its id or title, a chat by its name or id. Write the kind in front ("chat: …", "page: …") if the name could be more than one. When the answer lists several that fit, ask him which: nothing else.'),
      },
      (args) => openIt(deps, args.target),
    ),
    tool(
      'close_followup',
      toolLine('close_followup'),
      {
        followup: z.string().trim().min(1).max(40).describe('The follow-up as #<id>, the number list_followups prints.'),
      },
      (args) => closeIt(deps, args.followup),
    ),
  ];
}
