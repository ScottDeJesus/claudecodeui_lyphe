import express from 'express';

import type { createDeepseekService } from './deepseek.service.js';

/**
 * Creates the thin DeepSeek balance route for `deepseek.module.ts`.
 *
 * One read, always 200. A key this host does not hold, a key the vendor refused, a timeout and an
 * unreadable body are five facts the client draws as one calm em-dash with its own words under
 * the account row — an error wall there would be an alarm about money the person reading it can
 * do nothing about from this screen. Every fetch, timeout and parse belongs to the service.
 */
export function createDeepseekRouter(
  deepseekService: ReturnType<typeof createDeepseekService>,
): express.Router {
  const router = express.Router();

  router.get('/balance', async (_request, response, next) => {
    try {
      response.json(await deepseekService.balance());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
