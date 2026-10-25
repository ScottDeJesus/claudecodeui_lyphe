import express from 'express';
import type { Request, Response, Router } from 'express';

import { accountOfChat, chatAppSessionOf, chatCredentialGuard } from '@/modules/chat-commands/index.js';
import type { FollowupInput } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { readFollowupId } from './followups.routes.js';
import type { FollowupsService } from './followups.service.js';

/**
 * The followups lane's second door, for the `followups` command a chat's CLI runs (`bin/followups.mjs`) and
 * nothing else: `POST /api/followups-cmd` with `{ claudeSessionId, action: 'list' | 'add' | 'done', ... }`.
 *
 * WHICH CHAT IS ALWAYS THE CREDENTIAL'S. The guard in front of the router resolves the chat the credential
 * belongs to; every verb here reads it back with `chatAppSessionOf` and never from the body, so a chat can file
 * and close its own items and no one else's. An id of another chat is the service's 404. A subagent soul
 * launched from a chat carries the PARENT's credential beside its own session id, which the guard refuses —
 * that refusal is what keeps a soul out of the chat's list.
 *
 * THE VERBS: `list` (the open items; `all: true` adds the done ones), `add` (one or more `{ kind, text }` in a
 * single request, so a turn files everything in one call) and `done` (one or more ids). Only `add` needs to
 * know whose items they are, so only `add` asks for the account.
 */

/** The `add` body's items, shape-checked: each is `{ kind: 'next' | 'gap', text: string }`. The text rules are the service's. */
function readItems(body: unknown): FollowupInput[] {
  const items: unknown = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    throw new AppError('items must be a list of { kind, text }.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return items.map((item: unknown) => {
    const { kind, text } = (item ?? {}) as { kind?: unknown; text?: unknown };
    if ((kind !== 'next' && kind !== 'gap') || typeof text !== 'string') {
      throw new AppError('Each item is { kind: "next" | "gap", text: string }.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }
    return { kind, text };
  });
}

/** The `done` body's ids: a non-empty list of item ids. */
function readIds(body: unknown): number[] {
  const ids: unknown = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('ids must be a list of item ids.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return ids.map(readFollowupId);
}

/** The account the chat files for, or the refusal. The credential is genuine here, so the sentence may say why. */
function readChatAccount(response: Response): number {
  const userId = accountOfChat(chatAppSessionOf(response));
  if (userId === null) {
    throw new AppError('CloudCLI cannot tell which account this chat belongs to, so it cannot file anything for it.', {
      code: 'CHAT_ACCOUNT_UNKNOWN',
      statusCode: 403,
    });
  }
  return userId;
}

/** Creates the door's router for `followups.module.ts`: the credential guard first, then one route. */
export function createFollowupsCommandRoutes(service: FollowupsService): Router {
  const router = express.Router();

  router.use(chatCredentialGuard);

  router.post(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      const action: unknown = request.body?.action;
      const appSessionId = chatAppSessionOf(response);

      if (action === 'list') {
        response.json(createApiSuccessResponse(service.listForChat(appSessionId, { all: request.body?.all === true })));
      } else if (action === 'add') {
        const items = readItems(request.body);
        response.status(201).json(createApiSuccessResponse(service.add(appSessionId, readChatAccount(response), items)));
      } else if (action === 'done') {
        response.json(createApiSuccessResponse(service.closeInChat(appSessionId, readIds(request.body))));
      } else {
        throw new AppError('The action must be "list", "add" or "done".', {
          code: 'FOLLOWUPS_ACTION_INVALID',
          statusCode: 400,
        });
      }
    }),
  );

  return router;
}
