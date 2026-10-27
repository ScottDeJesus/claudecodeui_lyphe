import express from 'express';
import type { Request, Response, Router } from 'express';

import { asyncHandler, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import { DRAFT_TEXT_MAX, MESSAGE_TEXT_MAX, inputInvalid, readBodyObject, readBodyText, readClientId, requireClientId } from './companion-input.js';
import { type CompanionSettingsPatch } from './companion-settings.js';
import type { CompanionService } from './companion.service.js';

/**
 * Her door for the page: every route of the companion's table except `POST /draft/send`, which lands with its verb.
 * Mounted at `/api/companion` behind `authenticateToken` by the server entrypoint.
 *
 * ONLY TRANSPORT. A route here reads who is asking (`req.user`, which is her account) and which page (the
 * `x-companion-client` header), checks the SHAPE of what came (a body that is an object, a `text` of 1 to 8000
 * characters, an id that is a whole number), calls one service verb and answers. What a verb means — the
 * floor, the settings' limits, the draft that must be held — is the service's, and a refusal is the app's own
 * `AppError` envelope: `{ success: false, error: { code, message } }`, the 400 always `COMPANION_INPUT_INVALID`
 * with a sentence that names the field and its limit.
 *
 * AN ANSWER IS THE THING ITSELF, not wrapped: `GET /` answers the picture, `PUT /settings` the settings and
 * `PUT /draft` the draft, so a page folds them straight into what it holds. A write that has nothing to
 * say answers 204.
 */

/** A note's id from the path: a positive whole number, or the 400 that says so. */
function readNoteId(request: Request): number {
  const raw = readPathParam(request.params.id, 'id');
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw inputInvalid('id must be a whole number of 1 or more.', 'id');
  return Number(raw);
}

/** Consumed by `companion.module.ts`, which hands it the service. */
export function createCompanionRoutes(service: CompanionService): Router {
  const router = express.Router();

  // A page reads her whole picture; the client id is validated though unused, so a broken header is heard of on the first read.
  router.get(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      response.json(await service.picture(readAuthenticatedUserId(request)));
    }),
  );

  router.post(
    '/messages',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const client = requireClientId(request);
      const text = readBodyText(readBodyObject(request), 'text', MESSAGE_TEXT_MAX);
      service.sendText(userId, client, text);
      // Accepted, not answered: her sentences come back as frames on the page's socket.
      response.status(202).json({ accepted: true });
    }),
  );

  // The panel opened here: this page is the one she acts on.
  router.post(
    '/floor',
    asyncHandler(async (request: Request, response: Response) => {
      service.takeFloor(readAuthenticatedUserId(request), requireClientId(request));
      response.status(204).end();
    }),
  );

  router.put(
    '/settings',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      // The body is a partial of her settings, typed as one and checked as untyped all the same: the settings' own
      // save refuses a key that is not a setting and a value past its limit, naming the field.
      const patch = readBodyObject(request) as CompanionSettingsPatch;
      response.json(await service.saveSettings(readAuthenticatedUserId(request), patch));
    }),
  );

  router.put(
    '/draft',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      const userId = readAuthenticatedUserId(request);
      response.json(service.editDraft(userId, readBodyText(readBodyObject(request), 'text', DRAFT_TEXT_MAX)));
    }),
  );

  router.delete(
    '/draft',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      service.clearDraft(readAuthenticatedUserId(request));
      response.status(204).end();
    }),
  );

  router.delete(
    '/notes/:id',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      service.dismissNote(readAuthenticatedUserId(request), readNoteId(request));
      response.status(204).end();
    }),
  );

  router.post(
    '/interrupt',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      await service.interrupt(readAuthenticatedUserId(request));
      response.status(204).end();
    }),
  );

  router.post(
    '/clear',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      await service.clear(readAuthenticatedUserId(request));
      response.status(204).end();
    }),
  );

  return router;
}
