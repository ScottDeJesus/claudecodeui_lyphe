import { writeFileSync } from 'node:fs';

import { closeFollowupForAccount, findFollowupForAccount } from '@/modules/followups/index.js';
import type { CompanionOpenTarget, CompanionPendingAction } from '@/shared/companion-types.js';
import type { RelayAnswer, RelayedPress } from '@/shared/relayed-press-types.js';

import type { CompanionStoredPending } from '../companion-pending.js';
import { accountName, clearMemory } from '../memory/memory-verbs.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { companionScratchDir, nextScratchFile, pruneScratch } from '../tools/transcript-render.js';

import { NO_FLOOR } from './action-prompts.js';

/**
 * THE DOORS: where each of the thirteen actions goes, every one the house's own. `take_action` fires eleven of them (`fireAction`); the
 * open and the close have no take, and `open` / `close_followup` (`direct-tools.ts`) go straight to their doors below.
 *
 *   - Queue, Hide and Rework at a prompt, and his answers to a questions round, go through `house.relay` to the dispatcher's ask
 *     book, which answers its own record of the pinned ask (so an ask that changed since he heard it read back is refused);
 *   - Hide or Show of an approved plan, a Rework with no prompt open (a `tell`), a re-cut, a stop, a resume and a kick are the
 *     dispatcher's own verbs, through `house.relay`;
 *   - a run resumed with rulings goes through `house.resumeRun`, with his rulings written to her scratch;
 *   - an open (`openOnFloor`) is `companion_open` to the page that holds the floor;
 *   - a follow-up (`closeFollowup`) closes as his own tick (`closeFollowupForAccount`: `closed_by` is `user`, and `followups_changed` is announced);
 *   - her memory is cleared through `clearMemory` (`memory/memory-verbs.ts`), every memory retired through her door with the firing
 *     line as each one's reason: the docstore's history keeps what was forgotten, with his words beside it.
 *
 * Each dispatcher or runner door carries kaylee--press's record of his word (`RelayedPress`), built by `take_action` from the line
 * that fired it. WHAT THE DESIGNER READS is his lines, verbatim: Rework notes and rulings are his carried lines' texts joined by
 * blank lines in the order he said them; answers are the card's own form, `Q: <question>` then `A: <his lines joined by a space>`,
 * or `A: (no answer)`, one pair per question, joined by blank lines. The record is never written into the brief.
 *
 * A door never throws: what it cannot do is `refused` with the sentence that says why (`throughDoor`).
 *
 * Consumers: `hands-tools.ts` (`take_action`) and `direct-tools.ts` (`open`, `close_followup`).
 */

type Carried = CompanionPendingAction['carried'];

/** His lines of one group, verbatim and in the order he said them (the prepare put them so), joined by blank lines: a Rework's notes, a run's rulings. */
function wordsBrief(carried: Carried): string {
  return carried.flatMap((group) => group.lines.map((line) => line.text)).join('\n\n');
}

/**
 * The answers to a round in the card's own form (`dispatcher-answer.service.ts`): per question of the ask `Q: <question text>`
 * then `A: <his lines joined by a space>`, or `A: (no answer)` for a question he gave none, the pairs joined by blank lines.
 * `numbers` is the pin's: the question (from 1) each carried group answers, so a group lands under its own question by number and
 * never by its text, which two questions of a round may share.
 */
function answersBrief(questions: ReadonlyArray<{ text: string }>, carried: Carried, numbers: readonly number[]): string {
  return questions
    .map((question, index) => {
      const group = carried[numbers.indexOf(index + 1)];
      const lines = group?.lines ?? [];
      return `Q: ${question.text}\nA: ${lines.length === 0 ? '(no answer)' : lines.map((line) => line.text).join(' ')}`;
    })
    .join('\n\n');
}

const refused = (said: string): RelayAnswer => ({ outcome: 'refused', said });

/** The name the dispatcher's verbs take for the card: the target's own, `<name>.arc` for an epic. */
function cardNameOf(pending: CompanionStoredPending): string | null {
  return pending.target.kind === 'card' ? pending.target.name : null;
}

/** The file his rulings are written to, in her scratch (numbered, and the folder pruned to its newest 20 like every render). */
function writeRulings(userId: number, rulings: string): string {
  const folder = companionScratchDir(userId);
  const file = nextScratchFile(folder, 'rulings');
  writeFileSync(file, rulings.endsWith('\n') ? rulings : `${rulings}\n`, 'utf8');
  // The file just written is the newest, so the prune never takes it.
  pruneScratch(folder);
  return file;
}

