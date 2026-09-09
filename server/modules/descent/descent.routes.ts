import express from 'express';
import type { NextFunction, Response } from 'express';

import type { MemoryCandidateRead } from '@/shared/types.js';

import type { createDescentMemoryService } from './descent.memory.service.js';
import { DescentUnreachable, type createDescentService } from './descent.service.js';

/**
 * What a memory candidate's id may look like. Descent mints `mc-<n>`, and this
 * is deliberately narrower than "any path segment": it admits no dot, no slash
 * and no percent, so a traversal attempt is refused at the route and NEVER
 * travels — on the by-id read as well as on both writes.
 */
const MEMORY_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
 *
 * One router carries BOTH of the proxy's lanes: the accounts and usage picture,
 * and the memory-intake queue with its two review writes — where the same two
 * rules hold, a read that always answers 200 and a write that carries Descent's
 * own verdict, including the cap guard's 422.
 */
export function createDescentRouter(
  descentService: ReturnType<typeof createDescentService>,
  memoryService: ReturnType<typeof createDescentMemoryService>,
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

  router.get('/memory', async (_request, response, next) => {
    try {
      response.json(await memoryService.pending());
    } catch (error) {
      next(error);
    }
  });

  router.get('/memory/:id', async (request, response, next) => {
    // A malformed id cannot name a candidate, so the honest answer is the same
    // one an unknown id gets — and it is reached without troubling Descent. A
    // read never fails: the null IS the answer, never a 404.
    if (!MEMORY_ID.test(request.params.id)) {
      // `satisfies` so a rename in § DESCENT CONTRACTS breaks the build here
      // rather than shipping yesterday's shape past a green typecheck.
      response.json({ reachable: true, candidate: null } satisfies MemoryCandidateRead);
      return;
    }

    try {
      response.json(await memoryService.candidate(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/memory/:id/approve', async (request, response, next) => {
    // Validated BEFORE travelling, exactly as `/accounts/switch` validates its
    // slug: an id this proxy would not recognise is refused here, never sent on.
    if (!MEMORY_ID.test(request.params.id)) {
      response.status(422).json({ error: 'id is malformed' });
      return;
    }

    await sendDescentWrite(response, next, () => memoryService.approve(request.params.id));
  });

  router.post('/memory/:id/reject', async (request, response, next) => {
    if (!MEMORY_ID.test(request.params.id)) {
      response.status(422).json({ error: 'id is malformed' });
      return;
    }

    await sendDescentWrite(response, next, () => memoryService.reject(request.params.id));
  });

  return router;
}
