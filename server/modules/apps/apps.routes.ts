import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';

import { appsService } from './apps.service.js';

/**
 * The application registry's three routes, thin to the point of being a signature.
 *
 * Each one calls one service verb and hands anything it throws to `next`, which is how the global
 * handler at `server/index.ts:282-303` turns an `AppError` into its status. Nothing here validates,
 * nothing here touches the file, and nothing here imports `authenticateToken`: the guard rides the
 * MOUNT (`app.use('/api/apps', authenticateToken, createAppsModule())`), so a route added to this
 * file later cannot be the one that forgot it.
 *
 * There is no PATCH. Editing a row is a DELETE and a POST, or one line in the file.
 */
export function createAppsRouter(): Router {
  const router = express.Router();

  /** The registry in file order, plus the two ports that identify this app's own row. */
  router.get('/', (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(appsService.listApps());
    } catch (error) {
      next(error);
    }
  });

  /** Appends one row and answers it. `{ name, url, id? }` — the id is minted when it is absent. */
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const app = appsService.addApp(req.body);
      res.json({ app });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Removes one row by id.
   *
   * `req.params.id` is typed `string | string[]` by this express version, as it is at
   * `server/modules/projects/projects.routes.ts:96`: a repeated param is not an id, and the empty
   * string names no row, so it lands on the service's own 404 rather than being unwrapped here.
   */
  router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      appsService.removeApp(id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
