import express from 'express';
import type { Request, Response, Router } from 'express';

import { accountOfChat, chatAppSessionOf, chatCredentialGuard } from '@/modules/chat-commands/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { readNoteInput } from './notes.routes.js';
import type { NotesService } from './notes.service.js';

/**
 * The notes lane's second door, for the `notes` command a chat's CLI runs (`bin/notes.mjs`) and
 * nothing else: `POST /api/notes-cmd` with `{ claudeSessionId, action: 'list' | 'show' | 'add', ... }`.
 *
 * WHAT IT IS, AND WHAT IT IS NOT. It is the tab's door with a different way of saying who is asking:
 * the tab's routes get an account from the operator's login (`authenticateToken`), this one gets it from
 * the chat's own credential. Past that point the two are the SAME CODE — every verb here is one call on the
 * `NotesService` the tab's routes call, so a title is required and 200 characters at most, a description is
 * 20,000, and a note added here sends the same `notes_changed` frame, which an open Notes tab answers by
 * reading the list again. The tab's own mount (`/api/notes`) is unchanged and still refuses a chat
 * credential.
 *
 * THE VERBS ARE THE SMALLEST SET A CHAT SHOULD HAVE: read the list, read one, add one. There is no edit
 * and no delete on this door, so a model cannot rewrite or throw away a note; those stay the operator's,
 * in the tab.
 */

/**
 * The account the chat acts for, or the refusal. The credential is genuine at this point (the guard
 * passed it), so this answer does not hide anything from a stranger — it tells the chat's own command
 * why it has no notes to reach.
 */
function readChatAccount(response: Response): number {
  const userId = accountOfChat(chatAppSessionOf(response));
  if (userId === null) {
    throw new AppError('CloudCLI cannot tell which account this chat belongs to, so it cannot reach any notes for it.', {
      code: 'CHAT_ACCOUNT_UNKNOWN',
      statusCode: 403,
    });
  }
  return userId;
}

/** The note id a `show` names. A string is all the shape asks for: an id that is not a note's is the service's 404. */
function readNoteId(body: unknown): string {
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new AppError('id must be a non-empty string.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return id.trim();
}

/** Creates the door's router for `notes.module.ts`: the credential guard first, then one route. */
export function createNotesCommandRoutes(service: NotesService): Router {
  const router = express.Router();

  router.use(chatCredentialGuard);

  router.post(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      const action: unknown = request.body?.action;
      const userId = readChatAccount(response);

      if (action === 'list') {
        response.json(createApiSuccessResponse(service.list(userId)));
      } else if (action === 'show') {
        response.json(createApiSuccessResponse(service.get(userId, readNoteId(request.body))));
      } else if (action === 'add') {
        response.status(201).json(createApiSuccessResponse(service.create(userId, readNoteInput(request.body))));
      } else {
        throw new AppError('The action must be "list", "show" or "add".', {
          code: 'NOTES_ACTION_INVALID',
          statusCode: 400,
        });
      }
    })
  );

  return router;
}
