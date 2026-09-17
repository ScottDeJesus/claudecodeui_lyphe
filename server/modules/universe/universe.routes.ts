import express from 'express';

import type { UniverseMap } from '@/shared/types.js';

/**
 * The universe lane's route, and the whole of it: the map, as the crawler wrote it.
 *
 * There is deliberately no rebuild endpoint. Nothing would call one — the heads watcher is the
 * trigger, and a browser has no reason to force a crawl — while a token-reachable mutation that
 * spawns a three-minute subprocess is surface with a cost and no payer. The map is also the only
 * thing a client needs: `universe_activity` rows arrive over the socket with the `mapId` they
 * belong to, and a client holding a different one refetches THIS.
 */

export type UniverseRouterDependencies = {
  /** The held map. Never a disk read: the map service exists so a GET costs a serialization. */
  currentMap: () => UniverseMap;
};

/**
 * Auth is the mount's `authenticateToken`, in `server/index.ts` — every route here answers only a
 * caller who already holds a session, which is what keeps the estate off the open internet.
 *
 * The handler formats and does nothing else. The held map is handed straight to `res.json`: it is
 * the service's own object, this is the only place that serializes it, and a defensive clone per
 * request would buy a copy of 1.4 MB for a mutation that has no path to happen.
 */
export function createUniverseRouter(dependencies: UniverseRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/map', (_request, response) => {
    response.json(dependencies.currentMap());
  });

  return router;
}
