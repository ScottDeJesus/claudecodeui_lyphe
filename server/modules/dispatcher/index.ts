// createDispatcherModule: used by the server entrypoint to mount the authenticated dispatcher lane
// at `/api/dispatcher` — the poll behind the `dispatcher_state` frame (every plan this host holds),
// the relay for the dispatcher's own stop/resume/park/unpark/schedule, its next off-peak moment, the
// notification each plan ending earns, and the prompt a plan owes the operator, put up in its owning
// chat's question panel and answered back through the dispatcher's own doors.
export { createDispatcherModule } from './dispatcher.module.js';
