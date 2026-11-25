import type { Router } from 'express';

import { createShadowConnectorLane } from '@/shared/shadow-connector-lane.js';

import { createGeminiUsageRouter } from './gemini-usage.routes.js';

/** The word the forwarder's log warning leads with for this lane: `[gemini-usage] no usable internal secret …`. */
const LANE_LABEL = 'gemini-usage';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8001';
const DEFAULT_ENV_FILE = '/opt/shadow-connector/.env';

export type GeminiUsageModule = { router: Router };

/**
 * The lane to shadow-connector's /api/gemini-usage: what Gemini cost the account, by feature, budget, key and process,
 * and the switch per feature. That surface is internal-caller gated, so this one hop holds the secret, read from
 * shadow-connector's own env file at call time (INV-8633); the browser never does.
 *
 * SHADOW_CONNECTOR_URL and SHADOW_CONNECTOR_ENV_FILE are read here and nowhere else for this lane, so a scratch engine
 * is proven by setting them before createGeminiUsageModule(). Consumer: server/index.ts, mounted behind authenticateToken.
 */
export function createGeminiUsageModule(): GeminiUsageModule {
  const lane = createShadowConnectorLane({
    baseUrl: process.env.SHADOW_CONNECTOR_URL || DEFAULT_BASE_URL,
    envFile: process.env.SHADOW_CONNECTOR_ENV_FILE || DEFAULT_ENV_FILE,
    label: LANE_LABEL,
  });

  return {
    router: createGeminiUsageRouter({ forward: (request) => lane.forward(request) }),
  };
}
