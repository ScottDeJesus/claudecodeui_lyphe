// createAgentLaunchModule: used by the server entrypoint to mount the authenticated agent-launch
// lane at `/api/agent-launch` — the launch table's census, and the doors that pin a row or change
// the defaults through its CLI.
export { createAgentLaunchModule } from './agent-launch.module.js';

// resolveLaunchSide: used by kanban-metis's composition root (`kanban-metis.module.ts`), which hands
// it to the spawner so a board's Metis launches at the model and effort the table names for her.
export { resolveLaunchSide } from './agent-launch.module.js';
