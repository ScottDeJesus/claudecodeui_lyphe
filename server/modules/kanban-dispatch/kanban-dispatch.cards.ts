import path from 'node:path';

import {
  kanbanAttachmentsService,
  kanbanCardsService,
  kanbanChecklistService,
  kanbanQuestionsService,
  kanbanRosterService,
} from '@/modules/kanban/index.js';
import type {
  KanbanCardDetail,
  KanbanPriority,
  KanbanStatus,
  KanbanWriteContext,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import type { NoteDecision, NoteStepState } from './kanban-dispatch.notes.js';

/** The status the card and board services answer for a row that is not there. */
const NOT_FOUND_STATUS = 404;

/** How much of a board card's description a note reads: enough context, and a bounded prompt. */
const DESCRIPTION_CHARS_MAX = 2000;

/** The state a new checklist item starts in, so a step marked pending needs no state write. */
const PENDING_STEP_STATE: NoteStepState = 'pending';

/** The lane a change card opens in: the dispatcher's work starts in To Do. */
const CHANGE_CARD_STATUS: KanbanStatus = 'todo';

/**
 * The actor every write the dispatcher's notes make is stamped with. The teller never tells the
 * dispatcher about this actor's writes, so a note's own write cannot wake it about itself.
 */
export const DISPATCHER_ACTOR = 'dispatcher';

/** The write context every note write passes, so the audit line names the dispatcher. */
export const AS_DISPATCHER: KanbanWriteContext = { actor: DISPATCHER_ACTOR };

/** A step a note wants on a card, with the state and note it should carry. */
type StepMark = { text: string; state: NoteStepState; note: string };

/** The change half of a split flow: the card it opens on the board. */
type ChangeHalf = { title: string; description: string; tags: string[]; priority: KanbanPriority };

/** One card as the board roster lists it. */
type RosterCard = ReturnType<typeof kanbanRosterService.boardCards>[number];

/** A card still in play on the board, as a board note reads it. */
export type BoardOpenCard = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  status: KanbanStatus;
};

/** A card in Done, as a board note reads it. */
export type BoardDoneCard = {
  id: string;
  title: string;
  tags: string[];
  closing_remarks: string;
  description: string;
  /**
   * When the card arrived in Done: the board's own stamp, written by the move into Done and untouched
   * by later edits. A card whose stamp is missing (none on the live board) falls back to its last
   * change.
   */
  done_at: string;
  archived: boolean;
};

/** A board's cards split into what is still in play and what is Done. */
export type BoardAnswer = { open: BoardOpenCard[]; done: BoardDoneCard[] };

/**
 * The card when it exists and sits on this board, otherwise null. A note acts only on its own board.
 * Null means the card is gone: the caller stamps that and stops, rather than retrying forever.
 */
export function cardOnBoard(cardId: string, boardId: string): KanbanCardDetail | null {
  const card = readCardOrNull(cardId);
  if (card === null || card.boardId !== boardId) return null;
  return card;
}

