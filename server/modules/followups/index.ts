// createFollowupsModule: used by the server entrypoint to mount the followups lane's two doors — the widget's at
// `/api/followups` behind `authenticateToken`, and the `followups` command's at `/api/followups-cmd` behind the
// chat's own credential — one chat's next steps and known gaps, filed and closed one row at a time.
export { createFollowupsModule } from './followups.module.js';