/** The dispatcher's order for a card action, or the sentence that says the pin it needs is missing. */
async function relayCardAction(deps: CompanionToolDeps, pending: CompanionStoredPending, press: RelayedPress): Promise<RelayAnswer> {
  const { house } = deps;
  const { ask } = pending.pin;
  const name = cardNameOf(pending);
  switch (pending.action) {
    case 'queue':
      return ask?.kind === 'accept' ? house.relay({ verb: 'queue', ask, press }) : refused('that action lost the prompt it was prepared on; prepare it again');
    case 'hide':
      if (ask?.kind === 'accept') return house.relay({ verb: 'hide-lock', ask, press });
      return name === null ? refused('that action names no card; prepare it again') : house.relay({ verb: 'hide', name, press });
    case 'rework': {
      const notes = wordsBrief(pending.carried);
      if (ask?.kind === 'accept') return house.relay({ verb: 'rework-lock', ask, notes, press });
      return name === null ? refused('that action names no card; prepare it again') : house.relay({ verb: 'tell', name, brief: notes, press });
    }
    case 'answer':
      return ask?.kind === 'questions' && pending.pin.questions?.length === pending.carried.length
        ? house.relay({ verb: 'answers', ask, brief: answersBrief(ask.questions, pending.carried, pending.pin.questions), press })
        : refused('that action lost the questions it was prepared on; prepare it again');
    case 'show':
    case 'recut':
    case 'stop':
    case 'resume':
    case 'kick':
      return name === null ? refused('that action names no card; prepare it again') : house.relay({ verb: pending.action, name, press });
    default:
      return refused(`${pending.action} is not a dispatcher act`);
  }
}

/**
 * An open: `companion_open` to the page that holds the floor, answered at once. With no page holding it nothing is sent. `spoken` is
 * the name the answer says it by, and the label the frame carries for the page's stage. Consumed by `direct-tools.ts` (`open`).
 */
export function openOnFloor(deps: CompanionToolDeps, open: CompanionOpenTarget, spoken: string): RelayAnswer {
  if (deps.store.readState().floor === null) return refused(NO_FLOOR);
  deps.openOnFloor(open, spoken);
  return { outcome: 'took', said: `${spoken} is up on the screen he is using.` };
}

/**
 * A follow-up closed as his own tick. One already closed (by him, by its chat, or by its completion) is `already`; one that is not his is
 * refused. Consumed by `direct-tools.ts` (`close_followup`).
 */
export function closeFollowup(deps: CompanionToolDeps, id: number): RelayAnswer {
  const item = findFollowupForAccount(deps.userId, id);
  if (item === null) return refused(`#${id} is not one of his follow-ups.`);
  if (item.followup.state !== 'open') return { outcome: 'already', said: `Follow-up #${id} was already closed.` };
  closeFollowupForAccount(deps.userId, id);
  return { outcome: 'took', said: `Follow-up #${id} is ticked off as his own.` };
}

/** "thing" or "things" after a count, as her sentences say it. */
const thingsOf = (count: number): string => `${count} ${count === 1 ? 'thing' : 'things'}`;

/**
 * Her memory cleared on his word: the firing line (from the record of his press) is each retired memory's reason. The bank may
 * have been emptied between the prepare and the take (a clear in Settings, a forget), which is `already`; a door that stopped part
 * way is `refused` with the sentence that says how far it got.
 */
async function clearHerMemory(deps: CompanionToolDeps, press: RelayedPress): Promise<RelayAnswer> {
  const cleared = await clearMemory({ kind: 'word', account: accountName(deps.userId), line: { id: press.press, at: press.saidAt, text: press.words } });
  if (!cleared.ok) return refused(cleared.sentence);
  if (cleared.forgotten === 0) return { outcome: 'already', said: 'Her memory was already empty.' };
  return { outcome: 'took', said: `She forgot ${thingsOf(cleared.forgotten)}. The docstore's history keeps them.` };
}

/**
 * Runs a door and answers its outcome. Anything a door throws (a spawn that failed, a disk that is full) is a refusal with the reason,
 * never a throw: the caller has already decided the word was his or the request clear, and what the house did with it is the answer.
 * Consumed here (`fireAction`) and by `direct-tools.ts`.
 */
export async function throughDoor(label: string, run: () => RelayAnswer | Promise<RelayAnswer>): Promise<RelayAnswer> {
  try {
    return await run();
  } catch (error) {
    console.error(`[Companion] ${label} did not complete`, error);
    return refused(`the house could not do it just now (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Fires the standing action through its door, with `press` as the record of the word that fired it. Answers the door's outcome and
 * its own first line. `take_action` has already decided the word was his, and what the house did with it is the answer.
 */
export function fireAction(deps: CompanionToolDeps, pending: CompanionStoredPending, press: RelayedPress): Promise<RelayAnswer> {
  return throughDoor(`${pending.action} on his word`, async () => {
    switch (pending.action) {
      case 'resume_run': {
        const chainId = pending.pin.chainId;
        if (chainId === undefined) return refused('that action lost the run it was prepared on; prepare it again');
        const rulingsFile = writeRulings(deps.userId, wordsBrief(pending.carried));
        return await deps.house.resumeRun({ chainId, rulingsFile, press });
      }
      case 'clear_memory':
        return await clearHerMemory(deps, press);
      default:
        return await relayCardAction(deps, pending, press);
    }
  });
}
