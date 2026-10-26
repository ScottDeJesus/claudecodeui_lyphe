import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';

import { chatAppSessionOf, chatCredentialGuard } from '@/modules/chat-commands/index.js';
import { AppError, parseSessionId } from '@/shared/utils.js';

import { toolsetsService } from './toolsets.service.js';

/**
 * Tool sets' two doors, each route a parse, one service verb and an answer.
 *
 * Every refusal is handed to `next`, which is how the global handler turns an `AppError` into the
 * app's envelope (`{ success: false, error: { code, message, details } }`). Neither door takes a
 * server config: a caller names a set, and the box file is the only place one is defined.
 */

/**
 * The operator's door, mounted at `/api/toolsets` behind `authenticateToken`: one chat's view, and
 * a switch of one set by name. The session id is the app's.
 */
export function createToolsetsUserRouter(): Router {
  const router = express.Router();

  router.get('/sessions/:sessionId', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: toolsetsService.view(parseSessionId(req.params.sessionId)) });
    } catch (error) {
      next(error);
    }
  });

  router.put('/sessions/:sessionId/sets/:set', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = parseSessionId(req.params.sessionId);
      const on: unknown = req.body?.on;
      if (typeof on !== 'boolean') {
        throw new AppError('The body must be { "on": true } or { "on": false }.', {
          code: 'TOOLSET_BODY_INVALID',
          statusCode: 400,
        });
      }
      // A repeated param is not a name; the empty string lands on the service's own 400.
      const set = typeof req.params.set === 'string' ? req.params.set : '';
      res.json({ success: true, data: await toolsetsService.switchSet(sessionId, set, on) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * The CLI's door, mounted at `/api/toolsets-cmd` with no `authenticateToken`: the `toolset` command
 * holds no user token, and the chat-credential guard (`chat-commands`, shared with the notes door),
 * this router's first middleware, checks a credential derived from the chat.
 * `POST /` takes `{ claudeSessionId, action: 'list' | 'on' | 'off', set? }`.
 */
export function createToolsetsCommandRouter(): Router {
  const router = express.Router();

  router.use(chatCredentialGuard);

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const action: unknown = req.body?.action;
      if (action !== 'list' && action !== 'on' && action !== 'off') {
        throw new AppError('The action must be "list", "on" or "off".', {
          code: 'TOOLSET_ACTION_INVALID',
          statusCode: 400,
        });
      }

      const appSessionId = chatAppSessionOf(res);
      const data =
        action === 'list'
          ? toolsetsService.view(appSessionId)
          : await toolsetsService.switchSet(appSessionId, req.body?.set, action === 'on');
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
