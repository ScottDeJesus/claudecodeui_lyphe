// createToolsetsModule: used by the server entrypoint to mount tool sets' two doors — the operator's at
// `/api/toolsets` behind `authenticateToken`, and the `toolset` command's at `/api/toolsets-cmd` behind
// its own per-chat credential — and to register the launch hook that gives each Claude chat its sets.
export { createToolsetsModule } from './toolsets.module.js';
