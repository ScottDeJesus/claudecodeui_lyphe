import type { NextFunction, Request, Response } from 'express';

import { sessionsDb } from '@/modules/database/index.js';
import { AppError, SESSION_ID_PATTERN } from '@/shared/utils.js';

import { chatCredentialMatches } from './chat-commands.credential.js';

/**
 * The guard in front of every door that a chat's own shell commands call — `/api/toolsets-cmd`,
 * `/api/notes-cmd` and `/api/followups-cmd` — and the one place a chat credential is read.
 *
 * The CLI holds no user token, so what it presents is the chat's own credential
 * (`chatCredential`), checked here against the chat the body's `claudeSessionId` names. A pass puts
 * that chat's APP session id in `response.locals`, and the route behind it reads it back through
 * `chatAppSessionOf`, so no route trusts the body for who is asking.
 */

/** Where the guard leaves the chat's app session id for the route behind it. */
const APP_SESSION_LOCAL = 'chatAppSessionId';

/** The bearer a request claims, or null. Case-insensitive on the scheme, as HTTP requires. */
function readBearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match === null ? null : match[1].trim();
}

/**
 * The command doors' one question: does this bearer belong to the Claude chat that session id names?
 * Answers the chat's APP session id, or null for every miss alike — an id no chat carries, a chat
 * that is not Claude's, a missing or wrong credential — so the caller cannot tell them apart and
 * neither can the CLI's model. The id the CLI holds is a Claude id (`CLAUDE_CODE_SESSION_ID`), which
 * the sessions table maps back to the app's.
 */
function appSessionForCredential(claudeSessionId: unknown, bearer: string | null): string | null {
  if (bearer === null || typeof claudeSessionId !== 'string' || !SESSION_ID_PATTERN.test(claudeSessionId)) {
    return null;
  }

  const row = sessionsDb.getSessionById(sessionsDb.resolveAppSessionId(claudeSessionId));
  if (!row || row.provider !== 'claude') return null;

  return chatCredentialMatches(row.session_id, bearer) ? row.session_id : null;
}

/**
 * Express middleware, to be the FIRST of its router so no path of it can skip it. One answer for an
 * unknown session and a wrong credential alike: 401 `CHAT_CREDENTIAL_REFUSED`.
 * Consumed by `toolsets.routes.ts`, `notes.command-routes.ts` and `followups.command-routes.ts`, the command doors.
 */
export function chatCredentialGuard(request: Request, response: Response, next: NextFunction): void {
  try {
    const appSessionId = appSessionForCredential(request.body?.claudeSessionId, readBearer(request));
    if (appSessionId === null) {
      next(
        new AppError('This credential does not belong to a CloudCLI chat with that session id.', {
          code: 'CHAT_CREDENTIAL_REFUSED',
          statusCode: 401,
        }),
      );
      return;
    }
    response.locals[APP_SESSION_LOCAL] = appSessionId;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * The app session id of the chat whose credential `chatCredentialGuard` accepted. Only meaningful
 * behind that guard; a route mounted without it gets an empty answer and its own 500.
 * Consumed by `toolsets.routes.ts`, `notes.command-routes.ts` and `followups.command-routes.ts`.
 */
export function chatAppSessionOf(response: Response): string {
  const appSessionId: unknown = response.locals[APP_SESSION_LOCAL];
  if (typeof appSessionId !== 'string') {
    throw new Error('chatAppSessionOf was read on a route that is not behind chatCredentialGuard.');
  }
  return appSessionId;
}
