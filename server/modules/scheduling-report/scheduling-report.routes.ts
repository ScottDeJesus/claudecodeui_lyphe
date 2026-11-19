import type express from 'express';

import type { ShadowConnectorLane } from '@/shared/shadow-connector-lane.js';
import { LOWERCASE_UUID_RULE, createLaneRouter, patternRule } from '@/shared/shadow-connector-lane-router.js';
import type { LaneRoute, LaneRule } from '@/shared/shadow-connector-lane-router.js';

/** The prefix this lane serves is `/api/scheduling-report`; the eis backend (:8004) serves the same surface under this one. */
const UPSTREAM_PREFIX = '/api/eis/internal/scheduling-report';

// The reads are a database's — the overview folds up to 90 days of acts and sessions into entries with their
// verdicts, and an entry whole reads its acts and the visit as it stands. Room for that, no more.
const READ_TIMEOUT_MS = 30_000;
// A stream's bound is its connect; the backend answers the feed at once; once it is open nothing bounds it, and
// the backend's own keepalive comment is what tells a dead stream from a quiet one.
const STREAM_CONNECT_TIMEOUT_MS = 10_000;

/** An entry's id is the form's session id (minted by the browser) or a direct act's id, both lowercase uuids. */
const PATH_RULES: Record<string, LaneRule> = { id: LOWERCASE_UUID_RULE };

/** The windows the overview offers. */
const DAYS_RULE: LaneRule = patternRule(/^(?:7|30|90)$/, 'one of 7, 30, 90');

/** A switch, spelled the backend's way. */
const FLAG_RULE: LaneRule = patternRule(/^[01]$/, '0 or 1');

/** Who pressed, as the recorder stamps it (`eis:<login>`), one token with no whitespace. */
const ACTOR_RULE: LaneRule = patternRule(/^[a-z_]+:[^\s]{1,160}$/, 'a stamp such as eis:<login>, with no whitespace');

/**
 * THE ALLOWLIST: the three routes of the scheduling report, GET only, because the view takes no action — no verb
 * here books, edits or cancels a visit. The feed is an event stream relayed as it arrives. A method-and-path pair
 * that is not a row here never reaches the backend: the lane answers its own 404.
 */
const ALLOWLIST: LaneRoute[] = [
  { method: 'get', route: '/overview', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'none',
    query: { days: DAYS_RULE, by: ACTOR_RULE, machines: FLAG_RULE, account: LOWERCASE_UUID_RULE } },
  { method: 'get', route: '/entries/:id', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'get', route: '/feed', timeoutMs: STREAM_CONNECT_TIMEOUT_MS, expect: 'stream', body: 'none',
    query: { account: LOWERCASE_UUID_RULE } },
];

/**
 * The scheduling report lane's routes. Auth is the mount's `authenticateToken`, in `server/index.ts`; an `EventSource`
 * carries the token as `?token=`, which the mount reads and this lane never forwards (it is no row's query key).
 *
 * This file declares the lane — three rows, its id shape — and the shared router
 * (`@/shared/shadow-connector-lane-router`) validates, translates and answers: a bad id or value is the lane's
 * 422, any other path its 404, an upstream answer passes through with its status and JSON untouched, and the feed
 * is relayed as it arrives. The lane serves no image, so it names no image type.
 *
 * Consumer: `scheduling-report.module.ts`, which hands in the forwarder's `forward` and `stream`.
 */
export function createSchedulingReportRouter(
  dependencies: Pick<ShadowConnectorLane, 'forward' | 'stream'>,
): express.Router {
  return createLaneRouter({
    lane: 'scheduling-report',
    upstreamPrefix: UPSTREAM_PREFIX,
    pathRules: PATH_RULES,
    allowlist: ALLOWLIST,
    forward: dependencies.forward,
    stream: dependencies.stream,
  });
}
