import { kanbanBoardsDb, kanbanEventsDb, kanbanIdsDb, projectsDb } from '@/modules/database/index.js';
import {
  KANBAN_LEASE_STALE_SECONDS,
  type KanbanBoard,
  type KanbanEventRow,
  type KanbanLaneCount,
  type KanbanWriteContext,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import { writeKanban } from './kanban-write.service.js';

/**
 * The settings key holding the board the panel is showing.
 *
 * It lives in `kanban_settings` and NOT on the client, because boards are GLOBAL: switching
 * projects must not switch boards, and a board survives a reload, a second tab and a restart.
 * `current_board` is the one settings row this project imports from a Descent database.
 */
const CURRENT_BOARD_KEY = 'current_board';

/** A board that is not there is a 404, and this is the one place that sentence is written. */
function requireBoard(boardId: string): KanbanBoard {
  const board = kanbanBoardsDb.getBoard(boardId);
  if (!board) {
    throw new AppError(`No kanban board with id "${boardId}".`, {
      code: 'KANBAN_BOARD_NOT_FOUND',
      statusCode: 404,
    });
  }
  return board;
}

/**
 * A board may name a project, and a project id that names nothing is BAD INPUT — not a 500.
 *
 * `kanban_boards.project_id` is a real foreign key with `PRAGMA foreign_keys = ON`, so an unknown
 * id would otherwise surface as an integrity error through the global handler, telling a caller
 * nothing. Checked inside the write's transaction rather than before it, so the project cannot
 * vanish between the check and the insert.
 */
function requireProject(projectId: string): void {
  if (!projectsDb.getProjectById(projectId)) {
    throw new AppError(`No project with id "${projectId}".`, {
      code: 'KANBAN_PROJECT_NOT_FOUND',
      statusCode: 400,
    });
  }
}

/** A name is required and a blank one is not a name: the caller gets a 400, not a board called "". */
function requireBoardName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AppError('A board needs a name.', {
      code: 'KANBAN_BOARD_NAME_REQUIRED',
      statusCode: 400,
    });
  }
  return trimmed;
}

/**
 * The board verbs: create, list, read, update, select, resolve for a project, count a board's
 * cards per status, and read the audit log.
 *
 * EVERY write here goes through `writeKanban` — no verb in this file opens a transaction, inserts
 * an event or broadcasts. A write verb threads `context?.actor` straight into the seam, so the
 * actor on an audit row is `'operator'` today and an adapter's own name tomorrow without a
 * signature moving.
 *
 * Consumers: `routes/board.routes.ts` (every board route), and the barrel, which is how a future
 * in-process MCP adapter calls the same verbs.
 */
