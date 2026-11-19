import { kanbanBoardsDb, kanbanRosterDb, type KanbanRosterCard } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/**
 * The board's roster, read whole: every card, archived and done ones included,
 * newest change first. For a caller that compares a card with the rest of its
 * board: the dispatcher's duplicate and earlier-fix search, answered by
 * `server/modules/kanban-dispatch/`. A read, so it goes through no write seam
 * and sends no frame. A board that is not there is the same 404 every board
 * verb answers.
 */
export const kanbanRosterService = {
  /** Every card on one board, archived and done included, newest change first. */
  boardCards(boardId: string): KanbanRosterCard[] {
    if (!kanbanBoardsDb.getBoard(boardId)) {
      throw new AppError(`No kanban board with id "${boardId}".`, {
        code: 'KANBAN_BOARD_NOT_FOUND',
        statusCode: 404,
      });
    }
    return kanbanRosterDb.listBoardCards(boardId);
  },
};

export type KanbanRosterService = typeof kanbanRosterService;
