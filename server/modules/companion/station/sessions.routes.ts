import express from 'express';
import type { Request, Response, Router } from 'express';

import { stationSessions } from './station-sessions.js';

/**
 * The station's sessions route, mounted by `createCompanionRoutes` at `/api/companion/station/sessions` behind `authenticateToken`.
 * ONLY TRANSPORT: `GET /` calls `stationSessions()` and answers `{ sessions }` (a `StationSession[]`, `[]` when he has no chat).
 * A read that throws (the database, the approvals gateway) is logged and answered 503 `{ error }` with a sentence the page's
 * banner can show, so a failed read is a state the rail draws and never a stack the page parses.
 *
 * Chats belong to no account, as the sidebar's do, so the route names no user, and it is no page's, so it names no
 * `x-companion-client`. The page reads it again on every `station_sessions_changed` hint and on reconnect
 * (`station-hint.ts` is the one detector of a chat changing). Consumed by `companion.routes.ts`.
 */
export function createStationSessionsRoutes(): Router {
  const router = express.Router();

  router.get('/', (_request: Request, response: Response) => {
    try {
      response.json({ sessions: stationSessions() });
    } catch (error) {
      console.error("[Companion] the station's sessions could not be read", error);
      response.status(503).json({ error: 'Your chats could not be read just now.' });
    }
  });

  return router;
}
