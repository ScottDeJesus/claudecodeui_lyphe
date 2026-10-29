export {
  // Used by provider runtimes and Settings to create normalized notification events.
  createNotificationEvent,
  // Used by provider runtimes and Settings to deliver events through enabled channels.
  notifyUserIfEnabled,
  // Used by provider runtimes to report failed agent runs.
  notifyRunFailed,
  // Used by provider runtimes to report stopped or completed agent runs.
  notifyRunStopped,
  // Used by provider runtimes to report background work that finished after its turn ended.
  notifyBackgroundWorkCompleted,
} from '@/modules/notifications/services/notification-orchestrator.service.js';
// Used by callers outside this module that show an event's wording: the one headline and body per code.
export { buildNotificationText } from '@/modules/notifications/services/notification-copy.service.js';
// spendFreeWording: used by the companion module's alert block, which tells her what the house said as it lands.
// The title and body of an event with every cost, token and usage figure taken out — the one rule, beside
// `buildNotificationPayload`, so no wording that reaches her can carry a cost.
export { spendFreeWording } from '@/modules/notifications/services/notification-spend-free.service.js';
export type { SpendFreeWording } from '@/modules/notifications/services/notification-spend-free.service.js';
// startNotificationHistory: used by the server entrypoint, which starts the house's notification history after `listen`
// and calls the unsubscribe it answers on shutdown. listNotificationHistory: used by the companion module's `list_alerts`,
// which reads what the house told him lately.
export {
  listNotificationHistory,
  startNotificationHistory,
} from '@/modules/notifications/services/notification-history.service.js';
export {
  registerDesktopNotificationClient,
  sendDesktopNotification,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/services/desktop-notification-clients.service.js';
export { handleDesktopNotificationsConnection } from '@/modules/notifications/websocket/desktop-notifications-websocket.service.js';
// Used by the chat websocket to record which session each tab shows; the ntfy channel skips a watched session,
// and the chat run registry asks whether any tab has the finishing chat on screen.
export {
  clearPresence,
  isSessionOnScreen,
  isSessionWatched,
  markPresence,
} from '@/modules/notifications/services/session-presence.service.js';
// viewOf: used by the companion module's view — the chat on the account's freshest visible tab, named in
// the message she is pushed so "this one" means the chat he is looking at.
export { viewOf } from '@/modules/notifications/services/session-presence.service.js';
// onNotification: used by the companion module's alert feed, which hears every event the orchestrator is handed
// — before any push preference or dedupe — and turns the few that are her business into what she says unasked.
export { onNotification } from '@/modules/notifications/services/notification-listeners.service.js';
// Used by the server entrypoint to mount the public tap-to-answer route at /api/ntfy/act.
export { createNtfyActionRoutes } from '@/modules/notifications/ntfy-action.routes.js';
// Used by the Claude runtime the moment an approval resolves, whichever door it came through: the
// prompt's phone buttons must stop answering a question that is already settled.
export { forgetPendingAction } from '@/modules/notifications/services/ntfy-action-token.service.js';
// getPublicKey: used by Settings to expose the Web Push subscription key.
export { getPublicKey } from './vapid-keys.service.js';
// configureWebPush: used by the server entrypoint during notification startup.
export { configureWebPush } from './vapid-keys.service.js';
