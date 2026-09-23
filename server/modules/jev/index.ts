// createJevModule: used by the server entrypoint to mount the authenticated Jev lane at
// `/api/jev` — one reader's own summary (spend, consumers, the fourteen-day series, the live feed)
// and the door to its cache-clear verb. Every number is `hooks/jev_stats`'s, carried whole.
export { createJevModule } from './jev.module.js';

// What the reader's own answers look like, named once so the lane's callers do not re-spell them:
// the range token the routes accept, the relay result with its two faults, and the service itself.
export { createJevService } from './jev.service.js';
export type { JevRange, JevResult, JevService } from './jev.service.js';
