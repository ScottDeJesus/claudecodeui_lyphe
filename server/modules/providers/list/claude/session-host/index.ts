/**
 * The session-host package's public surface.
 *
 * Everything else here — the host registry, the socket facade, the tmux plumbing — is
 * package-internal on purpose: the mechanism's one home is this directory, and the provider
 * seam is deliberately only a handful of lines wide (D-6).
 */

/** Arms the SDK's spawn seam for one turn. consumer: claude-runtime.provider.js */
export { armKeepaliveSpawn } from './spawner.js';

/**
 * The re-adoption a turn should honour, asked at the two turn-state bits — which the provider
 * reads before the arming call above exists. consumer: claude-runtime.provider.js
 */
export { keepaliveReadopt } from './spawner.js';

/** The per-run handle a `result` is acked through. consumer: claude-runtime.provider.js */
export type { KeepaliveHandle } from './spawner.js';

/** The re-adoption inputs a detached turn carries. consumer: claude-runtime.provider.js */
export type { KeepaliveReattach } from './spawner.js';

/**
 * The boot step that gives every CLI which outlived the API its run back (D-11).
 * consumer: server/index.ts, through the providers barrel
 */
export { readoptKeepaliveSessions, releaseKeepaliveOwnership } from './readopt.js';

/**
 * The sweep over idle hosts left on an older build by an install, and its subscription to the
 * installed reading. `readoptKeepaliveSessions` calls the subscription itself; this export is for a
 * PROBE, which never holds the keepalive claim and therefore cannot get it that way.
 * consumer: .verify probes only
 */
export { retireStaleIdleHosts, watchInstalledCliVersionChanges } from './idle-version-sweep.js';
