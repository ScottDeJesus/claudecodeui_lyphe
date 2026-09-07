import express from 'express';

import type { createCliVersionService } from './cli-version.service.js';

/**
 * Creates the thin CLI-version route for `cli-version.module.ts`.
 *
 * One read, always 200: a binary that cannot be probed is a fact the client
 * renders in words ("Claude CLI version —"), not an error wall. Every spawn,
 * cache and parse belongs to the service.
 */
export function createCliVersionRouter(
  cliVersionService: ReturnType<typeof createCliVersionService>,
): express.Router {
  const router = express.Router();

  router.get('/', async (_request, response, next) => {
    try {
      response.json(await cliVersionService.report());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
