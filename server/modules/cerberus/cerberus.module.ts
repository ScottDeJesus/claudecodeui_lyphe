import type { Router } from 'express';

import { getCerberusConnection } from '@/modules/database/index.js';
import type { CerberusGatewayState, CerberusReadInputs } from '@/shared/cerberus-types.js';

import { createCerberusRouter } from './cerberus.routes.js';
import { loadCenterKey } from './center-key.js';
import { seedHub } from './definitions.service.js';
import { ingest } from './ingest.service.js';
import { startSelfChecks, stopSelfChecks } from './self-checks.service.js';
import { startDailyPrune, stopDailyPrune } from './store-prune.service.js';
import { registerWardenFileRoutes } from './warden-files.js';
import { parseListen, startWardenGateway, type WardenGateway } from './warden-gateway.js';
import { wardenLinks } from './warden-links.js';

/**
 * The Cerberus composition root: the router for `/api/cerberus`, and the three things that are ARMED
 * rather than called — the store and the gateway (`start`), the self-checks and the prune
 * (`soleDuties`), and their shutdown (`stop`).
 *
 * `start()` runs in the entrypoint's `listen` callback and does, in this order: opens the store
 * (its migrations run on the first open), loads the center key (a key that cannot be read or written
 * fails HERE, loudly, not on the first warden's enrollment), seeds the hub's own definitions, makes
 * every enrolled node known to the link registry (silent until heard) and fills ingest's memory from
 * the store — and only then binds the gateway, so the first warden to dial in finds a center that
 * knows its nodes; the warden's file routes (the enroll script and the release) are registered just
 * before that bind, so the gateway never answers a request they should have taken. A failure in any
 * step is logged and leaves the API serving: Cerberus is how the fleet is watched, never a reason for
 * the API to be down.
 *
 * `soleDuties()` is the entrypoint's `soleServerDuties` calling in, and it arms the self-checks and
 * the prune only in the process that holds the port: a second API process on the same store would
 * write a second set of hub rows. It can run BEFORE `start()` (a plain boot runs its sole duties
 * before it listens) or after it (a handover boot runs them at takeover), so each call only
 * records its half and the duties start when both have happened — never against a store that
 * `start()` has not yet opened and seeded.
 *
 * `CERBERUS_LISTEN` is read at start, so a change takes a boot. It is refused when it names the API's
 * own `SERVER_PORT`, whatever the host: `reusePort` would let the gateway bind an address the API
 * already holds without an error, and the kernel would then split the API's traffic between the two
 * listeners. The host is not compared, because `localhost`, `127.0.0.1` and a wildcard are three
 * spellings of one socket and only the kernel knows which; the gateway has no reason to share the
 * API's port, so the port is the whole rule.
 *
 * Consumers: `index.ts` (re-exported for the server entrypoint).
 */

/** `CERBERUS_LISTEN` as set; blank counts as unset. */
function readConfiguredListen(): string | null {
  return process.env.CERBERUS_LISTEN?.trim() || null;
}

/** Whether `listen` names the port the API itself serves on. */
function isApiOwnPort(listen: string): boolean {
  const target = parseListen(listen);
  return target !== null && target.port === Number.parseInt(process.env.SERVER_PORT || '3001', 10);
}

export function createCerberusModule(dependencies: { supervised: boolean }): {
  router: Router;
  start: () => Promise<void>;
  soleDuties: () => void;
  stop: () => void;
} {
  const { supervised } = dependencies;

  // Until `start()` has tried to bind, the gateway is configured and not listening.
  let gatewayState: CerberusGatewayState = { listen: readConfiguredListen(), address: null, error: null };
  let gateway: WardenGateway | null = null;
  let startFinished = false;
  let dutiesAsked = false;
  let stopped = false;

  /** Everything the read model is handed with the store: one instant, the links, the gateway, ingest's memory. */
  function readInputs(): CerberusReadInputs {
    return {
      now: Date.now(),
      links: wardenLinks.states(),
      gateway: gatewayState,
      memory: (node, key) => ingest.memory(node, key),
    };
  }

  /** Starts the sole duties once both `start()` and `soleDuties()` have happened; idempotent. */
  function armSoleDuties(): void {
    if (!startFinished || !dutiesAsked || stopped) return;
    startSelfChecks(() => gatewayState);
    startDailyPrune();
  }

  async function start(): Promise<void> {
    if (stopped) return;
    try {
      getCerberusConnection();
      loadCenterKey();
      seedHub();
      wardenLinks.seedFromStore();
      ingest.seedMemory();

      const listen = readConfiguredListen();
      const refusal = listen !== null && isApiOwnPort(listen) ? `CERBERUS_LISTEN ${listen} is on the API's own port` : null;
      if (refusal) console.error(`[Cerberus] the warden gateway did not start: ${refusal}`);
      if (listen !== null && refusal === null) registerWardenFileRoutes(listen);
      gateway = refusal === null ? await startWardenGateway({ listen, supervised }) : null;
      gatewayState = { listen, address: gateway?.address ?? null, error: refusal ?? gateway?.error ?? null };

      // A shutdown that arrived while the bind was pending: nobody is left to dial this listener.
      if (stopped) gateway?.stop();
      startFinished = true;
      armSoleDuties();
    } catch (error) {
      console.error(`[Cerberus] could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    router: createCerberusRouter({ readInputs, gatewayState: () => gatewayState }),
    start,
    soleDuties: () => {
      dutiesAsked = true;
      armSoleDuties();
    },
    stop: () => {
      stopped = true;
      stopSelfChecks();
      stopDailyPrune();
      gateway?.stop();
    },
  };
}
