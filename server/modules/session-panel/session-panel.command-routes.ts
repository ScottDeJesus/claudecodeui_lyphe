import express from 'express';
import type { Request, Response, Router } from 'express';

import { accountOfChat, chatAppSessionOf, chatCredentialGuard } from '@/modules/chat-commands/index.js';
import type { SessionPanelInput, SessionPanelKind } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { SessionPanelService } from './session-panel.service.js';

/**
 * The session panel's second door, for the `panel` command a chat's CLI runs (`bin/panel.mjs`) and nothing else:
 * `POST /api/session-panel-cmd` with `{ claudeSessionId, action: 'show' | 'update' | 'clear' | 'status', ... }`.
 *
 * WHICH PANEL IS ALWAYS THE CREDENTIAL'S. The guard in front of the router resolves the chat the credential belongs to; every
 * verb reads it back with `chatAppSessionOf` and never from the body, so a chat shows on its own panel and no one else's. A
 * subagent soul launched from a chat carries the PARENT's credential beside its own session id, which the guard refuses: a soul
 * cannot put a thing on the chat's panel.
 *
 * A COMMAND AND NOT A FENCE, because a fence makes a new block in the transcript each time it is written; this addresses one
 * stable thing, changes it in place, and tells the chat whether it landed.
 *
 * THE VERBS: `show` (a kind, a title and a body), `update` (a body; the kind and the title showing are kept unless named),
 * `clear` and `status`. `show` and `update` write a row that belongs to an account, so they ask for it.
 */

const KINDS: readonly SessionPanelKind[] = ['diagram', 'picture', 'page', 'widget'];

/** The body's thing, shape-checked: `kind` one of the four or absent, `title` a string or absent, `body` a string. What each may hold is the service's. */
function readInput(body: unknown): SessionPanelInput {
  const { kind, title, body: text } = (body ?? {}) as { kind?: unknown; title?: unknown; body?: unknown };
  const kindOk = kind === undefined || kind === null || KINDS.includes(kind as SessionPanelKind);
  const titleOk = title === undefined || title === null || typeof title === 'string';
  if (!kindOk || !titleOk || typeof text !== 'string') {
    throw new AppError('A thing for the panel is { kind?: "diagram" | "picture" | "page" | "widget", title?: string, body: string }.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return { kind: (kind as SessionPanelKind | undefined) ?? null, title: (title as string | undefined) ?? null, body: text };
}

/** The account the chat shows for, or the refusal. The credential is genuine here, so the sentence may say why. */
function readChatAccount(response: Response): number {
  const userId = accountOfChat(chatAppSessionOf(response));
  if (userId === null) {
    throw new AppError('CloudCLI cannot tell which account this chat belongs to, so it cannot put anything on its panel.', {
      code: 'CHAT_ACCOUNT_UNKNOWN',
      statusCode: 403,
    });
  }
  return userId;
}

/** Creates the door's router for `session-panel.module.ts`: the credential guard first, then one route. */
export function createSessionPanelCommandRoutes(service: SessionPanelService): Router {
  const router = express.Router();

  router.use(chatCredentialGuard);

  router.post(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      const action: unknown = request.body?.action;
      const appSessionId = chatAppSessionOf(response);

      if (action === 'show') {
        response.status(201).json(createApiSuccessResponse(service.show(appSessionId, readChatAccount(response), readInput(request.body))));
      } else if (action === 'update') {
        response.status(201).json(createApiSuccessResponse(service.update(appSessionId, readChatAccount(response), readInput(request.body))));
      } else if (action === 'clear') {
        response.json(createApiSuccessResponse(service.clear(appSessionId)));
      } else if (action === 'status') {
        response.json(createApiSuccessResponse(service.status(appSessionId)));
      } else {
        throw new AppError('The action must be "show", "update", "clear" or "status".', {
          code: 'SESSION_PANEL_ACTION_INVALID',
          statusCode: 400,
        });
      }
    }),
  );

  return router;
}
