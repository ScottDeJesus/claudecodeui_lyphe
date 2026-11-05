import { Router } from 'express';

import { restartHold } from './restart-hold.service.js';

/**
 * What the server is busy with right now, as the dev supervisor is told it: `GET /api/restart-hold` answers
 * `{ busy, reasons }`, `reasons` being the plain sentences the supervisor writes in its journal when it holds a
 * save. Mounted behind `authenticateToken` by the server entrypoint. Read-only: nothing here starts or stops anything.
 */
export function createRestartHoldRoutes(): Router {
  const router = Router();

  router.get('/', (_request, response) => {
    const reasons = restartHold.read().map((reason) => reason.why);
    response.json({ busy: reasons.length > 0, reasons });
  });

  return router;
}
