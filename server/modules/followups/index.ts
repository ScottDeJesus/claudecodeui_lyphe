import { followupsService, type FollowupsService } from './followups.service.js';

// createFollowupsModule: used by the server entrypoint to mount the followups lane's two doors — the widget's at
// `/api/followups` behind `authenticateToken`, and the `followups` command's at `/api/followups-cmd` behind the
// chat's own credential — one chat's next steps and known gaps, filed and closed one row at a time.
export { createFollowupsModule } from './followups.module.js';

// listOpenFollowups: used by the companion module's `list_followups` tool and its alerts, which name what a chat
// filed for him: that account's open items, newest first, for one chat (an app session id) or for every chat
// (`null`), each mapped exactly as the Next steps widget's own read maps it.
export const listOpenFollowups: FollowupsService['listOpenForAccount'] = (userId, appSessionId, limit) =>
  followupsService.listOpenForAccount(userId, appSessionId, limit);
