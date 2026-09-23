// createSchedulesModule: used by the server entrypoint to mount the authenticated schedules lane
// at `/api/schedules` — the cron registry as the Schedules tab reads it, one GET answering with the
// registry's own rows joined to the asking user's still-pending scheduled prompts.
export { createSchedulesModule } from './schedules.module.js';
