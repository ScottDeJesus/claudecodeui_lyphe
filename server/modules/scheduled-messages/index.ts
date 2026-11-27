// The HTTP surface for scheduling a message to a session, mounted by the app.
export { default as scheduledMessagesRoutes } from './scheduled-messages.routes.js';

// The timers that send them. `server/index.ts` starts them inside `soleServerDuties()`, the boot
// step only the sole server on the port may run — `server/supervised-boot.ts` holds why — and closes
// them on shutdown. `requestQueuedPass`: used by the user module after it saves a queued message.
export {
  initializeScheduledMessageDispatcher,
  closeScheduledMessageDispatcher,
  requestQueuedPass,
} from './services/scheduled-message-dispatcher.service.js';
