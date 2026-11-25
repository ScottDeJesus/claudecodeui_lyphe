import type express from 'express';

import type { ShadowConnectorLane } from '@/shared/shadow-connector-lane.js';
import { createLaneRouter, patternRule } from '@/shared/shadow-connector-lane-router.js';
import type { LaneRoute, LaneRule } from '@/shared/shadow-connector-lane-router.js';

/** The prefix this lane serves, and the one shadow-connector serves the same surface under. */
const UPSTREAM_PREFIX = '/api/gemini-usage';

// The usage read is one read of the connector's daily table, priced at read; a switch is one file rewrite.
const LANE_TIMEOUT_MS = 30_000;

/** The windows the connector answers for: the same three the panel offers, and nothing else reaches it. */
const RANGE_RULE: LaneRule = patternRule(/^(today|7d|30d)$/, 'one of today, 7d or 30d');

/** A feature key as the connector's catalog spells one (core/gemini_features/routes.py checks the same shape). */
const FEATURE_RULE: LaneRule = patternRule(/^[a-z0-9_]{1,80}$/, '1 to 80 characters of a-z, 0-9 and _');

const PATH_RULES: Record<string, LaneRule> = { feature: FEATURE_RULE };

/**
 * THE ALLOWLIST: the reading and the switch, the two routes of the surface. The switch's body
 * (`{"enabled": bool}`) passes whole; the connector checks it and answers what its file reads back. A method-and-path
 * pair that is not a row here never reaches shadow-connector: the lane answers its own 404.
 */
const ALLOWLIST: LaneRoute[] = [
  { method: 'get', route: '/usage', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none', query: { range: RANGE_RULE } },
  { method: 'put', route: '/switches/:feature', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'object' },
];

/**
 * The gemini-usage lane's routes. Auth is the mount's `authenticateToken`, in `server/index.ts`. The shared router
 * (`@/shared/shadow-connector-lane-router`) validates and answers: a bad id or range is the lane's 422, any other path
 * its 404, an upstream answer passes through with its status and JSON untouched (INV-8633 rule 5).
 *
 * Consumer: `gemini-usage.module.ts`, which hands in the forwarder's `forward`.
 */
export function createGeminiUsageRouter(
  dependencies: Pick<ShadowConnectorLane, 'forward'>,
): express.Router {
  return createLaneRouter({
    lane: 'gemini-usage',
    upstreamPrefix: UPSTREAM_PREFIX,
    pathRules: PATH_RULES,
    allowlist: ALLOWLIST,
    forward: dependencies.forward,
  });
}
