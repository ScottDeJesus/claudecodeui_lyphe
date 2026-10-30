/**
 * The session-host package's public surface.
 *
 * Everything else here — the rest of the host registry, the socket facade, the tmux plumbing — is
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
 * The same re-adoption for the hosts a co-located node's warden holds, which can only happen once
 * that warden has linked: the promise the running-sessions read waits on beside the boot's own, so a
 * browser never reads a live node session as idle (MAN-690, D-11).
 * consumer: server/index.ts, through the providers barrel
 */
export { whenNodeSessionsReadopted } from './node-readopt.js';

/**
 * The sweep over idle hosts left on an older build by an install, and its subscription to the
 * installed reading. `readoptKeepaliveSessions` calls the subscription itself; this export is for a
 * PROBE, which never holds the keepalive claim and therefore cannot get it that way.
 * consumer: .verify probes only
 */
export { retireStaleIdleHosts, watchInstalledCliVersionChanges } from './idle-version-sweep.js';

/**
 * The live hosts and the one test that says whether a host is mid-work — the registry where it can
 * answer, the host's own meta where it cannot. The claude-activity module asks exactly this of every
 * host, so an update never installs under a conversation the idle sweep itself would leave alone.
 * consumer: the claude-activity module, through the providers barrel
 */
export { busyReason } from './idle-version-sweep.js';
export { listLiveHosts } from './hosts.js';
export type { LiveHost } from './hosts.js';

/**
 * A host's last finished turn as its journal records it — when it ended, the result's `modelUsage`, and the turn's last budget
 * through the caller's own reading. The Claude runtime reports it to the compaction when it adopts a host whose turn is complete.
 * consumer: claude-compaction-restore.ts
 */
export { lastTurnRecord } from './hosts.js';

/**
 * THE ONE RULE for which assistant message counts as a turn's request, and its context size — the warden asks the same function of
 * the journal it lists (`host-registry.js` is shipped to the node as it stands), so a local host and a node's cannot be read apart.
 * consumer: claude-runtime.provider.js (a live stream's assistant message), claude-compaction-restore.ts (a re-adopted host's last turn)
 */
export { mainThreadRequestOf } from './host-registry.js';

/**
 * The hosts a co-located node's warden holds — their CLIs are this machine's `claude` processes — and
 * the ask that makes that list current. The claude-activity module reads them beside `listLiveHosts`.
 * consumer: the claude-activity module, through the providers barrel
 */
export { listColocatedNodeHosts, refreshColocatedNodeHosts } from './colocated-hosts.js';

/**
 * The chats with a live host, as the frame a socket is sent when it connects. The push that keeps a
 * page current after it is the same file's (`host-liveness.ts`); only this one read is public.
 * consumer: the websocket module's chat gateway, through the providers barrel
 */
export { sessionHostLivenessSnapshot } from './host-liveness.js';

/**
 * A chat gaining or losing its last live host, as it happens — `live` or `asleep`, never the snapshot. The push to the pages
 * is the same file's; this is the seam a listener of the server's own hears it through.
 * consumer: the companion module's station hint, through the providers barrel
 */
export { onHostLivenessChanged } from './host-liveness.js';
