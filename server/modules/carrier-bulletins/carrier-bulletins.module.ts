import type { Router } from 'express';

import { createShadowConnectorLane } from '@/shared/shadow-connector-lane.js';

import { createCarrierBulletinsRouter } from './carrier-bulletins.routes.js';

/** The word the forwarder's log warning leads with for this lane: `[carrier-bulletins] no usable internal secret …`. */
const LANE_LABEL = 'carrier-bulletins';

/** shadow-connector on this host, over loopback. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8001';

/**
 * Where shadow-connector keeps the secret its gate compares. Read at call time by the shared forwarder and
 * never copied anywhere (a copy is a second home that drifts on rotation); this module only names the file.
 */
const DEFAULT_ENV_FILE = '/opt/shadow-connector/.env';

export type CarrierBulletinsModule = { router: Router };

/**
 * Builds the carrier-bulletins lane for the server entrypoint: the four allowlisted GET routes of what
 * Claude read in the SERVPRO bulletins, and the one forwarder behind them. shadow-connector's
 * `/api/carrier-bulletins/` is internal-caller gated (R-CAP-11) even from loopback, and the browser never
 * holds the secret: this server already authenticates the operator, so the lane is the one hop that holds
 * it, as the Tours lane is.
 *
 * No watcher, no timer, no socket, no cache of any answer, no model call: the forwarder
 * (`@/shared/shadow-connector-lane`, which holds the one read of the secret) forwards per request.
 *
 * The environment is read HERE and nowhere below it, which is what lets the lane be proven against a
 * scratch engine or an empty env file — a caller that sets either variable before calling this gets
 * the one it named. Consumer: `server/index.ts`.
 */
export function createCarrierBulletinsModule(): CarrierBulletinsModule {
  const lane = createShadowConnectorLane({
    baseUrl: process.env.SHADOW_CONNECTOR_URL || DEFAULT_BASE_URL,
    envFile: process.env.SHADOW_CONNECTOR_ENV_FILE || DEFAULT_ENV_FILE,
    label: LANE_LABEL,
  });

  return {
    router: createCarrierBulletinsRouter({ forward: (request) => lane.forward(request) }),
  };
}
