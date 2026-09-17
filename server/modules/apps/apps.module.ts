import express from 'express';
import type { Router } from 'express';

import { createAppsRouter } from './apps.routes.js';
import { ensureAppsFile } from './apps.store.js';

/**
 * Builds the application registry's router for the server entrypoint, which mounts it at
 * `/api/apps` behind `authenticateToken` — the shape `server/modules/kanban/kanban.module.ts` uses.
 *
 * The registry file is created HERE, once, so it exists from the first boot rather than from the
 * first `GET`. The call is wrapped and a failure is logged and swallowed on purpose: this module
 * is mounted while the server is still assembling itself, `findApplicationRoot` resolves the
 * package root under a packaged target too (`npm run desktop`, `npm run server:bundle`), and a
 * read-only root must never take down chat, files, git and everything else for the sake of a list
 * of links. The routes already answer 500 on a registry that cannot be read, which is where a
 * broken setup belongs — on the one request that needs the registry.
 *
 * The service is NOT named here: the router takes it from its own module, which is what keeps this
 * file a composition root rather than a second wiring of the same verbs.
 */
export function createAppsModule(): Router {
  try {
    ensureAppsFile();
  } catch (error) {
    console.warn(
      '[apps] could not create the application registry — the API stays up:',
      error instanceof Error ? error.message : String(error),
    );
  }

  const router = express.Router();
  router.use(createAppsRouter());

  return router;
}
