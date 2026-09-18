import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { placeAttachmentBytes } from '../kanban-import-satellites.js';
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
 * THE BYTES ARE PLACED HERE, between the write and the answer — the one line this route owns that a
 * response alone could not deliver. The import's rows commit in one transaction and its attachment
 * bytes are nine megabytes of I/O that must not run under that transaction's lock, so the service
 * hands them out on the result as an obligation; the door that answers the operator discharges it,
 * and only then says the corpus is in. A client told "imported" while the files were still being
 * written could be told so by a server that then died — `KanbanImportResult.attachmentCopies` and
 * `placeAttachmentBytes` carry the reasoning.
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

      // `attachmentCopies` is destructured OUT of the answer: the obligation it carries is
      // discharged on the next line, and the paths it holds are the install's own on-disk layout —
      // which, by the rule that keeps a route path out of a data type, does not belong on the wire.
      const { attachmentCopies, ...result } = importer.importFromDescent(
        body.dbPath === undefined ? {} : { dbPath: body.dbPath }
      );
      // Synchronous and idempotent, and it never throws: a missing source file is a line in the
      // server log, never a failed import. See the header for why it is not the service's.
      placeAttachmentBytes(attachmentCopies);

      response.json(result);
    })
  );

  return router;
}
