import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';

import { dividersService } from './apps.dividers.js';
import { appsService } from './apps.service.js';

/**
 * The application registry's routes, thin to the point of being a signature.
 *
 * Each one calls one service verb and hands anything it throws to `next`, which is how the global
 * handler at `server/index.ts:282-303` turns an `AppError` into its status. Nothing here validates,
 * nothing here touches the file, and nothing here imports `authenticateToken`: the guard rides the
 * MOUNT (`app.use('/api/apps', authenticateToken, createAppsModule())`), so a route added to this
 * file later cannot be the one that forgot it.
 *
 * An app row's description and a divider's title are the fields the drawer edits in place, and
 * `/:id/move` reorders any row; renaming or readdressing an app is a DELETE and a POST, or one line
 * in the file. The divider and move verbs live in `apps.dividers.ts`.
 */
export function createAppsRouter(): Router {
  const router = express.Router();

  /** The registry in file order, plus the two ports that identify this app's own row. */
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await appsService.listApps());
    } catch (error) {
      next(error);
    }
  });

  /** Appends one row and answers it. `{ name, url, description?, id? }` — the id is minted when absent. */
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const app = appsService.addApp(req.body);
      res.json({ app });
    } catch (error) {
      next(error);
    }
  });

  /** Adds a divider at the end of the list: `{ title? }`. Answers it. */
  router.post('/dividers', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ divider: dividersService.addDivider(req.body?.title) });
    } catch (error) {
      next(error);
    }
  });

  /** Sets a divider's title: `{ title }`, blank for a plain line. */
  router.patch('/dividers/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      res.json({ divider: dividersService.renameDivider(id, req.body?.title) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/dividers/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      dividersService.removeDivider(id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  /** Moves any row, app or divider, one place: `{ direction: 'up' | 'down' }`. */
  router.post('/:id/move', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      dividersService.moveRow(id, req.body?.direction);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  /** Sets or clears one row's description: `{ description }`, blank to clear. Answers the row. */
  router.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      res.json({ app: appsService.updateDescription(id, req.body?.description) });
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
