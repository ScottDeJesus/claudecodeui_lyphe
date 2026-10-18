import type { Router } from 'express';

import { createAffectedAreasRouter } from './affected-areas.routes.js';
import { createAffectedAreasService } from './affected-areas.service.js';

/** shadow-connector on this host, over loopback. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8001';

/**
 * Where shadow-connector keeps the secret its gate compares. Read at call time by the service and never
 * copied anywhere (a copy is a second home that drifts on rotation); this module only names the file.
 */
const DEFAULT_ENV_FILE = '/opt/shadow-connector/.env';

export type AffectedAreasModule = { router: Router };

/**
 * Builds the affected-areas lane for the server entrypoint: the allowlisted routes and the one
 * forwarder behind them. The lane is the one hop between the browser and shadow-connector's
 * internal-caller gate (R-CAP-11): this server already authenticates the operator, so the secret the
 * gate wants stays on this side and the browser never holds it.
 *
 * No watcher, no timer, no socket, no cache of any answer: the service forwards per request.
 *
 * The environment is read HERE and nowhere below it, which is what lets the lane be proven against a
 * scratch engine or an empty env file — a caller that sets either variable before calling this gets
 * the one it named. Consumer: `server/index.ts`.
 */
export function createAffectedAreasModule(): AffectedAreasModule {
  const service = createAffectedAreasService({
    baseUrl: process.env.SHADOW_CONNECTOR_URL || DEFAULT_BASE_URL,
    envFile: process.env.SHADOW_CONNECTOR_ENV_FILE || DEFAULT_ENV_FILE,
  });

  return {
    router: createAffectedAreasRouter({ forward: (request) => service.forward(request) }),
  };
}
