// createClaudeUpdatesModule: used by the server entrypoint to mount the authenticated Claude update
// report at `/api/claude-updates`, and to arm its check after `listen` and stop it on shutdown.
// Everything inside the module stays inside it — this barrel is the whole public surface.
export { createClaudeUpdatesModule } from './claude-updates.module.js';
