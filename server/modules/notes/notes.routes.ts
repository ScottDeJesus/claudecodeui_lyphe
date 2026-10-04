import express from 'express';
import type { Request, Response, Router } from 'express';

import type { NoteInput } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse, readPathParam } from '@/shared/utils.js';

import type { NotesService } from './notes.service.js';

/**
 * The notes lane's four routes, created by `notes.module.ts` for the server entrypoint's one mount
 * at `/api/notes`.
 *
 * WHAT A ROUTE DECIDES HERE, AND WHAT IT DOES NOT. These handlers decide transport SHAPE: that the
 * caller is an account, that `title` and a present `description` are strings, and that `:id` is a
 * path parameter. They decide nothing about the text itself — a blank title and an over-long one are
 * the service's refusals, because the length that matters is the length of the text as STORED, and
 * only the service normalises. So every handler is three lines: read, call one verb, answer.
 *
 * A REFUSAL IS THE APP'S OWN ENVELOPE. Every failure below is an `AppError`, which the entrypoint's
 * error middleware turns into `{ success: false, error: { code, message } }` with the status it
 * carries — `TITLE_REQUIRED` and `DESCRIPTION_TOO_LONG` as 400, `NOTE_NOT_FOUND` as 404,
 * `USER_REQUIRED` as 401. Nothing here shapes an error by hand.
 */

type AuthenticatedRequest = Request & { user?: { id?: number | string } };

/**
 * The account this request acts for. Its SHAPE is `scheduled-messages.routes.ts`'s — a module-local
 * reader that throws the app's own 401 `USER_REQUIRED` — but it REFUSES where that one coerces, and
 * the difference is deliberate: `Number()` answers `0` for a `null`, an empty string or an empty
 * array, so a caller that coerced would quietly act for account 0, and a note written to the wrong
 * account is worse than a note not written.
 *
 * `authenticateToken` is mounted ahead of every handler here and sets `request.user` to the account
 * row, whose `id` is the table's own positive integer — so this refuses nothing a real session can
 * send, and the strictness costs a live request nothing.
 */
function readUserId(request: Request): number {
  const userId = (request as AuthenticatedRequest).user?.id;
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    throw new AppError('Authenticated user is required.', {
      code: 'USER_REQUIRED',
      statusCode: 401,
    });
  }
  return userId;
}

/**
 * The draft a write carries, as the service takes it.
 *
 * `description` is OPTIONAL ON THE WIRE and is read as the empty string when the key is absent, so a
 * caller that only has a title does not have to send one. A key that IS there and is not a string is
 * refused rather than coerced: a number or an object under `description` is a client bug, and
 * guessing at `String(value)` would store `[object Object]` in a person's note.
 */
function readNoteInput(body: unknown): NoteInput {
  const source = (body ?? {}) as Record<string, unknown>;

  if (typeof source.title !== 'string') {
    throw new AppError('title must be a string.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  if (source.description !== undefined && typeof source.description !== 'string') {
    throw new AppError('description must be a string.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }

  return { title: source.title, description: source.description ?? '' };
}

/** Creates the lane's router for `notes.module.ts`. Each handler is one service verb and its shape. */
export function createNotesRoutes(service: NotesService): Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(createApiSuccessResponse(service.list(readUserId(request))));
    })
  );

  router.post(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      const note = service.create(readUserId(request), readNoteInput(request.body));
      response.status(201).json(createApiSuccessResponse(note));
    })
  );

  router.put(
    '/:id',
    asyncHandler(async (request: Request, response: Response) => {
      const id = readPathParam(request.params.id, 'id');
      const note = service.update(readUserId(request), id, readNoteInput(request.body));
      response.json(createApiSuccessResponse(note));
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (request: Request, response: Response) => {
      service.remove(readUserId(request), readPathParam(request.params.id, 'id'));
      response.json(createApiSuccessResponse({ deleted: true }));
    })
  );

  return router;
}
