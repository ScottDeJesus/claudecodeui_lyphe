import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import type { KanbanImportService } from '../kanban-import.service.js';

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type ImportRouteDependencies = { importer: KanbanImportService };

/**
 * One handler, with its failure path attached once.
 *
 * Every service failure is an `AppError` and belongs to `next(error)`, which renders
 * `{ success: false, error: { code, message } }`. Nothing is caught here: a route that decided
 * what an error meant would be a second, quieter policy beside the service's — and the import's
 * own refusals (no such file, not a Descent board) arrive as `AppError`s with plain messages
 * already, so the 404 on the wire is the transport's own sentence.
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

/**
 * The import route: the board's one door onto a foreign database.
 *
 * The body is optional and so is its single field — an absent `dbPath` means the operator's own
 * Descent install, resolved by the transport. Nothing else is parsed here: the import takes no
 * filters, no selections and no confirmation, because the whole database is the unit it works in,
 * and the id translation it returns is what tells the caller what landed.
 *
 * Auth is the mount's (`authenticateToken` in `server/index.ts`), as it is for the three sibling
 * route files: this one imports no guard.
 */
export function createImportRoutes(dependencies: ImportRouteDependencies): Router {
  const router = express.Router();
  const { importer } = dependencies;

  router.post(
    '/import/descent',
    handle((request, response) => {
      const body = (request.body ?? {}) as { dbPath?: unknown };

      if (body.dbPath !== undefined && typeof body.dbPath !== 'string') {
        response.status(400).json({ error: 'dbPath must be a string' });
        return;
      }

      response.json(
        importer.importFromDescent(body.dbPath === undefined ? {} : { dbPath: body.dbPath })
      );
    })
  );

  return router;
}
