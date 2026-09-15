// createDispatchSoulsModule: used by the server entrypoint to mount the authenticated
// dispatch-souls lane at `/api/dispatch-souls` — the poll behind the `soul_launch_state` frame,
// which is what puts a pin among the chat's pinned rows for every hand a `/dispatch` launched.
export { createDispatchSoulsModule } from './dispatch-souls.module.js';
