// settingsRoutes: used by the server entrypoint to mount protected application-settings endpoints.
export { settingsRoutes } from './settings.module.js';

/**
 * The dispatcher's kick: wake the daemon, or start one where the store holds work.
 *
 * Consumer: `server/modules/accounts`, whose switch and capture routes call `void kickDispatcher()` once the
 * live login has changed — a usage-limit hold ends when the account it was met on leaves use, and every
 * plan held on one is paused, so the daemon is usually gone and nothing else tells it. (This module's own
 * toggles call it from `settings.service.ts`.) It never raises and is never awaited.
 */
export { kickDispatcher } from './dispatcher-kick.js';

/**
 * The Custom compaction switch's two reads, for `server/modules/compaction`: it reads the file at
 * every message to decide whether a chat's compaction is taken over, and asks `summarize --status`
 * (cached there by the binary's identity) whether the summarizer can be served. It reaches them
 * through this barrel and never by deep-importing `custom-compaction-switch.js`.
 */
export { readCustomCompactionSwitch, summarizerStatus } from './custom-compaction-switch.js';
export type { SummarizerStatus } from '@/shared/types.js';
