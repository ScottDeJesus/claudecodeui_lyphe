import { Router, type Request, type Response } from 'express';

import { sessionUserStateService } from '@/modules/providers/services/session-user-state.service.js';
import { AppError, asyncHandler, createApiSuccessResponse, parseSessionId } from '@/shared/utils.js';

/** The icon names the picker offers: kebab-case, bounded, and never free text. */
const SESSION_ICON_PATTERN = /^[a-z0-9-]{1,40}$/;

/** A body that is not an object carries no field to read, so each parser below rejects its own way. */
const readBody = (payload: unknown): Record<string, unknown> =>
  payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

const parseSessionIconBody = (payload: unknown): string | null => {
  const icon = readBody(payload).icon;

  if (icon === null) {
    return null;
  }

  if (typeof icon === 'string' && SESSION_ICON_PATTERN.test(icon)) {
    return icon;
  }

  throw new AppError('icon must be null or a kebab-case name of up to 40 characters.', {
    code: 'INVALID_SESSION_ICON',
    statusCode: 400,
  });
};

/**
 * Reads the session a move places the moving session after; `null` means "to
 * the top". A malformed id is rejected here rather than in the service, so the
 * route owns the whole transport contract of the body.
 */
const parseSimpleListPositionBody = (payload: unknown, sessionId: string): string | null => {
  const afterSessionId = readBody(payload).afterSessionId;

  if (afterSessionId === null) {
    return null;
  }

  if (typeof afterSessionId === 'string' && afterSessionId !== sessionId) {
    try {
      return parseSessionId(afterSessionId);
    } catch {
      // A malformed id is not a usable position: it falls through to the same
      // 400 as any other unusable value, rather than leaking the id parser's code.
    }
  }

  throw new AppError('afterSessionId must be null or the id of another session.', {
    code: 'INVALID_SIMPLE_LIST_POSITION',
    statusCode: 400,
  });
};

/**
 * The session attributes the sidebar owns but the session itself does not:
 * its icon and its manual place in the simple list.
 *
 * Split from `provider.routes.ts` so that file keeps shrinking; mounted by it
 * with `router.use(sessionUserStateRoutes)`.
 */
export const sessionUserStateRoutes = Router();

sessionUserStateRoutes.put(
  '/sessions/:sessionId/icon',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const icon = parseSessionIconBody(req.body);
    res.json(createApiSuccessResponse(sessionUserStateService.setIconById(sessionId, icon)));
  }),
);

sessionUserStateRoutes.put(
  '/sessions/:sessionId/simple-list-position',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const afterSessionId = parseSimpleListPositionBody(req.body, sessionId);
    res.json(
      createApiSuccessResponse(sessionUserStateService.moveInSimpleListById(sessionId, afterSessionId)),
    );
  }),
);
