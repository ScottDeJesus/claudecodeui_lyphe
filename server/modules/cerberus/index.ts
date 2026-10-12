/**
 * The Cerberus module: the fleet's health at `/api/cerberus`, the gateway the wardens dial in on, the
 * checks center runs on itself, and the store all of it is written to.
 *
 * This barrel is the whole public surface; everything else in the directory stays inside it. The
 * module is built ONCE by the server entrypoint and named by `listen`, because three of its parts are
 * ARMED rather than called. The store, the center key and the gateway start in the `listen`
 * callback — the gateway is a listener of its own on the tailnet, and a boot that never got as far
 * as serving has no business opening a second port. The self-checks and the daily prune are SOLE
 * duties, started from `soleServerDuties` so that only the process holding the takeover writes a hub
 * row or deletes one (a handover's second process on the same store would do both twice). And
 * shutdown has to be able to name them all: `stop()` is the first thing the entrypoint's shutdown
 * runs, so no new tick, prune or connection begins on a process that is leaving, and the gateway
 * stops accepting while the links it already holds are left to the process's exit (a warden
 * reconnects to the successor on its own).
 *
 * `HOST` stays loopback and the API's own listener is untouched: `CERBERUS_LISTEN`, `CERBERUS_DB_PATH`
 * and `CERBERUS_KEY_PATH` are read at boot, and only the gateway ever binds the tailnet address.
 */

// createCerberusModule: used by the server entrypoint to mount the authenticated fleet-health router
// at `/api/cerberus`, to start the store and the gateway after `listen`, to start the self-checks and
// the prune from `soleServerDuties`, and to stop them first on shutdown.
export { createCerberusModule } from './cerberus.module.js';
// wardenLinks: the registry of warden links (`send`, `registerHandler`, `onChange`). The handlers of
// `run.*`, `diag.*`, `update.*`, `session.*` and `catalog.ack` register from inside this directory;
// no module outside it imports this export.
export { wardenLinks } from './warden-links.js';
// nodeSessions: used by the session host (`session-host/node-transport.ts`, `node-readopt.ts`,
// `readopt-host.ts`, `colocated-hosts.ts`, `refused-hosts.ts`) and the projects module
// (`services/project-node.service.ts`), through this barrel: `openChannel` carries a session's host
// frames over a node's link, `listHosts` / `retireHost` / `lastListed` adopt and tidy what runs
// there, `isColocated` tells a node on this machine from a remote one, and `onLinkUp` re-adopts when
// a warden reconnects.
export { nodeSessions } from './node-sessions.js';
// hintChanged: used by the projects module's `setProjectNode`, which writes what a node card shows
// (`projects`) without any Cerberus store write, and by the session host (`node-readopt.ts`,
// `colocated-hosts.ts`) after a node's hosts are listed (the card's session count); no other path
// would tell open screens to re-read.
export { hintChanged } from './cerberus-broadcast.js';
