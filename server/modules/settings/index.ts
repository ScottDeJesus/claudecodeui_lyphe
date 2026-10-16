// settingsRoutes: used by the server entrypoint to mount protected application-settings endpoints.
export { settingsRoutes } from './settings.module.js';

/**
 * One DeepSeek Flash flag FILE, read and written by path.
 *
 * Consumer: `server/modules/kanban-metis`, which derives a board's path from its own row at every
 * spawn (`~/.claude/state/kanban-deepseek/<boardId>.flag`) and hands it to the Metis child as
 * `PLAN_RUNNER_DEEPSEEK_FLAG_PATH`. A board writes its OWN file rather than the host-wide one
 * because two boards on one host must be able to run different models, and a single shared file
 * cannot say that. It reaches the writer through this barrel and never by deep-importing
 * `deepseek-flash-switch.js`, so the one mechanism both callers share stays the one mechanism.
 */
export { readFlagFile, writeFlagFile } from './deepseek-flash-switch.js';

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
