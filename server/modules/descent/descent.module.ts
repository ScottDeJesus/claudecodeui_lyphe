import type { Router } from 'express';

import { createDescentRouter } from './descent.routes.js';
import { createDescentService } from './descent.service.js';

/** Where Descent listens when the operator has not moved it. */
const DEFAULT_DESCENT_URL = 'http://127.0.0.1:7878';

/**
 * One Descent call's ceiling. Far under the client's 60 s account poll and 180 s
 * usage poll, so a stalled Descent costs one skipped reading rather than a
 * queue of overlapping requests.
 */
const DESCENT_TIMEOUT_MS = 4000;

/**
 * Builds the authenticated Descent proxy router for the server entrypoint.
 *
 * The composition root is the only place that reads the environment or hands
 * over the real `fetch`; the service itself takes both as dependencies, which is
 * what lets the down path be proven against a closed port.
 */
export function createDescentModule(): Router {
  const descentService = createDescentService({
    baseUrl: process.env.DESCENT_URL || DEFAULT_DESCENT_URL,
    fetchImpl: fetch,
    timeoutMs: DESCENT_TIMEOUT_MS,
  });

  return createDescentRouter(descentService);
}
