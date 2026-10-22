import type express from 'express';

import type { ShadowConnectorLane } from '@/shared/shadow-connector-lane.js';
import {
  LOWERCASE_UUID_RULE,
  LOWERCASE_UUID_SOURCE,
  SHA256_RULE,
  createLaneRouter,
  patternRule,
} from '@/shared/shadow-connector-lane-router.js';
import type { LaneRoute, LaneRule } from '@/shared/shadow-connector-lane-router.js';

/** The prefix this lane serves, and the one shadow-connector serves the same surface under. */
const UPSTREAM_PREFIX = '/api/affected-areas';

const LANE_TIMEOUT_MS = 20_000;
const VIEWS_TIMEOUT_MS = 90_000;
const READ_TIMEOUT_MS = 120_000;

const wholeNumber = (min: number, max: number): LaneRule => ({
  test: (value) => /^\d{1,4}$/.test(value) && Number(value) >= min && Number(value) <= max,
  expects: `a whole number from ${min} to ${max}`,
});

const oneOf = (...allowed: string[]): LaneRule => ({
  test: (value) => allowed.includes(value),
  expects: `one of ${allowed.join(', ')}`,
});

/** The ids a path may carry. Every id is lowercase only, as shadow-connector's own `routes/ids.py` holds them: the hex ids and the uuids. */
const PATH_RULES: Record<string, LaneRule> = {
  tour: patternRule(/^[0-9a-f]{24}$/, '24 lowercase hex characters'),
  pano: patternRule(/^[0-9a-f]{24}$/, '24 lowercase hex characters'),
  sha: SHA256_RULE,
  region: LOWERCASE_UUID_RULE,
  read: LOWERCASE_UUID_RULE,
  class: patternRule(/^[a-z_]{2,40}$/, '2 to 40 lowercase letters or underscores'),
};

const CLASS_RULE = PATH_RULES.class;

/** The most regions one `GET /queue` may pass over: shadow-connector's `routes/ids.py` `MAX_SKIP`, which answers more with a 422. */
const MAX_SKIP = 50;
/** `skip`: up to `MAX_SKIP` lowercase uuids, comma-joined and none blank, as the engine's `SKIP_PATTERN` holds them; an empty value is no skip. */
const SKIP_RULE = patternRule(
  new RegExp(`^(${LOWERCASE_UUID_SOURCE}(,${LOWERCASE_UUID_SOURCE}){0,${MAX_SKIP - 1}})?$`),
  `at most ${MAX_SKIP} lowercase uuids, comma-joined`,
);
// A model name, a codebook version or a contract hash: one token, not a sentence.
const TOKEN_RULE = patternRule(/^[\w.:-]{1,80}$/, 'one token of at most 80 characters');

/**
 * THE ALLOWLIST. A method-and-path pair that is not a row here never reaches shadow-connector: the lane
 * answers its own 404.
 */
const ALLOWLIST: LaneRoute[] = [
  { method: 'get', route: '/tours', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none',
    // Counted by code point, as the engine counts characters: `.length` would call an emoji two.
    query: { q: { test: (value) => [...value].length <= 80, expects: 'at most 80 characters' }, limit: wholeNumber(1, 100) } },
  { method: 'get', route: '/tours/:tour', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'post', route: '/tours/:tour/panos/:pano/views', timeoutMs: VIEWS_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'get', route: '/tours/:tour/panos/:pano', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'post', route: '/tours/:tour/panos/:pano/read', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'object' },
  { method: 'post', route: '/tours/:tour/read', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'get', route: '/images/:sha', timeoutMs: LANE_TIMEOUT_MS, expect: 'bytes', body: 'none' },
  { method: 'get', route: '/codebook', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'post', route: '/regions/:region/marks', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'object' },
  { method: 'post', route: '/images/:sha/regions', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'object' },
  { method: 'post', route: '/reads/:read/marks', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'object' },
  { method: 'get', route: '/queue', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none',
    query: { mode: oneOf('unsure', 'random'), class: CLASS_RULE, limit: wholeNumber(1, 50), skip: SKIP_RULE } },
  { method: 'get', route: '/proving', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none',
    query: { model: TOKEN_RULE, contract: TOKEN_RULE } },
  { method: 'put', route: '/thresholds/:class', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'object' },
];

/**
 * The affected-areas lane's routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * This file declares the lane — its table, its id shapes, its one image type (the Tours images are JPEGs)
 * — and the shared router (`@/shared/shadow-connector-lane-router`) validates, translates and answers.
 * The shared forwarder (`@/shared/shadow-connector-lane`) owns the one transport, and the secret behind it.
 *
 * Consumer: `affected-areas.module.ts`, which hands in the forwarder's `forward`.
 */
export function createAffectedAreasRouter(
  dependencies: Pick<ShadowConnectorLane, 'forward'>,
): express.Router {
  return createLaneRouter({
    lane: 'affected-areas',
    upstreamPrefix: UPSTREAM_PREFIX,
    pathRules: PATH_RULES,
    allowlist: ALLOWLIST,
    forward: dependencies.forward,
    image: { contentType: 'image/jpeg', noun: 'a JPEG' },
  });
}
