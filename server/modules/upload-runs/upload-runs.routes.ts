import type express from 'express';

import type { ShadowConnectorLane } from '@/shared/shadow-connector-lane.js';
import { LOWERCASE_UUID_RULE, createLaneRouter, patternRule } from '@/shared/shadow-connector-lane-router.js';
import type { LaneRoute, LaneRule } from '@/shared/shadow-connector-lane-router.js';

/** The prefix this lane serves is `/api/upload-runs`; shadow-connector serves the same surface under this one. */
const UPSTREAM_PREFIX = '/api/upload-agent-runs';

// The reads are a database's: the overview folds a window of up to 90 days of runs with their walks, and a run
// whole reads its walks, confirmations and presses. Room for that, no more.
const READ_TIMEOUT_MS = 30_000;
// A stream's bound is its connect. The engine answers a feed at once and a run's stream with its replay; once a
// stream is open nothing bounds it, and the engine's own 15 s keepalive is what tells a dead one from a quiet one.
const STREAM_CONNECT_TIMEOUT_MS = 10_000;

/** A run's id as the registry mints it (`uuid4().hex[:12]`): 12 lowercase hex characters, in this one spelling. */
const SID_RULE: LaneRule = patternRule(/^[0-9a-f]{12}$/, '12 lowercase hex characters');

/** The ids a path may carry. */
const PATH_RULES: Record<string, LaneRule> = { sid: SID_RULE };

/** The windows the overview offers. */
const DAYS_RULE: LaneRule = patternRule(/^(?:7|30|90)$/, 'one of 7, 30, 90');

/** A switch, spelled the engine's way: `0` or `1`. */
const FLAG_RULE: LaneRule = patternRule(/^[01]$/, '0 or 1');

/** Who pressed, as the launch door stamps it: `<kind>:<who>` (`eis:<login>`, `operator:probe`), one token with no whitespace. */
const PRESSER_RULE: LaneRule = patternRule(/^[a-z_]+:[^\s]{1,160}$/, 'a stamp such as eis:<login>, with no whitespace');

/**
 * A sequence number or a page size: digits only, no sign and no blank. The engine owns the bounds (a `seq` up to
 * 2^31-1, a page of 1 to 1000) and answers a number past them with its own 422; the lane only keeps the value
 * from becoming anything but a number in the URL.
 */
const WHOLE_NUMBER_RULE: LaneRule = patternRule(/^\d{1,10}$/, 'a whole number');

/**
 * THE ALLOWLIST: the five routes of the run record, GET only, because the view takes no action — no verb here
 * writes, launches, stops or answers a run. Two rows are event streams (`/feed` and a live run's own), which the
 * lane relays as they arrive. A method-and-path pair that is not a row here never reaches shadow-connector: the
 * lane answers its own 404.
 */
const ALLOWLIST: LaneRoute[] = [
  { method: 'get', route: '/overview', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'none',
    query: { days: DAYS_RULE, by: PRESSER_RULE, tests: FLAG_RULE, account: LOWERCASE_UUID_RULE } },
  { method: 'get', route: '/feed', timeoutMs: STREAM_CONNECT_TIMEOUT_MS, expect: 'stream', body: 'none' },
  { method: 'get', route: '/runs/:sid', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'none' },
  { method: 'get', route: '/runs/:sid/events', timeoutMs: READ_TIMEOUT_MS, expect: 'json', body: 'none',
    query: { after: WHOLE_NUMBER_RULE, limit: WHOLE_NUMBER_RULE } },
  { method: 'get', route: '/runs/:sid/stream', timeoutMs: STREAM_CONNECT_TIMEOUT_MS, expect: 'stream', body: 'none',
    query: { from: WHOLE_NUMBER_RULE } },
];

/**
 * The upload runs lane's routes. Auth is the mount's `authenticateToken`, in `server/index.ts`; an `EventSource`
 * carries the token as `?token=`, which the mount reads and this lane never forwards (it is no row's query key).
 *
 * This file declares the lane — its five rows, its id shape — and the shared router
 * (`@/shared/shadow-connector-lane-router`) validates, translates and answers: a bad id or value is the lane's
 * 422, any other path its 404, an upstream answer passes through with its status and JSON untouched, and an
 * event stream is relayed as it arrives. The lane serves no image, so it names no image type.
 *
 * Consumer: `upload-runs.module.ts`, which hands in the forwarder's `forward` and `stream`.
 */
export function createUploadRunsRouter(
  dependencies: Pick<ShadowConnectorLane, 'forward' | 'stream'>,
): express.Router {
  return createLaneRouter({
    lane: 'upload-runs',
    upstreamPrefix: UPSTREAM_PREFIX,
    pathRules: PATH_RULES,
    allowlist: ALLOWLIST,
    forward: dependencies.forward,
    stream: dependencies.stream,
  });
}
