import { followupsService, TEXT_MAX, type FollowupsService } from './followups.service.js';

// createFollowupsModule: used by the server entrypoint to mount the followups lane's two doors — the widget's at
// `/api/followups` behind `authenticateToken`, and the `followups` command's at `/api/followups-cmd` behind the
// chat's own credential — one chat's next steps and known gaps, filed and closed one row at a time.
export { createFollowupsModule } from './followups.module.js';

// listOpenFollowups: used by the companion module's follow-up list (`tools/followup-list.ts`, behind `list_followups` and the alerts),
// which names what a chat filed for him: that account's open items, newest first, for one chat (an app session id) or for every chat
// (`null`), each mapped exactly as the Next steps widget's own read maps it.
export const listOpenFollowups: FollowupsService['listOpenForAccount'] = (userId, appSessionId, limit) =>
  followupsService.listOpenForAccount(userId, appSessionId, limit);

// listCompletionClosedFollowups: used by the companion module's follow-up list (`tools/followup-list.ts`), which puts these under the open
// items — the items the house closed when the feature, task or epic they named finished, newest first, each with its mark
// (`done: feature <name> finished`, the words `followups --all` prints) — for one chat (an app session id) or for every chat (`null`).
export const listCompletionClosedFollowups: FollowupsService['listSettledByCompletionForAccount'] = (userId, appSessionId, limit) =>
  followupsService.listSettledByCompletionForAccount(userId, appSessionId, limit);

// listOpenFollowupGroups: used by the companion module's station (`station/need-readers.ts`, the "Follow-ups" item of the rail): that
// account's open items grouped by chat, the chat with the newest item first, each with the chat's whole open count and its newest
// item — counted over every open row, where `listOpenFollowups` is a capped list.
export const listOpenFollowupGroups: FollowupsService['listOpenGroupsForAccount'] = (userId) => followupsService.listOpenGroupsForAccount(userId);

// findFollowupForAccount: used by the companion module's hands (`close_followup`) to tell a follow-up of his that is already closed
// from an id that is not his: one of that account's items by id, open or closed, beside its chat's app session id, mapped as the
// widget maps it; `null` when no item of that account carries the id.
export const findFollowupForAccount: FollowupsService['findForAccount'] = (userId, id) => followupsService.findForAccount(userId, id);

// closeFollowupsForCompletions: used by the dispatcher module's followups composition (`dispatcher-followups.module.ts`), each
// time the stamps of the dispatcher's store move, to settle the open items (of any chat and any account) that name a feature,
// task or epic that has finished — each closed with `closedBy: 'completion'`. It is handed the store WHOLE, never the lane's
// picture (which drops a plan a day after it ends), so it ignores age: what finished while the server was down is settled
// however long ago it finished. Idempotent. Answers the items it closed.
export const closeFollowupsForCompletions: FollowupsService['closeForCompletions'] = (plans, arcs) =>
  followupsService.closeForCompletions(plans, arcs);

// fileFollowupGapsForChat: used by the dispatcher module's build-gaps filer (`dispatcher-build-gaps.service.ts`), once per finished
// feature, to file what the feature's builders flagged as gaps on the feature's chat. Answers the rows it wrote — none for a line
// the chat already holds in any state — or `null` when the chat's account cannot be named, in which case it wrote nothing.
export const fileFollowupGapsForChat: FollowupsService['fileGapsForChat'] = (appSessionId, lines) =>
  followupsService.fileGapsForChat(appSessionId, lines);

// FOLLOWUP_TEXT_MAX: used by the dispatcher module's build-gaps filer, which cuts each line it files to this many characters —
// the ceiling `fileFollowupGapsForChat` refuses a longer line at.
export const FOLLOWUP_TEXT_MAX = TEXT_MAX;

// closeFollowupForAccount: used by the companion module's hands (`close_followup`, done the moment he asks, with no ceremony):
// his own tick of one follow-up of his, exactly as the Next steps widget's checkbox does it. `closed_by` is `user`, the chat's
// row is told with `followups_changed`, and an id of another account (or one that is gone) throws the lane's 404. Answers the
// item as stored.
export const closeFollowupForAccount = (userId: number, id: number) => followupsService.setStateForUser(userId, id, 'done');
