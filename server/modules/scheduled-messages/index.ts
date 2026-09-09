// The HTTP surface for scheduling a message to a session, mounted by the app.
export { default as scheduledMessagesRoutes } from './scheduled-messages.routes.js';

// The timer that sends them. `server/index.ts` starts it inside `soleServerDuties()`, the boot
// step only the sole server on the port may run — `server/supervised-boot.ts` holds why. The
// close has no caller: the poll timer is unref'd, so it never holds the process open and goes
// with it rather than being stopped on shutdown.
export {
  initializeScheduledMessageDispatcher,
  closeScheduledMessageDispatcher,
} from './services/scheduled-message-dispatcher.service.js';
