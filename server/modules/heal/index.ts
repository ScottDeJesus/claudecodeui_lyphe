// createHealModule: used by the server entrypoint to mount the authenticated heal lane at
// `/api/heal` — the reflex's own summary (the runner's heal queue included), the rows under one
// kind, the ignore table, and the doors to its cycle and ignore-add verbs.
export { createHealModule } from './heal.module.js';

// What the worker's own answers look like, named once so the lane's callers do not re-spell them:
// the whole `--status` payload, the pair an ignore add reports, and the service's shape.
export { createHealService } from './heal.service.js';
export type { HealIgnoreAdd, HealService, HealSummary } from './heal.service.js';
