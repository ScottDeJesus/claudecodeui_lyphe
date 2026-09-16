import {
  kanbanApprovalsDb,
  kanbanCardsDb,
  kanbanIdsDb,
  kanbanQuestionsDb,
  type KanbanCardRow,
} from '@/modules/database/index.js';
import type {
  KanbanCardSummary,
  KanbanQuestion,
  KanbanWriteContext,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import { cardNotFound, requireCardRow, requireSummary } from './kanban-cards.guards.js';
import { writeKanban } from './kanban-write.service.js';

/** A question that is not there is a 404, and this is the one place that sentence is written. */
function questionNotFound(questionId: string): AppError {
  return new AppError(`No kanban question with id "${questionId}".`, {
    code: 'KANBAN_QUESTION_NOT_FOUND',
    statusCode: 404,
  });
}

/** A question with no words is not a question: the caller gets a 400, not an empty row in a drawer. */
function requireQuestionText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AppError('A question needs its text.', {
      code: 'KANBAN_QUESTION_TEXT_REQUIRED',
      statusCode: 400,
    });
  }
  return trimmed;
}

/**
 * The choices a question offers, as a JSON array of strings.
 *
 * Blank members are dropped rather than kept: an option with no words is not a choice, and the
 * panel draws one row per member. Nothing is de-duplicated — two options that read the same are
 * the author's business, and silently merging them would answer a question differently from how
 * it was asked.
 */
function requireOptions(options: string[]): string[] {
  return options.filter((option) => typeof option === 'string' && option.trim().length > 0);
}

/** The choices a caller selected, kept exactly as strings — a selected member is never empty. */
function requireSelection(selected: string[]): string[] {
  return selected.filter((choice) => typeof choice === 'string' && choice.trim().length > 0);
}

/** One question, when the id is known to name one. */
function requireQuestion(questionId: string): KanbanQuestion {
  const question = kanbanQuestionsDb.getQuestion(questionId);
  if (!question) throw questionNotFound(questionId);
  return question;
}

/**
 * THE APPROVE GATE, exactly as Descent defines it (descent/README.md:428).
 *
 * A card may be approved when nobody is still waiting on an answer AND the card says something
 * about what would be built — a plan, a body, or at least a description. Either half alone is a
 * card the board would launch with a question unresolved or nothing to launch at all, and both
 * refusals are 409s rather than 400s: the request was well formed, the card is not ready.
 *
 * It reads inside the write's transaction, which is the point of it being here rather than in a
 * route: the unanswered count the gate sees is the count the approval is decided against.
 */
function requireApprovable(row: KanbanCardRow): void {
  const unanswered = kanbanQuestionsDb.countUnanswered(row.id);
  if (unanswered > 0) {
    throw new AppError(
      `This card cannot be approved while ${unanswered} question${unanswered === 1 ? '' : 's'} remain unanswered.`,
      { code: 'KANBAN_CARD_QUESTIONS_OPEN', statusCode: 409 }
    );
  }

  const hasSubstance =
    (row.plan ?? '').trim().length > 0 ||
    row.body.trim().length > 0 ||
    row.description.trim().length > 0;

  if (!hasSubstance) {
    throw new AppError('A card needs a plan, a body or a description before it can be approved.', {
      code: 'KANBAN_CARD_NEEDS_PLAN',
      statusCode: 409,
    });
  }
}

/**
 * The questions a card asks, the decisions their answers become, and the gate that holds a card
 * back until both are settled.
 *
 * EVERY write here goes through `writeKanban` — no verb in this file opens a transaction, appends
 * an audit row or sends a frame — and every one threads `context?.actor` into the seam, so an
 * audit row's actor is `'operator'` today and an adapter's own tomorrow without a signature
 * moving. A verb that needs two writes to be atomic does both inside ONE `mutate` callback.
 *
 * Consumers: `routes/detail.routes.ts`, `kanban-cards.service.ts`'s `getCard`, and the barrel,
 * which is how a future in-process MCP adapter calls the same verbs.
 */
