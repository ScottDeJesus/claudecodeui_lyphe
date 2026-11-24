import { kanbanBoardsService, kanbanCardsService } from '@/modules/kanban/index.js';
import { KANBAN_LANE_LIMIT_MAX, type KanbanBoard, type KanbanStatus } from '@/shared/kanban-types.js';

/**
 * The lane whose cards a self-running board has approved. The operator, 11-18: the cards he types are
 * his approval, so a card in To Do on a board whose switch is on is work to walk, with no further press.
 */
const APPROVED_LANE: KanbanStatus = 'todo';

/** The ids of a board's live To Do cards, in the lane's own order, every page read. */
export function todoCardIdsOf(boardId: string): string[] {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: ReturnType<typeof kanbanCardsService.listLaneCards> = kanbanCardsService.listLaneCards(boardId, [APPROVED_LANE], {
      limit: KANBAN_LANE_LIMIT_MAX,
      cursor,
    });
    ids.push(...page.cards.filter((card) => !card.archived).map((card) => card.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return ids;
}

/** Every live (not archived) board whose switch is on. */
export function selfRunningBoards(): KanbanBoard[] {
  return kanbanBoardsService.listBoards().boards.filter((board) => board.autonomy);
}
