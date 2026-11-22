import express from 'express';

import type { AnalyticsService } from './analytics.service.js';

/**
 * The area's two routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * Thin on purpose: each hands what the request carried to one service call and anything thrown to
 * `next`, where the app's handler renders an `AppError` as `{ success: false, error: { code, message } }`.
 * Every judgement about the section and the window is the service's.
 */
export function createAnalyticsRouter(service: Pick<AnalyticsService, 'list' | 'read'>): express.Router {
  const router = express.Router();

  router.get('/', (_request, response, next) => {
    try {
      response.json(service.list());
    } catch (error) {
      next(error);
    }
  });

  router.get('/:section', async (request, response, next) => {
    try {
      response.json(await service.read(request.params.section, request.query.days));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
