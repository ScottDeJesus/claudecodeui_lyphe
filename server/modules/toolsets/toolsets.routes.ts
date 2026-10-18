import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';

import { AppError, parseSessionId } from '@/shared/utils.js';

import { toolsetsService } from './toolsets.service.js';

/**
 * Tool sets' two doors, each route a parse, one service verb and an answer.
 *
 * Every refusal is handed to `next`, which is how the global handler turns an `AppError` into the
 * app's envelope (`{ success: false, error: { code, message, details } }`). Neither door takes a
 * server config: a caller names a set, and the box file is the only place one is defined.
 */

/** The bearer a request claims, or null. Case-insensitive on the scheme, as HTTP requires. */
function readBearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match === null ? null : match[1].trim();
}

/**
 * The command door's guard, the FIRST middleware of its router so no path of it can skip it.
 *
 * The CLI holds no user token, so the credential is the chat's own (`toolsetCredential`), checked by
 * the service against the chat the body's `claudeSessionId` names. One answer for an unknown
 * session and a wrong credential alike. A pass puts the chat's app session id in
 * `res.locals.toolsetAppSessionId` for the route behind it, so the route never trusts the body for it.
 */
function toolsetCommandGuard(request: Request, response: Response, next: NextFunction): void {
  try {
    const appSessionId = toolsetsService.appSessionForCredential(request.body?.claudeSessionId, readBearer(request));
    if (appSessionId === null) {
      next(
        new AppError('This credential does not belong to a CloudCLI chat with that session id.', {
          code: 'TOOLSET_CREDENTIAL_REFUSED',
          statusCode: 401,
        }),
      );
      return;
    }
    response.locals.toolsetAppSessionId = appSessionId;
    next();
  } catch (error) {
    next(error);
  }
}

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
 * holds no user token, and the guard below, this router's first middleware, checks a credential
 * derived from the chat. `POST /` takes `{ claudeSessionId, action: 'list' | 'on' | 'off', set? }`.
 */
export function createToolsetsCommandRouter(): Router {
  const router = express.Router();

  router.use(toolsetCommandGuard);

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const action: unknown = req.body?.action;
      if (action !== 'list' && action !== 'on' && action !== 'off') {
        throw new AppError('The action must be "list", "on" or "off".', {
          code: 'TOOLSET_ACTION_INVALID',
          statusCode: 400,
        });
      }

      const appSessionId = res.locals.toolsetAppSessionId as string;
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
