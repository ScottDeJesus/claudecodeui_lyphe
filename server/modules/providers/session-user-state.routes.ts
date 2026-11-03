import { Router, type Request, type Response } from 'express';

import { sessionUserStateService } from '@/modules/providers/services/session-user-state.service.js';
import { AppError, asyncHandler, createApiSuccessResponse, parseSessionId } from '@/shared/utils.js';

/** The icon names the picker offers: kebab-case, bounded, and never free text. */
const SESSION_ICON_PATTERN = /^[a-z0-9-]{1,40}$/;

/** A body that is not an object carries no field to read, so the parser below rejects its own way. */
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

/** The pin's body: `{ pinned: true | false }`, and nothing else is a pin. */
const parseSessionPinnedBody = (payload: unknown): boolean => {
  const pinned = readBody(payload).pinned;

  if (typeof pinned === 'boolean') {
    return pinned;
  }

  throw new AppError('pinned must be true or false.', {
    code: 'INVALID_SESSION_PINNED',
    statusCode: 400,
  });
};

/**
 * The session attributes the sidebar owns but the session itself does not:
 * its icon and its pin.
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
  '/sessions/:sessionId/pinned',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const pinned = parseSessionPinnedBody(req.body);
    res.json(createApiSuccessResponse(sessionUserStateService.setPinnedById(sessionId, pinned)));
  }),
);
