// createAppsModule: used by the server entrypoint to mount the application registry behind
// `authenticateToken` at `/api/apps` — the list of applications this host serves, the two ports
// that identify CloudCLI's own row among them, and the append and remove that edit the file the
// operator's drawer reads.
export { createAppsModule } from './apps.module.js';