export const kanbanQuestionsService = {
  /**
   * Asks one question on a card, and puts a To Do card into the `questions` status with it.
   *
   * The question and the status change are ONE `mutate` callback — one transaction, one event, one
   * frame — because they are one fact: a card that has just asked something is waiting on an
   * answer, and a card that asked without moving would sit in To Do looking ready. The move keeps
   * the card's `sort_order`: a question is not a place in the lane, and restacking the card here
   * would move it every time somebody asked it something.
   */
  addQuestion(
    cardId: string,
    input: { text: string; options?: string[]; multi?: boolean; otherOn?: boolean },
    context?: KanbanWriteContext
  ): KanbanQuestion {
    const text = requireQuestionText(input.text);
    const options = requireOptions(input.options ?? []);
    // Read before the write: it is the 404 for a card that is not there, and the board the audit
    // row has to name. Read again inside the transaction below, which is where it decides anything.
    const card = requireCardRow(cardId);

    return writeKanban(
      {
        kind: 'question.added',
        cardId,
        boardId: card.board_id,
        actor: context?.actor,
        payload: { text },
      },
      () => {
        const current = requireCardRow(cardId);

        const question = kanbanQuestionsDb.insertQuestion({
          id: kanbanIdsDb.mintId('q'),
          cardId,
          text,
          multi: input.multi ?? false,
          options,
          otherOn: input.otherOn ?? false,
        });

        if (current.status === 'todo') {
          kanbanCardsDb.setStatusAndOrder({
            id: cardId,
            status: 'questions',
            sortOrder: current.sort_order,
            clearBuildLease: false,
          });
        }

        return question;
      }
    );
  },

  /**
   * Answers one question, and writes the decision the answer became.
   *
   * Both writes are in ONE `mutate` callback: an answered question and its decision are one fact,
   * and a decision that outlived a rolled-back answer would be a card whose history says it chose
   * something it never answered. The decision keeps the question's own words, so the history still
   * reads correctly after the question is edited or the card is re-imported.
   */
  answerQuestion(
    questionId: string,
    input: { selected: string[]; other?: string },
    context?: KanbanWriteContext
  ): KanbanQuestion {
    const question = requireQuestion(questionId);
    const selected = requireSelection(input.selected);
    const other = input.other ?? '';
    const card = requireCardRow(question.cardId);

    return writeKanban(
      {
        kind: 'question.answered',
        cardId: question.cardId,
        boardId: card.board_id,
        actor: context?.actor,
        payload: { questionId, selected },
      },
      () => {
        // The update is the existence check: false means the question was not there after all.
        if (!kanbanQuestionsDb.answerQuestion({ id: questionId, selected, other })) {
          throw questionNotFound(questionId);
        }

        kanbanQuestionsDb.insertDecision({
          id: kanbanIdsDb.mintId('d'),
          cardId: question.cardId,
          questionId,
          question: question.text,
          choice: selected,
          tags: [],
        });

        return requireQuestion(questionId);
      }
    );
  },

  /**
   * Approves a card, once the gate above lets it through.
   *
   * A `not_ready` card that passes the gate is promoted to `todo` AND approved in ONE statement
   * inside the one `mutate` callback — never two writes, so a card can never be approved and left
   * in the backlog, nor promoted and left unapproved. A card already in another status only gains
   * the approval; the gate never moves a card that its author has placed.
   */
  approveCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary {
    return writeKanban(
      { kind: 'card.approved', cardId, boardId: (card) => card.boardId, actor: context?.actor },
      () => {
        const row = requireCardRow(cardId);
        requireApprovable(row);

        kanbanApprovalsDb.setApproved({
          id: cardId,
          approved: true,
          promoteTo: row.status === 'not_ready' ? 'todo' : undefined,
        });

        return requireSummary(cardId);
      }
    );
  },

  /**
   * Withdraws a card's approval.
   *
   * It clears `approved` and `approved_at` and NOTHING else: un-approving is not un-promoting, and
   * a card that was approved out of the backlog stays in To Do where its approval put it. Its
   * status is the author's decision to change, not this verb's.
   */
  unapproveCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary {
    return writeKanban(
      { kind: 'card.unapproved', cardId, boardId: (card) => card.boardId, actor: context?.actor },
      () => {
        if (!kanbanApprovalsDb.setApproved({ id: cardId, approved: false })) throw cardNotFound(cardId);
        return requireSummary(cardId);
      }
    );
  },
};

/** What `routes/detail.routes.ts` and `kanban.module.ts` take hold of. */
export type KanbanQuestionsService = typeof kanbanQuestionsService;
