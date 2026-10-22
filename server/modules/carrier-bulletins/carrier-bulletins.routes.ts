import type express from 'express';

import type { ShadowConnectorLane } from '@/shared/shadow-connector-lane.js';
import {
  LOWERCASE_UUID_RULE,
  SHA256_RULE,
  createLaneRouter,
  patternRule,
} from '@/shared/shadow-connector-lane-router.js';
import type { LaneRoute, LaneRule } from '@/shared/shadow-connector-lane-router.js';

/** The prefix this lane serves, and the one shadow-connector serves the same surface under. */
const UPSTREAM_PREFIX = '/api/carrier-bulletins';

// The overview plans every carrier's current file, and a file nobody has opened yet is fingerprinted from
// its PDF on that first call, so it is given room the other reads do not need.
const OVERVIEW_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 30_000;

/** The eight bytes every PNG begins with: an image answer that does not is not a page, whatever its Content-Type says. */
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/**
 * The engine's response headers a JSON answer carries back to the browser (and no other):
 *  - `x-left-out`: a JSON array of `{carrier, reason}` naming a carrier whose current file could not be
 *    planned and so is missing from the overview's list. The body stays the bare array, so without this a
 *    carrier would vanish from the overview with no mark on the wire. Absent when no carrier is left out.
 *  - `cache-control`: the engine stamps `no-store` on every body and every error, because what Claude has
 *    read changes with every pull; the lane's answers keep it rather than fall back to Express's ETag alone.
 */
const PASSED_HEADERS = ['x-left-out', 'cache-control'] as const;

/**
 * A page is 1 to 999 with no sign, no leading zero and no blank — the engine's own spelling
 * (`api/carrier_bulletins/ids.py`). It is a pattern and not a number with bounds on purpose: `3`, `03` and
 * `+3` would otherwise be three URLs for one page image, and the image is cached for a year under its URL.
 */
const PAGE_RULE: LaneRule = patternRule(/^[1-9]\d{0,2}$/, 'a whole number from 1 to 999');

/** The ids a path may carry: a bulletin row (uuid), the exact file (sha256 of its bytes) and a page of it. */
const PATH_RULES: Record<string, LaneRule> = {
  bulletin: LOWERCASE_UUID_RULE,
  sha: SHA256_RULE,
  page: PAGE_RULE,
};

/**
 * THE ALLOWLIST: the four routes of the surface, GET only, because the view is read-only — no verb here
 * writes a rule, a verdict or a reading, and none could be added without re-deciding the surface
 * (shadow-connector's INV-9382). None takes a query or a body. A method-and-path pair that is not a row
 * here never reaches shadow-connector: the lane answers its own 404.
 */
const ALLOWLIST: LaneRoute[] = [
  { method: 'get', route: '/overview', timeoutMs: OVERVIEW_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'get', route: '/bulletins/:bulletin/pages', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'get', route: '/bulletins/:bulletin/pages/:page', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'get', route: '/files/:sha/pages/:page/image', timeoutMs: READ_TIMEOUT_MS, expect: 'bytes', body: 'none' },
];

/**
 * The bulletins lane's routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * This file declares the lane — its four rows, its id shapes, its one image type (the page images are
 * PNGs) — and the shared router (`@/shared/shadow-connector-lane-router`) validates, translates and
 * answers: a bad id is the lane's 422, any other path its 404, an upstream answer passes through with its
 * status and JSON untouched, and the lane's own faults are `{ error }`. The page image is relayed as bytes
 * under an immutable cache header: it is keyed by the file's sha256 and the page, so it never changes.
 *
 * Consumer: `carrier-bulletins.module.ts`, which hands in the forwarder's `forward`.
 */
export function createCarrierBulletinsRouter(
  dependencies: Pick<ShadowConnectorLane, 'forward'>,
): express.Router {
  return createLaneRouter({
    lane: 'carrier-bulletins',
    upstreamPrefix: UPSTREAM_PREFIX,
    pathRules: PATH_RULES,
    allowlist: ALLOWLIST,
    forward: dependencies.forward,
    image: { contentType: 'image/png', noun: 'a PNG', signature: PNG_SIGNATURE },
    passHeaders: PASSED_HEADERS,
  });
}
