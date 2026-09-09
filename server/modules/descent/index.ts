// createDescentModule: used by the server entrypoint to mount the authenticated Descent proxy at `/api/descent` —
// both of its lanes, the accounts/usage picture and the memory-intake queue with its two review writes.
export { createDescentModule } from './descent.module.js';
