import type { Router } from 'express';

import { createNotesRoutes } from './notes.routes.js';
import { notesService } from './notes.service.js';

/**
 * Builds the notes lane's router for the server entrypoint, which mounts it at `/api/notes` behind
 * `authenticateToken`.
 *
 * There is nothing to read here: no environment, no path, no database handle. The lane's rows live in
 * the same database as everything else, reached through the repository barrel, and its frame goes to
 * the gateway's open sockets through the websocket barrel. So this composition root names the one
 * service instance and hands it over.
 *
 * It is mounted at exactly ONE address, and that is the point of the module: `/api/notes` is the only
 * door onto these rows, so there is no second router to keep in step and no guard to remember on a
 * mount somebody adds later. A mount is impossible to forget and impossible to reach by accident.
 */
export function createNotesModule(): Router {
  return createNotesRoutes(notesService);
}
