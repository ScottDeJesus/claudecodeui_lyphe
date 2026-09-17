// createUniverseModule: used by the server entrypoint to mount the authenticated universe lane at
// `/api/universe` — the held estate map behind one GET, the watcher that notices a repo's HEAD moved
// and announces the new map as a `universe_map` frame, and the two taps (the systemd journal and the
// Claude transcripts) whose coalesced rows go out as `universe_activity` frames.
export { createUniverseModule } from './universe.module.js';
