// createAffectedAreasModule: used by the server entrypoint to mount the authenticated affected-areas lane
// at `/api/affected-areas` — the allowlisted fourteen routes of shadow-connector's tour affected-areas
// engine, forwarded over loopback with the internal secret held on this side. Every body is the
// engine's own, carried whole.
export { createAffectedAreasModule } from './affected-areas.module.js';
