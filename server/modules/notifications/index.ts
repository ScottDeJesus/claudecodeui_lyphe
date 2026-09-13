export {
  // Used by notification tests and delivery workflows to create channel payloads.
  buildNotificationPayload,
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
export {
  registerDesktopNotificationClient,
  sendDesktopNotification,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/services/desktop-notification-clients.service.js';
export { handleDesktopNotificationsConnection } from '@/modules/notifications/websocket/desktop-notifications-websocket.service.js';
// Used by the chat websocket to record which session each tab shows; the ntfy channel skips a watched session.
export { clearPresence, isSessionWatched, markPresence } from '@/modules/notifications/services/session-presence.service.js';
// Used by the server entrypoint to mount the public tap-to-answer route at /api/ntfy/act.
export { createNtfyActionRoutes } from '@/modules/notifications/ntfy-action.routes.js';
// getPublicKey: used by Settings to expose the Web Push subscription key.
export { getPublicKey } from './vapid-keys.service.js';
// configureWebPush: used by the server entrypoint during notification startup.
export { configureWebPush } from './vapid-keys.service.js';
