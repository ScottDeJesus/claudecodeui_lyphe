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

// findFollowupForAccount: used by the companion module's hands (`close_followup`) to tell a follow-up of his that is already closed
// from an id that is not his: one of that account's items by id, open or closed, beside its chat's app session id, mapped as the
// widget maps it; `null` when no item of that account carries the id.
export const findFollowupForAccount: FollowupsService['findForAccount'] = (userId, id) => followupsService.findForAccount(userId, id);

// closeFollowupsForCompletions: used by the dispatcher module's watcher callback, once per picture the dispatcher
// sends, to settle the open items (of any chat and any account) that name a feature, task or epic that has finished —
// each closed with `closedBy: 'completion'`. Idempotent, so the first picture after a boot catches what finished while
// the server was down — for as long as the picture still carries it (the dispatcher's lane drops a plan 24 h after it
// ends, and an epic with no plan left). Answers the items it closed.
export const closeFollowupsForCompletions: FollowupsService['closeForCompletions'] = (plans, arcs) =>
  followupsService.closeForCompletions(plans, arcs);

// closeFollowupForAccount: used by the companion module's hands (`close_followup`, done the moment he asks, with no ceremony):
// his own tick of one follow-up of his, exactly as the Next steps widget's checkbox does it. `closed_by` is `user`, the chat's
// row is told with `followups_changed`, and an id of another account (or one that is gone) throws the lane's 404. Answers the
// item as stored.
export const closeFollowupForAccount = (userId: number, id: number) => followupsService.setStateForUser(userId, id, 'done');
