// createSessionPanelModule: used by the server entrypoint to mount the session panel's two doors: the reader's at
// `/api/session-panel` behind `authenticateToken`, and the `panel` command's at `/api/session-panel-cmd` behind the chat's own
// credential. One chat's panel: the thing it shows there and the versions of it.
export { createSessionPanelModule } from './session-panel.module.js';
