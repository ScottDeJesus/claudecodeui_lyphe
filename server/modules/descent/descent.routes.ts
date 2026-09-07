import express from 'express';
import type { NextFunction, Response } from 'express';

import { DescentUnreachable, type createDescentService } from './descent.service.js';

/**
 * Runs one Descent WRITE and answers with Descent's own status and body.
 *
 * The only thing this proxy substitutes is the case where Descent gave no
 * verdict at all: then the answer is a 503 carrying the one-word reason and
 * nothing else — no Descent body, no URL, no path.
 */
async function sendDescentWrite(
  response: Response,
  next: NextFunction,
  runWrite: () => Promise<{ status: number; body: unknown }>,
): Promise<void> {
  try {
    const result = await runWrite();
    response.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof DescentUnreachable) {
      response.status(503).json({ reachable: false, reason: error.reason });
      return;
    }
    next(error);
  }
}

/**
 * Creates the thin Descent proxy routes for `descent.module.ts`.
 *
 * Reads answer 200 whatever Descent's state is: an unknown account picture is a
 * fact the client renders as em-dashes, not an error wall (Descent GOTCHAS
 * #176). Every fetch, timeout and mapping belongs to the service.
 */
export function createDescentRouter(
  descentService: ReturnType<typeof createDescentService>,
): express.Router {
  const router = express.Router();

  router.get('/accounts', async (_request, response, next) => {
    try {
      response.json(await descentService.accounts());
    } catch (error) {
      next(error);
    }
  });

  router.get('/usage', async (_request, response, next) => {
    try {
      response.json(await descentService.usage());
    } catch (error) {
      next(error);
    }
  });

  router.post('/accounts/switch', async (request, response, next) => {
    // A slug is a name, so only a non-empty string is one: a number, a null or a
    // blank is a malformed request here and never travels on to Descent.
    const requestedSlug = (request.body as { slug?: unknown } | undefined)?.slug;
    if (typeof requestedSlug !== 'string' || !requestedSlug.trim()) {
      response.status(422).json({ error: 'slug is required' });
      return;
    }

    await sendDescentWrite(response, next, () => descentService.switchAccount(requestedSlug.trim()));
  });

  router.post('/accounts/capture', async (_request, response, next) => {
    await sendDescentWrite(response, next, () => descentService.capture());
  });

  return router;
}
