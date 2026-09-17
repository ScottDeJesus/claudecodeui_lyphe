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
