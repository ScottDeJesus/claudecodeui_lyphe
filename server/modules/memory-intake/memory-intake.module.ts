import type { Router } from 'express';

import { createMemoryRoutes } from './memory.routes.js';
import { startMemorySpillSweep } from './memory-spill.service.js';
import { memoryIntakeService } from './memory.service.js';

/**
 * Builds the memory-intake lane's router for the server entrypoint, which mounts it at
 * `/api/memory` behind `authenticateToken`.
 *
 * There is nothing to read here: no environment, no path, no database handle. The lane keeps its rows
 * in the same database as everything else, reached through the repository barrel, and its write
 * targets are derived from a candidate at approve time. So this composition root names the one
 * service instance and hands it over.
 *
 * It is mounted at exactly ONE place, and that is the point of the module: the board's router is
 * reachable from a second door (`/api/kanban-pm`, guarded by a Metis's derived secret), and this lane
 * must not be. A mount is impossible to forget and impossible to reach by accident.
 *
 * IT ALSO STARTS THE LANE'S QUEUE DOOR — the sweep over the spill files a session without any verb of
 * its own drops for review. That is a timer rather than a request, and its own module owns every rule
 * it applies; this root only decides when it begins, and starting it twice is a no-op.
 */
export function createMemoryIntakeModule(): Router {
  startMemorySpillSweep();

  return createMemoryRoutes(memoryIntakeService);
}
