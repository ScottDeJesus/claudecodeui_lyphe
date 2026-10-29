// createHealModule: used by the server entrypoint to mount the authenticated heal lane at
// `/api/heal` — the reflex's own summary, the rows under one kind, the ignore table, and the doors
// to its cycle and ignore-add verbs. The module it builds also returns the lane's one `service`, which the
// entrypoint hands to the companion's house (`CompanionHouse.heal`, `server/modules/companion/house.ts`).
export { createHealModule } from './heal.module.js';

// What the worker's own answers look like, named once so the lane's callers do not re-spell them:
// the whole `--status` payload, the pair an ignore add reports, and the service's shape. `HealService` is
// also used by the companion's house (`house.ts`), which narrows it to `summary` and `kind`.
export { createHealService } from './heal.service.js';
export type { HealIgnoreAdd, HealService, HealSummary } from './heal.service.js';