/** The card detail, or null when the service says the card is not there. Other errors are the caller's. */
function readCardOrNull(cardId: string): KanbanCardDetail | null {
  try {
    return kanbanCardsService.getCard(cardId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** True for the 404 the services throw for a missing row. */
function isNotFound(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === NOT_FOUND_STATUS;
}

/**
 * The card as it stands now. An earlier write in the same pass may have changed what it holds, and
 * the snapshot the pass started from would point at removed items or miss added ones.
 */
function liveCard(cardId: string): KanbanCardDetail {
  return kanbanCardsService.getCard(cardId);
}

/**
 * Makes the checklist exactly these texts. The first item of each wanted text keeps its state and
 * note, every other item goes, and each missing text is added in the order given. A flow switch uses
 * this so the steps both flows share keep their progress, and a repeat run finds nothing to change.
 */
export function setSteps(card: KanbanCardDetail, steps: readonly string[]): void {
  const wanted = new Set(steps);
  const kept = new Set<string>();

  for (const item of liveCard(card.id).checklist) {
    if (wanted.has(item.text) && !kept.has(item.text)) kept.add(item.text);
    else kanbanChecklistService.removeChecklistItem(item.id, AS_DISPATCHER);
  }

  for (const text of steps) {
    if (kept.has(text)) continue;
    kanbanChecklistService.addChecklistItem(card.id, { text }, AS_DISPATCHER);
    kept.add(text);
  }
}

/**
 * Puts one step in the state and note the dispatcher names, adding the step when the checklist does
 * not hold its text. An item already exactly as named is left alone, so a repeat run writes nothing.
 */
export function markStep(card: KanbanCardDetail, step: StepMark): void {
  const item = liveCard(card.id).checklist.find((entry) => entry.text === step.text);
  if (item === undefined) {
    addStep(card.id, step);
    return;
  }
  if (item.state === step.state && item.note === step.note) return;
  kanbanChecklistService.updateChecklistItem(
    item.id,
    { state: step.state, note: step.note },
    AS_DISPATCHER
  );
}

/**
 * Adds a step the checklist lacks. The state is set after the add, so a stop between the two leaves
 * a pending item that the next pass finds and brings to its state.
 */
function addStep(cardId: string, step: StepMark): void {
  const added = kanbanChecklistService.addChecklistItem(
    cardId,
    { text: step.text, note: step.note },
    AS_DISPATCHER
  );
  if (step.state === PENDING_STEP_STATE) return;
  kanbanChecklistService.updateChecklistItem(added.id, { state: step.state }, AS_DISPATCHER);
}

/** True when the card already holds this question answered with exactly this one choice. */
function holdsDecision(cardId: string, question: string, choice: string): boolean {
  return liveCard(cardId).decisions.some(
    (entry) =>
      entry.question.trim() === question &&
      entry.choice.length === 1 &&
      entry.choice[0]?.trim() === choice
  );
}

/**
 * Records a decision unless the card already holds that question with that choice. A pass stopped
 * after recording but before its stamp finds its own decision on the next run and does not repeat it.
 */
export function noteDecisionOnce(card: KanbanCardDetail, decision: NoteDecision): void {
  const question = decision.question.trim();
  const choice = decision.choice.trim();
  if (holdsDecision(card.id, question, choice)) return;
  kanbanQuestionsService.noteDecision(card.id, { question, choice }, AS_DISPATCHER);
}

/**
 * Asks a question unless an unanswered one with the same text is already on the card. An answered
 * question does not count, because the dispatcher may need to ask it again.
 */
export function askOnce(
  card: KanbanCardDetail,
  question: { text: string; options: string[]; free: boolean }
): void {
  const text = question.text.trim();
  const open = liveCard(card.id).questions.some(
    (entry) => !entry.answered && entry.text.trim() === text
  );
  if (open) return;
  kanbanQuestionsService.addQuestion(
    card.id,
    { text, options: question.options, otherOn: question.free },
    AS_DISPATCHER
  );
}

/**
 * Attaches a screenshot under its shown name unless an attachment already carries that name. The
 * name falls back to the file's basename, so the check and the write agree on one name.
 */
export function attachShotOnce(card: KanbanCardDetail, shot: { path: string; name: string }): void {
  const name = shot.name.trim() || path.basename(shot.path);
  const attached = liveCard(card.id).attachments.some((entry) => entry.filename === name);
  if (attached) return;
  kanbanAttachmentsService.addAttachmentFromPath(card.id, shot.path, AS_DISPATCHER, name);
}

/**
 * The change half's card id, made at most once. A pass stopped after making the card but before its
 * stamp finds that card on the next run. Without tags there is nothing to match on, so a card is made.
 */
export function changeCardFor(boardId: string, half: ChangeHalf): string {
  return findChangeCard(boardId, half) ?? makeChangeCard(boardId, half);
}

/** The live card on the board that carries this title and every tag, or null when there is none. */
function findChangeCard(boardId: string, half: ChangeHalf): string | null {
  if (half.tags.length === 0) return null;
  const title = half.title.trim();
  const match = kanbanRosterService
    .boardCards(boardId)
    .find(
      (card) =>
        !card.archived &&
        card.title.trim() === title &&
        half.tags.every((tag) => card.tags.includes(tag))
    );
  return match?.id ?? null;
}

/** Creates the change card and then tags it. Each tag write is itself idempotent. */
function makeChangeCard(boardId: string, half: ChangeHalf): string {
  const card = kanbanCardsService.createCard(
    boardId,
    {
      title: half.title.trim(),
      description: half.description,
      priority: half.priority,
      status: CHANGE_CARD_STATUS,
    },
    AS_DISPATCHER
  );
  for (const tag of half.tags) kanbanCardsService.addTag(card.id, tag, AS_DISPATCHER);
  return card.id;
}

/**
 * Every card of the board but one, split into what is still in play and what is Done. The note
 * leaves out its own card so a card is never told about itself. The roster's order is kept.
 */
export function boardAnswer(boardId: string, exceptCardId: string): BoardAnswer {
  const cards = kanbanRosterService.boardCards(boardId).filter((card) => card.id !== exceptCardId);
  return {
    open: cards.filter((card) => !card.archived && card.status !== 'done').map(toOpenCard),
    done: cards.filter((card) => card.status === 'done').map(toDoneCard),
  };
}

/** The first DESCRIPTION_CHARS_MAX code points. Slicing by code point never splits a surrogate pair. */
function cutDescription(text: string): string {
  return Array.from(text).slice(0, DESCRIPTION_CHARS_MAX).join('');
}

function toOpenCard(card: RosterCard): BoardOpenCard {
  return {
    id: card.id,
    title: card.title,
    description: cutDescription(card.description),
    tags: card.tags,
    status: card.status,
  };
}

function toDoneCard(card: RosterCard): BoardDoneCard {
  return {
    id: card.id,
    title: card.title,
    tags: card.tags,
    closing_remarks: card.closingRemarks,
    description: cutDescription(card.description),
    done_at: card.doneAt ?? card.updatedAt,
    archived: card.archived,
  };
}
