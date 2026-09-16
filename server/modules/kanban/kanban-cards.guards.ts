import { kanbanBoardsDb, kanbanCardsDb, type KanbanCardRow } from '@/modules/database/index.js';
import type { KanbanCardSummary } from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

/**
 * The card module's refusals and read-backs: what a card verb checks before it touches a row, and
 * how it gets the value it has to return.
 *
 * It is a sibling of `kanban-cards.service.ts` rather than a preamble inside it because it is the
 * module's SHARED vocabulary, not the card service's private business: the detail verbs, the
 * question and checklist verbs and the lease verbs all act on a card that must exist, and each of
 * them would otherwise write its own 404 with its own code. One sentence per condition, written
 * once — which is what makes `KANBAN_CARD_NOT_FOUND` mean the same thing to every caller.
 *
 * Nothing here writes. Every function either throws or hands back a row the caller already had the
 * id for.
 */

/** A card that is not there is a 404, and this is the one place that sentence is written. */
export function cardNotFound(cardId: string): AppError {
  return new AppError(`No kanban card with id "${cardId}".`, {
    code: 'KANBAN_CARD_NOT_FOUND',
    statusCode: 404,
  });
}

/**
 * The board check every card write begins with.
 *
 * A missing board would otherwise surface as a foreign-key error from `kanban_cards.board_id`, and
 * the global handler would render SQLite's sentence as a 500 — telling the caller nothing they can
 * act on. The code and the message match `kanban-boards.service.ts`'s guard for the same condition,
 * so one board lookup answers the same way whichever verb asked.
 */
export function requireBoard(boardId: string): void {
  if (!kanbanBoardsDb.getBoard(boardId)) {
    throw new AppError(`No kanban board with id "${boardId}".`, {
      code: 'KANBAN_BOARD_NOT_FOUND',
      statusCode: 404,
    });
  }
}

/**
 * One card's summary, when the id is known to name a card.
 *
 * The summary is what a verb RETURNS: every card write answers with the card as it now stands, so
 * the panel repaints from the response instead of following every write with a read.
 */
export function requireSummary(cardId: string): KanbanCardSummary {
  const summary = kanbanCardsDb.getSummary(cardId);
  if (!summary) throw cardNotFound(cardId);
  return summary;
}

/** One card's whole row, when the caller has no use for a null. */
export function requireCardRow(cardId: string): KanbanCardRow {
  const row = kanbanCardsDb.getCardRow(cardId);
  if (!row) throw cardNotFound(cardId);
  return row;
}

/**
 * A card named as a POSITION — the neighbour a moved card is being placed against.
 *
 * A neighbour that is not a card is the ordinary 404. One that is a card on a DIFFERENT BOARD is
 * refused too: its `sort_order` would be another board's number, and a midpoint taken against it
 * would place the moved card against values that mean nothing in its own lane.
 *
 * What is deliberately NOT checked here is the lane, because it cannot be: a lane is a SET of
 * statuses chosen by the panel, so a neighbour from a sibling status inside the same lane is
 * ordinary — with autonomy off the To Do lane holds `todo` AND `questions` cards, and a drop
 * between two of them names both. This checks the board, never the status.
 */
export function requireLaneNeighbour(cardId: string, boardId: string): KanbanCardRow {
  const row = requireCardRow(cardId);
  if (row.board_id !== boardId) {
    throw new AppError(`Card "${cardId}" is not on board "${boardId}".`, {
      code: 'KANBAN_NEIGHBOUR_BOARD_MISMATCH',
      statusCode: 400,
    });
  }
  return row;
}

/** A title is required and a blank one is not a name: the caller gets a 400, not a card called "". */
export function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new AppError('A card needs a title.', {
      code: 'KANBAN_CARD_TITLE_REQUIRED',
      statusCode: 400,
    });
  }
  return trimmed;
}

/** A tag with no name is not a tag. Trimmed here so `" api "` and `"api"` are one tag, not two. */
export function requireTag(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.length === 0) {
    throw new AppError('A tag needs a name.', { code: 'KANBAN_TAG_REQUIRED', statusCode: 400 });
  }
  return trimmed;
}
