// createDispatchSoulsModule: used by the server entrypoint to mount the authenticated
// dispatch-souls lane at `/api/dispatch-souls` — the poll behind the `soul_launch_state` frame,
// which is what puts a pin among the chat's pinned rows for every hand a session launched by hand.
export { createDispatchSoulsModule } from './dispatch-souls.module.js';
// listRunningLaunchers: used by the providers module's running-sessions answer, which lights the
// sidebar's purple dot for a conversation whose launched soul or chain is still out — a process
// that never appears in the conversation's own transcript.
export { listRunningLaunchers } from './running-launchers.service.js';
export type { RunningLauncher } from './running-launchers.service.js';
