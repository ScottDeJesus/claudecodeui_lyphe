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
// wardenLinks: used by the later plans that talk to a warden — `send` and `registerHandler` for the
// frames of `run.*`, `diag.*`, `update.*` and `session.*`, `onChange` for a node's link moving.
export { wardenLinks } from './warden-links.js';
// ingest: used by the `fixes` plan's auto-run, which subscribes to a check's status moving
// (`onChange`); the same service takes every warden's results and center's own.
export { ingest } from './ingest.service.js';
