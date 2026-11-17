import { createReadStream } from 'node:fs';

import express from 'express';
import type { Request, Response, Router } from 'express';

import { AppError, SESSION_ID_PATTERN, asyncHandler, createApiSuccessResponse, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import type { SessionPanelService } from './session-panel.service.js';

/**
 * The session panel's reader door: three reads, created by `session-panel.module.ts` for the server entrypoint's mount at
 * `/api/session-panel`, behind `authenticateToken`. The person only reads here; what is on a panel is the chat's to change, with
 * its own command at the other door.
 *
 * ONLY THE ACCOUNT'S OWN. `GET /` answers the versions of the chat the query names where the row's account is the caller's: a
 * chat of another account answers an empty list, which is also what an empty panel answers, so the door does not confirm that a
 * chat exists. `GET /versions/:id` answers one version whole, and `GET /versions/:id/picture` streams its picture file; an id
 * that is another account's is the service's 404. The chat credential is refused here (`authenticateToken` reads a user's JWT).
 */

/** A version id from a path: a positive safe integer, or the 400 that says so. */
function readVersionId(request: Request): number {
  const value = readPathParam(request.params.id, 'id');
  const id = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id)) {
    throw new AppError('A version id is a positive whole number.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
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

/** Creates the reader door's router for `session-panel.module.ts`. Each handler is one service read and its shape. */
export function createSessionPanelRoutes(service: SessionPanelService): Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(createApiSuccessResponse(service.listForUser(readAuthenticatedUserId(request), readSessionQuery(request))));
    }),
  );

  router.get(
    '/versions/:id',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(createApiSuccessResponse(service.getForUser(readAuthenticatedUserId(request), readVersionId(request))));
    }),
  );

  router.get(
    '/versions/:id/picture',
    asyncHandler(async (request: Request, response: Response) => {
      const file = service.pictureFileForUser(readAuthenticatedUserId(request), readVersionId(request));
      response.setHeader('Content-Type', file.contentType);
      response.setHeader('Content-Length', String(file.size));
      // The picture is one the reader's own chat chose; it is still never run as a page: an SVG opened by its address would be.
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = createReadStream(file.path);
      stream.on('error', (error) => {
        console.error(`[SessionPanel] could not stream a picture: ${error.message}`);
        if (!response.headersSent) response.status(500).end();
        else response.destroy();
      });
      stream.pipe(response);
    }),
  );

  return router;
}