export const kanbanBoardsService = {
  /** Creates one board and returns it. Its id is minted inside the write, so a create cannot collide. */
  createBoard(input: { name: string; projectId?: string | null }, context?: KanbanWriteContext): KanbanBoard {
    const name = requireBoardName(input.name);
    const projectId = input.projectId ?? null;

    return writeKanban(
      // The board id does not exist until `mutate` runs — it is minted in the transaction — so the
      // event row and the frame take it from the created board.
      { kind: 'board.created', boardId: (board: KanbanBoard) => board.id, actor: context?.actor },
      () => {
        if (projectId !== null) requireProject(projectId);

        return kanbanBoardsDb.insertBoard({
          id: kanbanIdsDb.mintId('b'),
          name,
          projectId,
          autonomy: false,
        });
      }
    );
  },

  /**
   * Boards, live ones by default, with the selected board's id.
   *
   * `currentBoardId` is resolved against the list being returned: a setting naming a board that is
   * archived or gone reads as `null` rather than as an id the panel cannot show. Boards are global,
   * so this answer does not depend on which project asked.
   */
  listBoards(options?: { includeArchived?: boolean }): {
    boards: KanbanBoard[];
    currentBoardId: string | null;
  } {
    const boards = kanbanBoardsDb.listBoards(options?.includeArchived ?? false);
    const stored = kanbanBoardsDb.getSetting(CURRENT_BOARD_KEY);
    const currentBoardId = stored !== null && boards.some((board) => board.id === stored) ? stored : null;

    return { boards, currentBoardId };
  },

  /** One board, or null. The route decides what null means; the drawer's first read does not 404. */
  getBoard(boardId: string): KanbanBoard | null {
    return kanbanBoardsDb.getBoard(boardId);
  },

  /**
   * Applies a patch and returns the board as it stands. A missing board is a 404.
   *
   * The write is the only thing that decides whether the board was there, so the existence check
   * and the update are one statement inside one transaction rather than a read followed by a
   * hopeful write. Archiving is its own event kind, because "the board was archived" is what the
   * audit log is read for.
   */
  updateBoard(
    boardId: string,
    patch: {
      name?: string;
      autonomy?: boolean;
      deepseekFlash?: boolean;
      projectId?: string | null;
      archived?: boolean;
    },
    context?: KanbanWriteContext
  ): KanbanBoard {
    const name = patch.name === undefined ? undefined : requireBoardName(patch.name);

    return writeKanban(
      {
        kind: patch.archived === true ? 'board.archived' : 'board.updated',
        boardId,
        actor: context?.actor,
      },
      () => {
        if (patch.projectId !== undefined && patch.projectId !== null) requireProject(patch.projectId);

        const board = kanbanBoardsDb.updateBoard({
          id: boardId,
          name,
          autonomy: patch.autonomy,
          deepseekFlash: patch.deepseekFlash,
          projectId: patch.projectId,
          archived: patch.archived,
        });

        if (!board) {
          throw new AppError(`No kanban board with id "${boardId}".`, {
            code: 'KANBAN_BOARD_NOT_FOUND',
            statusCode: 404,
          });
        }

        return board;
      }
    );
  },

  /**
   * Makes one board the selected board and returns it as the new `currentBoardId`.
   *
   * The selection is a settings row, so it is a write like any other and goes through the seam —
   * which is what puts `board.selected` in the audit log and on the wire, so a second panel
   * follows the switch without a poll.
   */
  selectBoard(boardId: string, context?: KanbanWriteContext): { currentBoardId: string } {
    requireBoard(boardId);

    writeKanban({ kind: 'board.selected', boardId, actor: context?.actor }, () => {
      kanbanBoardsDb.setSetting(CURRENT_BOARD_KEY, boardId);
    });

    return { currentBoardId: boardId };
  },

  /**
   * The live board labelled with a project, or null.
   *
   * A board's `project_id` is a LABEL — which project this board is about — never a filter, and
   * this is the one caller that treats it as a lookup: the panel's first mount, which adopts a
   * board for the project it opened with when nothing is selected yet.
   */
  boardForProject(projectId: string): KanbanBoard | null {
    return kanbanBoardsDb.getBoardByProject(projectId);
  },

  /** Five rows, one per status, over the board's live cards. Missing board, 404. */
  laneCounts(boardId: string): KanbanLaneCount[] {
    requireBoard(boardId);
    return kanbanBoardsDb.laneCounts(boardId);
  },

  /**
   * How many cards on this board an autonomous session could claim right now.
   *
   * It is the driver's green light: a board whose autonomy is on but whose claimable count is zero
   * gets no child, because a session that wakes to find nothing to do is a session that burns a
   * conversation to read an empty lane. Like `laneCounts` this is a READ — no transaction, no
   * audit row, no frame — so the driver can ask it every tick without writing anything.
   *
   * `KANBAN_LEASE_STALE_SECONDS` is the same dial the card summaries and the lease verbs use, so
   * "stale" means one thing on this server rather than two.
   */
  claimableCount(boardId: string): number {
    requireBoard(boardId);
    return kanbanBoardsDb.countClaimable(boardId, KANBAN_LEASE_STALE_SECONDS);
  },

  /** The audit log, newest first. The limit is the route's to clamp — this reads what it is given. */
  listEvents(options: { boardId?: string; cardId?: string; limit?: number }): KanbanEventRow[] {
    return kanbanEventsDb.listEvents(options);
  },
};

/** What `routes/board.routes.ts` and `kanban.module.ts` take hold of. */
export type KanbanBoardsService = typeof kanbanBoardsService;
