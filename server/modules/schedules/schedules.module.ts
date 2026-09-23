import type { Router } from 'express';

import { createSchedulesRouter } from './schedules.routes.js';
import { readRegistry } from './schedules-read.service.js';
import * as schedulesSync from './schedules-sync.service.js';

/**
 * The schedules lane, composed: one read service and one sync behind one thin router.
 *
 * There is no `start()` and no `stop()`, and that absence is the design rather than an unfinished
 * module. Nothing here holds state and nothing here runs on a cadence — the registry is read when a
 * client asks for it, off tables the sync writes elsewhere, and the sync itself runs when the box's
 * own cron line or the Refresh button calls for it — so there is no background work to begin or to
 * end. That is exactly what lets the entrypoint mount this inline, next to kanban, instead of
 * holding it in a variable the way it holds the lanes whose polls must be started after `listen`
 * and stopped on shutdown.
 *
 * The read is handed over as the function itself, not wrapped: `readRegistry` takes the `userId`
 * the route resolves, so the two fit together without an adapter in between. The sync arrives as
 * its module rather than as a loose function, because it is one half of this lane's behaviour and
 * the route is handed the function that half exposes.
 */
export function createSchedulesModule(): Router {
  return createSchedulesRouter({
    readRegistry,
    runSync: schedulesSync.runSync,
  });
}
