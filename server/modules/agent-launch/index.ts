// createAgentLaunchModule: used by the server entrypoint to mount the authenticated agent-launch
// lane at `/api/agent-launch` — the launch table's census, and the doors that pin a row or change
// the defaults through its CLI.
export { createAgentLaunchModule } from './agent-launch.module.js';
