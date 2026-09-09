import type { Router } from 'express';

import { createDescentMemoryService } from './descent.memory.service.js';
import { createDescentRouter } from './descent.routes.js';
import { createDescentService } from './descent.service.js';
import { createDescentTransport } from './descent.transport.js';

/** Where Descent listens when the operator has not moved it. */
const DEFAULT_DESCENT_URL = 'http://127.0.0.1:7878';

/**
 * One Descent call's ceiling. Far under the client's 60 s account poll and 180 s
 * usage poll, so a stalled Descent costs one skipped reading rather than a
 * queue of overlapping requests.
 */
const DESCENT_TIMEOUT_MS = 4000;

/**
 * Builds the authenticated Descent proxy router for the server entrypoint —
 * both of its lanes: accounts and usage, and the memory-intake queue.
 *
 * The composition root is the only place that reads the environment or hands
 * over the real `fetch`; every service takes both as dependencies, which is what
 * lets the down paths be proven against a closed port.
 *
 * One `dependencies` object, so the two lanes can never drift onto different
 * origins or ceilings. The accounts service builds a second transport from that
 * same object; the transport is stateless and caches nothing, so the pair is two
 * views of one wire rather than two wires.
 */
export function createDescentModule(): Router {
  const dependencies = {
    baseUrl: process.env.DESCENT_URL || DEFAULT_DESCENT_URL,
    fetchImpl: fetch,
    timeoutMs: DESCENT_TIMEOUT_MS,
  };

  const transport = createDescentTransport(dependencies);
  const descentService = createDescentService(dependencies);
  const memoryService = createDescentMemoryService(transport);

  return createDescentRouter(descentService, memoryService);
}
