// userRoutes: used by the server entrypoint to mount protected user-profile endpoints.
export { userRoutes } from './user.module.js';
// tellDraftsChanged: used by the scheduled-messages dispatcher, whose claim, restore and delete of a queued message
// are draft writes too, told through the same paced `drafts_changed` hint.
export { tellDraftsChanged } from './drafts-hint.service.js';
