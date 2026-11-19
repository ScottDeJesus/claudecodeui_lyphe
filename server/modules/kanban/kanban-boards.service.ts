import { kanbanBoardsDb, kanbanEventsDb, kanbanIdsDb, projectsDb } from '@/modules/database/index.js';
import {
  type KanbanBoard,
  type KanbanEventRow,
  type KanbanLaneCount,
  type KanbanWriteContext,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import { requireBoardRepos } from './kanban-board-repos.js';
import { writeKanban } from './kanban-write.service.js';

/**
 * The settings key holding the board the panel is showing.
 *
 * It lives in `kanban_settings` and NOT on the client, because boards are GLOBAL: switching
 * projects must not switch boards, and a board survives a reload, a second tab and a restart.
 * `current_board` is the one settings row an imported database seeds; nothing else writes it.
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

/** An autonomous board always names a repository; see `updateBoard` for why. */
function requireReposForAutonomy(autonomy: boolean, repos: readonly string[]): void {
  if (autonomy && repos.length === 0) {
    throw new AppError('A board runs itself only once it names at least one repository.', {
      code: 'KANBAN_BOARD_NEEDS_REPOS',
      statusCode: 409,
    });
  }
}

/**
 * The board verbs: create, list, read, update, select, resolve for a project, count a board's
 * cards per status, and read the audit log.
 *
 * EVERY write here goes through `writeKanban` — no verb in this file opens a transaction, inserts
 * an event or broadcasts. A write verb threads `context?.actor` straight into the seam, so the
 * actor on an audit row is the one the caller passed (the intake door and the dispatcher pass
 * their own) and `'operator'` when it passed none.
 *
 * Consumers: `routes/board.routes.ts` (every board route), and the barrel, which is how a future
 * in-process MCP adapter calls the same verbs.
 */
export const kanbanBoardsService = {
  /** Creates one board and returns it. Its id is minted inside the write, so a create cannot collide. */
  createBoard(
    input: { name: string; projectId?: string | null; repos?: string[] },
    context?: KanbanWriteContext
  ): KanbanBoard {
    const name = requireBoardName(input.name);
    const projectId = input.projectId ?? null;
    const repos = requireBoardRepos(input.repos ?? []);

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
          repos,
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
   * The existence check and the update sit in one transaction rather than a read followed by a
   * hopeful write, so the board cannot change between them. Archiving is its own event kind,
   * because "the board was archived" is what the audit log is read for.
   *
   * A board that runs itself must name a repository, because the dispatcher builds each card in the
   * board's repositories, and a board with none would take cards it has nowhere to build. The check
   * reads the board inside the transaction so that the autonomy and repos it judges are the ones the
   * write stores.
   */
  updateBoard(
    boardId: string,
    patch: {
      name?: string;
      autonomy?: boolean;
      projectId?: string | null;
      archived?: boolean;
      repos?: string[];
    },
    context?: KanbanWriteContext
  ): KanbanBoard {
    const name = patch.name === undefined ? undefined : requireBoardName(patch.name);
    // Outside the transaction: normalising the paths runs git, and a write should not hold the
    // database while a subprocess runs.
    const repos = patch.repos === undefined ? undefined : requireBoardRepos(patch.repos);
    // An archived board does not run itself: archiving turns its autonomy off in the same write, and the audit row says
    // so (`{autonomy: false}`), so the dispatcher hears `board-off` and withdraws the cards it had not yet walked.
    const archiving = patch.archived === true;
    const wasRunning = archiving && kanbanBoardsDb.getBoard(boardId)?.autonomy === true;
    const autonomy = archiving ? false : patch.autonomy;
    // An archive names the switch only when it turned a running board off; any other write names it only when it set it.
    let auditedAutonomy: Record<string, unknown>;
    if (archiving) {
      auditedAutonomy = wasRunning ? { autonomy: false } : {};
    } else {
      auditedAutonomy = autonomy === undefined ? {} : { autonomy };
    }

    return writeKanban(
      {
        kind: patch.archived === true ? 'board.archived' : 'board.updated',
        boardId,
        actor: context?.actor,
        // Named in the audit row, so a listener (the board-dispatch module) can tell the autonomy switch moving from a rename, and an archive that turned it off.
        payload: auditedAutonomy,
      },
      () => {
        if (patch.projectId !== undefined && patch.projectId !== null) requireProject(patch.projectId);

        if (autonomy === true || repos !== undefined) {
          const current = requireBoard(boardId);
          // An archived board does not run itself; one restored in this same write (`archived: false`) may.
          if (autonomy === true && (patch.archived ?? current.archived)) {
            throw new AppError('An archived board cannot run itself; restore it first.', {
              code: 'KANBAN_BOARD_ARCHIVED',
              statusCode: 409,
            });
          }
          requireReposForAutonomy(autonomy ?? current.autonomy, repos ?? current.repos);
        }

        const board = kanbanBoardsDb.updateBoard({
          id: boardId,
          name,
          autonomy,
          projectId: patch.projectId,
          archived: patch.archived,
          repos,
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

  /** The audit log, newest first. The limit is the route's to clamp — this reads what it is given. */
  listEvents(options: { boardId?: string; cardId?: string; limit?: number }): KanbanEventRow[] {
    return kanbanEventsDb.listEvents(options);
  },
};

/** What `routes/board.routes.ts` and `kanban.module.ts` take hold of. */
export type KanbanBoardsService = typeof kanbanBoardsService;
