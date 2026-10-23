// createCarrierBulletinsModule: used by the server entrypoint to mount the authenticated carrier-bulletins lane
// at `/api/carrier-bulletins` — the allowlisted four GET routes of shadow-connector's bulletin-reading surface
// (the overview, a bulletin's pages, one page's reading, and a page's PNG), forwarded over loopback with the
// internal secret held on this side. Every JSON body is the engine's own, carried whole.
export { createCarrierBulletinsModule } from './carrier-bulletins.module.js';
