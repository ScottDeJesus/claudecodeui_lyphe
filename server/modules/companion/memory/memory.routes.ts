import express from 'express';
import type { Request, Response, Router } from 'express';

import { AppError, asyncHandler, readAuthenticatedUserId } from '@/shared/utils.js';

import { readMemoryLines } from './bank-lines.js';
import { clearMemoryFromSettings, readMemory } from './memory-settings.js';

/**
 * Her memory's three routes, mounted by `createCompanionRoutes` at `/api/companion/memory`, behind the same `authenticateToken`: two for
 * Settings > Voice > Companion's "Her memory" card and one for the station's corner. ONLY TRANSPORT: each route reads who is asking, calls one
 * verb (`memory-settings.ts`, `bank-lines.ts`) and answers.
 *
 *   GET /     the reading (`CompanionMemoryReading`): how many memories her bank holds, or `count: null` with the door's sentence as
 *             `reason` when it cannot be read (still a 200: the card draws that state), and the id of her DocSpace page.
 *   GET /lines  the same reading with each memory as a line (`CompanionMemoryLines`): kind, title, the moment he said it and his first
 *             words, newest said first. Also a 200 when `count` is null, with the sentence as `reason`: the corner draws that state.
 *   DELETE /  clears her whole memory as his act in Settings and answers `{ forgotten }`. A door that stops it is the app's own
 *             envelope, 502 `COMPANION_MEMORY_UNREACHABLE`, carrying the sentence (some may have been forgotten before it: the card reads again).
 *
 * Her bank is one package for every account and not any page's, so unlike the rest of the companion's routes these name no
 * `x-companion-client`. Consumed by `companion.routes.ts`.
 */
export function createMemoryRoutes(): Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_request: Request, response: Response) => {
      response.json(await readMemory());
    }),
  );

  router.get(
    '/lines',
    asyncHandler(async (_request: Request, response: Response) => {
      response.json(await readMemoryLines());
    }),
  );

  router.delete(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      const cleared = await clearMemoryFromSettings(readAuthenticatedUserId(request));
      if (!cleared.ok) throw new AppError(cleared.sentence, { code: 'COMPANION_MEMORY_UNREACHABLE', statusCode: 502 });
      response.json({ forgotten: cleared.forgotten });
    }),
  );

  return router;
}
