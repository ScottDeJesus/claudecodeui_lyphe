// createRoadmapModule: used by the server entrypoint (`server/index.ts`) to mount the authenticated
// roadmap lane at `/api/roadmap` — the poll behind the `roadmap_state` frame (the roadmaps, milestones,
// epics and features the dispatcher holds), the read of that picture, and the relay for the nine
// writes the screen presses (add, edit, move, propose, unpropose, block, unblock, remove, promote),
// each a dispatcher verb. `RoadmapModule` is the shape it returns: the router to mount, and the poll's
// start (after `listen`) and stop (at shutdown).
export { createRoadmapModule } from './roadmap.module.js';
export type { RoadmapModule } from './roadmap.module.js';
