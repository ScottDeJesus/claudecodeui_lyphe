import express from 'express';
import type { Request, Response, Router } from 'express';

import { readAuthenticatedUserId } from '@/shared/utils.js';

import type { CompanionService } from '../companion.service.js';

/**
 * The station's landed route, mounted by `createCompanionRoutes` at `/api/companion/station` behind `authenticateToken`, so its
 * one door is `GET /api/companion/station/landed`. ONLY TRANSPORT: it reads who is asking, calls the companion service's `landed`
 * verb (which reads `stationLanded` with the house) and answers `{ landed }`: a `StationLanded[]` of the account's last seven days,
 * newest first, at most 300 (every landing the history kept of the week), `[]` when nothing landed. A read that throws (the history's database) is logged and answered 503
 * `{ error }` with a sentence the strip can show, so a failed read is a state the page draws and never a stack it parses.
 *
 * The history is the account's own (what the house told THIS account), so the route names the account; it is no page's, so it
 * names no `x-companion-client`. The page reads it once at mount and on reconnect, and folds each `station_landed` frame in
 * between (`station-landed-feed.ts`). Consumed by `companion.routes.ts`.
 */
export function createStationLandedRoutes(service: CompanionService): Router {
  const router = express.Router();

  router.get('/landed', async (request: Request, response: Response) => {
    const userId = readAuthenticatedUserId(request);
    try {
      response.json({ landed: await service.landed(userId) });
    } catch (error) {
      console.error(`[Station] account ${userId}: what landed could not be read`, error);
      response.status(503).json({ error: 'What landed could not be read just now.' });
    }
  });

  return router;
}
