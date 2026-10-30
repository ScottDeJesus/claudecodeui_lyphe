import express from 'express';
import type { Request, Response, Router } from 'express';

import { AppError, asyncHandler, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import { readBodyFlag, readBodyObject, readBodyWholeNumberAtLeast, readClientId, readNoteIdParam } from './companion-input.js';
import type { CompanionService } from './companion.service.js';

/**
 * His two presses on what stands on his stage, as routes: the Pin on a card and the Back, Next and × of the walk. Mounted by
 * `createCompanionRoutes` at the root of `/api/companion`, behind `authenticateToken`.
 *
 *   - `PUT /notes/:id/pin`, body `{ pinned: boolean }`: 204, or 404 `COMPANION_NOTE_NOT_FOUND` for a card that is not on his panel
 *     (taken down meanwhile, or another account's id). A card already in the state asked for is a 204 too, so a press is repeatable.
 *   - `PUT /walk`, body `{ at: int ≥ 1 }`: moves the one held walk's cursor, 204, or 409 `COMPANION_WALK_REFUSED` carrying the
 *     sentence her `walk` tool refuses with (no walk held, or `at` past the last item).
 *   - `DELETE /walk`: ends the held walk, 204 whether or not one was held.
 *
 * ONLY TRANSPORT, like the routes beside it: a route reads who is asking and checks the SHAPE of what came, then calls one
 * service verb (`pinNote`, `moveWalk`, `endWalk`) and answers. The pin, the walk's move and what refuses it are the service's
 * and the store's. Each carries `x-companion-client` as her other routes do (read and validated, never used: none of these
 * takes the floor), and answers nothing: the `companion_note_pinned` and `companion_walk` frames the store sends are what
 * every page folds, so the answer is only that the write landed.
 *
 * Consumed by `companion.routes.ts`, which mounts it.
 */

/** Consumed by `companion.routes.ts`, which hands it the service. */
export function createCardsRoutes(service: CompanionService): Router {
  const router = express.Router();

  router.put(
    '/notes/:id/pin',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      const userId = readAuthenticatedUserId(request);
      const id = readNoteIdParam(readPathParam(request.params.id, 'id'));
      const pinned = readBodyFlag(readBodyObject(request), 'pinned');
      if (!service.pinNote(userId, id, pinned)) {
        throw new AppError('That card is not on your panel any more.', { code: 'COMPANION_NOTE_NOT_FOUND', statusCode: 404 });
      }
      response.status(204).end();
    }),
  );

  router.put(
    '/walk',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      const userId = readAuthenticatedUserId(request);
      // Any whole number of 1 or more reaches the service, so an item past the end is refused with the count, not as a malformed body.
      const at = readBodyWholeNumberAtLeast(readBodyObject(request), 'at', 1);
      const moved = service.moveWalk(userId, at);
      if (!moved.ok) throw new AppError(moved.sentence, { code: 'COMPANION_WALK_REFUSED', statusCode: 409 });
      response.status(204).end();
    }),
  );

  router.delete(
    '/walk',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      service.endWalk(readAuthenticatedUserId(request));
      response.status(204).end();
    }),
  );

  return router;
}
