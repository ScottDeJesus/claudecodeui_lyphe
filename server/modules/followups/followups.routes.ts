import express from 'express';
import type { Request, Response, Router } from 'express';

import { AppError, SESSION_ID_PATTERN, asyncHandler, createApiSuccessResponse, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import type { FollowupsService } from './followups.service.js';

/**
 * The followups lane's widget door: two routes, created by `followups.module.ts` for the server entrypoint's
 * mount at `/api/followups`, behind `authenticateToken`.
 *
 * WHAT A ROUTE DECIDES HERE, AND WHAT IT DOES NOT. These handlers decide transport SHAPE: that the caller is an
 * account, that `session` is an id-shaped query value, that `:id` is a positive integer and `state` is one of
 * the two words. Whether the item exists FOR THIS ACCOUNT is the service's 404.
 *
 * ONLY THE CHAT'S OWN ITEMS FOR THE ACCOUNT. `GET` answers the items of the chat the query names where the
 * row's account is the caller's — a chat of another account answers an empty list, which is also what a chat
 * with nothing filed answers, so the door does not confirm that a chat exists. The chat credential is refused
 * here as it is at `/api/notes` (`authenticateToken` reads a user's JWT, which a chat never holds).
 *
 * A REFUSAL IS THE APP'S OWN ENVELOPE: an `AppError` the entrypoint's error middleware turns into
 * `{ success: false, error: { code, message } }`.
 */

/**
 * An item id from a path or a body: a positive safe integer, or the 400 that says so. Consumed by
 * `followups.command-routes.ts`, whose `done` takes a list of the same ids.
 */
export function readFollowupId(value: unknown): number {
  const id = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new AppError('An item id is a positive whole number.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return id;
}

/** The chat the read names, as its app session id. */
function readSessionQuery(request: Request): string {
  const session: unknown = request.query.session;
  if (typeof session !== 'string' || !SESSION_ID_PATTERN.test(session)) {
    throw new AppError('session must be a chat id.', { code: 'INVALID_SESSION_ID', statusCode: 400 });
  }
  return session;
}

/** The state the PATCH asks for: `open` unticks, `done` ticks. */
function readState(body: unknown): 'open' | 'done' {
  const state = (body as { state?: unknown } | null)?.state;
  if (state !== 'open' && state !== 'done') {
    throw new AppError('state must be "open" or "done".', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return state;
}

/** Creates the widget door's router for `followups.module.ts`. Each handler is one service verb and its shape. */
export function createFollowupsRoutes(service: FollowupsService): Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(createApiSuccessResponse(service.listForUser(readAuthenticatedUserId(request), readSessionQuery(request))));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (request: Request, response: Response) => {
      const id = readFollowupId(readPathParam(request.params.id, 'id'));
      const item = service.setStateForUser(readAuthenticatedUserId(request), id, readState(request.body));
      response.json(createApiSuccessResponse(item));
    }),
  );

  return router;
}
