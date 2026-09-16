import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import type { KanbanBoardsService } from '../kanban-boards.service.js';

/**
 * What one audit-log read may ask for.
 *
 * The clamp is here, in the transport, and not in the service: without it a single request can
 * ask for a board's whole history, and an imported Descent board's log is twelve thousand rows.
 */
const EVENT_LIMIT_DEFAULT = 50;
const EVENT_LIMIT_MAX = 200;

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type BoardRouteDependencies = { boards: KanbanBoardsService };

/**
 * One handler, with its failure path attached once.
 *
 * Every service failure is an `AppError` and belongs to `next(error)`, which turns it into the
 * global handler's `{ success: false, error: { code, message } }`. Nothing is caught here: a route
 * that decided what an error meant would be a second, quieter policy beside the service's.
 */
function handle<P = Record<string, string>>(
  run: (request: Request<P>, response: Response) => void
): RequestHandler<P> {
  return (request: Request<P>, response: Response, next: NextFunction) => {
    try {
      run(request, response);
    } catch (error) {
      next(error);
    }
  };
}

/** A query value that may arrive repeated or as a nested object; only the first plain string counts. */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** `?includeArchived=1` and `?includeArchived=true` both mean yes; anything else means the default. */
function wantsArchived(value: unknown): boolean {
  const flag = firstString(value);
  return flag === '1' || flag === 'true';
}

/** Clamps an audit-log limit to `[1, 200]`, defaulting to 50 when it is absent or unusable. */
function parseEventLimit(value: unknown): number {
  const raw = firstString(value);
  if (raw === undefined) return EVENT_LIMIT_DEFAULT;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return EVENT_LIMIT_DEFAULT;

  return Math.min(parsed, EVENT_LIMIT_MAX);
}

/**
 * The board routes: the board list, its create, update and select, its per-status counts, the
 * lookup that resolves a project to its board, and the board's audit log.
 *
 * Auth is the mount's (`authenticateToken` in `server/index.ts`): no file here imports the guard,
 * and no route reads an actor off the request — the write verbs take the optional trailing context
 * and the routes pass nothing, so an event's actor is `'operator'`.
 *
 * These handlers parse, call one service verb and shape the answer. No transaction, no database
 * handle, and no board policy lives here. The card routes are Phase 3's and are a sibling file.
 */
export function createBoardRoutes(dependencies: BoardRouteDependencies): Router {
  const router = express.Router();
  const { boards } = dependencies;

  router.get(
    '/boards',
    handle((request, response) => {
      response.json(boards.listBoards({ includeArchived: wantsArchived(request.query.includeArchived) }));
    })
  );

  router.post(
    '/boards',
    handle((request, response) => {
      const body = (request.body ?? {}) as { name?: unknown; projectId?: unknown };
      // The type check is the route's, the emptiness check is the service's: a blank name is a
      // 400 either way, and only one of the two is a transport concern.
      if (typeof body.name !== 'string') {
        response.status(400).json({ error: 'a board name is required' });
        return;
      }
      if (body.projectId !== undefined && typeof body.projectId !== 'string' && body.projectId !== null) {
        response.status(400).json({ error: 'projectId must be a string or null' });
        return;
      }

      response.json({ board: boards.createBoard({ name: body.name, projectId: body.projectId ?? null }) });
    })
  );

  router.patch(
    '/boards/:boardId',
    handle<{ boardId: string }>((request, response) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch: { name?: string; autonomy?: boolean; projectId?: string | null; archived?: boolean } = {};

      if (body.name !== undefined) {
        if (typeof body.name !== 'string') {
          response.status(400).json({ error: 'name must be a string' });
          return;
        }
        patch.name = body.name;
      }
      if (body.autonomy !== undefined) {
        if (typeof body.autonomy !== 'boolean') {
          response.status(400).json({ error: 'autonomy must be a boolean' });
          return;
        }
        patch.autonomy = body.autonomy;
      }
      if (body.projectId !== undefined) {
        if (typeof body.projectId !== 'string' && body.projectId !== null) {
          response.status(400).json({ error: 'projectId must be a string or null' });
          return;
        }
        patch.projectId = body.projectId;
      }
      if (body.archived !== undefined) {
        if (typeof body.archived !== 'boolean') {
          response.status(400).json({ error: 'archived must be a boolean' });
          return;
        }
        patch.archived = body.archived;
      }

      response.json({ board: boards.updateBoard(request.params.boardId, patch) });
    })
  );

  router.post(
    '/boards/:boardId/select',
    handle<{ boardId: string }>((request, response) => {
      response.json(boards.selectBoard(request.params.boardId));
    })
  );

  router.get(
    '/boards/:boardId/lanes',
    handle<{ boardId: string }>((request, response) => {
      response.json({ lanes: boards.laneCounts(request.params.boardId) });
    })
  );

  router.get(
    '/projects/:projectId/board',
    handle<{ projectId: string }>((request, response) => {
      response.json({ board: boards.boardForProject(request.params.projectId) });
    })
  );

  router.get(
    '/events',
    handle((request, response) => {
      const boardId = firstString(request.query.boardId);
      const cardId = firstString(request.query.cardId);

      response.json({
        events: boards.listEvents({
          boardId,
          cardId,
          limit: parseEventLimit(request.query.limit),
        }),
      });
    })
  );

  return router;
}
