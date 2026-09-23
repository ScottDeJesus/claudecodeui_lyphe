import express from 'express';

import type { CronRegistrySnapshot, CronSyncReport } from '@/shared/types.js';

/**
 * The schedules lane's routes: the registry as the Schedules tab reads it, and the one button
 * that makes it re-read the box.
 *
 * AUTH IS THE MOUNT'S, in `server/index.ts` — `app.use('/api/schedules', authenticateToken, …)` —
 * and not this router's. Every handler here answers only a caller who already holds a session,
 * because the guard that decides that is applied where the mount is declared, so no route in this
 * lane can be reached without it and a second route package added here cannot forget it.
 *
 * Transport only, then: the read handler converts the one thing the transport knows and the
 * service cannot work out for itself — WHICH authenticated user is asking — into the typed
 * `userId` the read service takes, and hands the answer straight back. The two sources, the
 * mapping and the empty-registry case all belong to the service; a route that mapped rows would be
 * a second place for the contract to be read from.
 *
 * The sync handler is the same shape and holds no rules at all: it starts the module's own sync
 * and returns the report. A cron line and this button are the two ways the same run begins, and
 * neither of them decides anything here — which is why there is no file, no query and no command
 * in this file, only two calls into services that own their own work.
 */

/** What this router needs from its module: the read, the sync, and nothing else. */
export type SchedulesRouterDependencies = {
  readRegistry: (userId: number) => CronRegistrySnapshot;
  runSync: () => Promise<CronSyncReport>;
};

/**
 * The authenticated user's id, or `null` for a request no guard ran on.
 *
 * `authenticateToken` sets `request.user` before any handler in this lane sees the request. A
 * missing one is therefore not an anonymous reader to be served a default — it is a mount that
 * lost its guard, and the honest answer to that is a refusal rather than one person's registry
 * handed to whoever asked.
 */
function readUserId(request: express.Request): number | null {
  const candidate = (request as express.Request & { user?: { id?: number | string } }).user?.id;
  const userId = Number(candidate);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export function createSchedulesRouter(dependencies: SchedulesRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/', (request, response) => {
    const userId = readUserId(request);

    if (userId === null) {
      response.status(401).json({ error: 'No authenticated user on this request' });
      return;
    }

    try {
      response.json(dependencies.readRegistry(userId));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * Re-read the box and answer with what that run did.
   *
   * A sync that failed is still a SYNC, and its report is a body: `{ ok: false, error }` is how
   * the screen learns the last run went wrong, so a report is returned as it stands rather than
   * turned into a status code here. The 500 covers the one case the service says cannot happen —
   * a throw out of `runSync` — because a caller must never be left without an answer, even if a
   * later change makes that promise untrue.
   */
  router.post('/sync', async (_request, response) => {
    try {
      response.json(await dependencies.runSync());
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
