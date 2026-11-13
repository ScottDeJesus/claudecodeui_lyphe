// createUploadRunsModule: used by the server entrypoint to mount the authenticated upload runs lane at
// `/api/upload-runs` — the allowlisted five GET routes of shadow-connector's run record (the window's overview,
// one run whole, a run's events, the feed of every run's edges and a live run's own stream), forwarded over
// loopback with the internal secret held on this side. Every JSON body is the engine's own, carried whole; the
// two event streams are relayed as they arrive.
export { createUploadRunsModule } from './upload-runs.module.js';
