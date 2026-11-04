import express from 'express';
import type { Request, Response, Router } from 'express';

import type { NoteInput, SaveOrder } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import type { NotesService } from './notes.service.js';

/**
 * The notes lane's four routes, created by `notes.module.ts` for the server entrypoint's one mount
 * at `/api/notes`.
 *
 * WHAT A ROUTE DECIDES HERE, AND WHAT IT DOES NOT. These handlers decide transport SHAPE: that the
 * caller is an account, that `title` and a present `description` are strings, that `:id` is a
 * path parameter, and that a create's `Idempotency-Key` header, when there is one, is shaped like a
 * key. They decide nothing about the text itself — a blank title and an over-long one are
 * the service's refusals, because the length that matters is the length of the text as STORED, and
 * only the service normalises. So every handler is three lines: read, call one verb, answer.
 *
 * A REFUSAL IS THE APP'S OWN ENVELOPE. Every failure below is an `AppError`, which the entrypoint's
 * error middleware turns into `{ success: false, error: { code, message } }` with the status it
 * carries — `TITLE_REQUIRED` and `DESCRIPTION_TOO_LONG` as 400, `NOTE_NOT_FOUND` as 404,
 * `USER_REQUIRED` as 401. Nothing here shapes an error by hand.
 */

/**
 * The draft a write carries, as the service takes it.
 *
 * `description` is OPTIONAL ON THE WIRE and is read as the empty string when the key is absent, so a
 * caller that only has a title does not have to send one. A key that IS there and is not a string is
 * refused rather than coerced: a number or an object under `description` is a client bug, and
 * guessing at `String(value)` would store `[object Object]` in a person's note.
 *
 * Consumed by `notes.command-routes.ts`, whose `add` takes the same two fields off its own body.
 */
export function readNoteInput(body: unknown): NoteInput {
  const source = (body ?? {}) as Record<string, unknown>;

  if (typeof source.title !== 'string') {
    throw new AppError('title must be a string.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  if (source.description !== undefined && typeof source.description !== 'string') {
    throw new AppError('description must be a string.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }

  return { title: source.title, description: source.description ?? '' };
}

/**
 * The header a create carries its idempotency key in, and the shape a key must have: 16 to 128 characters of
 * letters, digits, `_` and `-`. The tab mints 32 hex characters; the shape only has to keep a key from being
 * a body, a log line or a second header folded in with `, `.
 */
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const IDEMPOTENCY_KEY_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * The create's idempotency key, or `null` when the request sent none (every caller before the tab's
 * autosave, and any script). A header that IS there and is not a key is refused rather than ignored: a
 * caller that meant to be idempotent and was silently not would make the duplicate this exists to prevent.
 */
function readIdempotencyKey(request: Request): string | null {
  const value = request.get(IDEMPOTENCY_KEY_HEADER);
  if (value === undefined) return null;
  if (!IDEMPOTENCY_KEY_SHAPE.test(value)) {
    throw new AppError('Idempotency-Key must be 16 to 128 letters, digits, "_" or "-".', {
      code: 'INVALID_IDEMPOTENCY_KEY',
      statusCode: 400,
    });
  }
  return value;
}

/**
 * The header a write carries its save order in — `<writer>:<seq>`, the writer 16 to 128 characters of letters,
 * digits, `_` and `-` (the tab mints 32 hex) and the seq a whole number from 1 — and the shape it must have.
 */
const SAVE_ORDER_HEADER = 'save-order';
const SAVE_ORDER_SHAPE = /^([A-Za-z0-9_-]{16,128}):([1-9][0-9]{0,14})$/;

/**
 * The write's save order, or `null` when it sent none (the notes command, a script, a tab from before the
 * header): such a write always applies. A header that IS there and is not an order is refused rather than
 * ignored — a caller that meant to be ordered and silently was not could write an older text over a newer one.
 */
function readSaveOrder(request: Request): SaveOrder | null {
  const value = request.get(SAVE_ORDER_HEADER);
  if (value === undefined) return null;
  const match = SAVE_ORDER_SHAPE.exec(value);
  if (!match) {
    throw new AppError('Save-Order must be "<writer>:<seq>": a writer of 16 to 128 letters, digits, "_" or "-", and a whole number from 1.', {
      code: 'INVALID_SAVE_ORDER',
      statusCode: 400,
    });
  }
  return { writer: match[1], seq: Number(match[2]) };
}

/** Creates the lane's router for `notes.module.ts`. Each handler is one service verb and its shape. */
export function createNotesRoutes(service: NotesService): Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(createApiSuccessResponse(service.list(readAuthenticatedUserId(request))));
    })
  );

  router.post(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      const note = service.create(
        readAuthenticatedUserId(request),
        readNoteInput(request.body),
        readIdempotencyKey(request),
        readSaveOrder(request)
      );
      // 201 for a repeated key too: the answer is the note that key made, as it stands.
      response.status(201).json(createApiSuccessResponse(note));
    })
  );

  router.put(
    '/:id',
    asyncHandler(async (request: Request, response: Response) => {
      const id = readPathParam(request.params.id, 'id');
      const note = service.update(readAuthenticatedUserId(request), id, readNoteInput(request.body), readSaveOrder(request));
      response.json(createApiSuccessResponse(note));
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (request: Request, response: Response) => {
      service.remove(readAuthenticatedUserId(request), readPathParam(request.params.id, 'id'));
      response.json(createApiSuccessResponse({ deleted: true }));
    })
  );

  return router;
}
