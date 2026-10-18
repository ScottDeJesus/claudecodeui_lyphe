import express from 'express';

import type { AffectedAreasService, LaneAnswer } from './affected-areas.service.js';

/** The prefix this lane serves, and the one shadow-connector serves the same surface under. */
const UPSTREAM_PREFIX = '/api/affected-areas';

const LANE_TIMEOUT_MS = 20_000;
const VIEWS_TIMEOUT_MS = 90_000;
const READ_TIMEOUT_MS = 120_000;

/** What the browser may keep of an image for a year: the id IS the sha256 of the bytes, so it never changes. */
const IMAGE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/**
 * A check one id or one query value is held to before a byte leaves for shadow-connector. `expects` is
 * the half of the 422 sentence after the field's name.
 */
type Rule = { test: (value: string) => boolean; expects: string };

const pattern = (regex: RegExp, expects: string): Rule => ({ test: (value) => regex.test(value), expects });

const wholeNumber = (min: number, max: number): Rule => ({
  test: (value) => /^\d{1,4}$/.test(value) && Number(value) >= min && Number(value) <= max,
  expects: `a whole number from ${min} to ${max}`,
});

const oneOf = (...allowed: string[]): Rule => ({
  test: (value) => allowed.includes(value),
  expects: `one of ${allowed.join(', ')}`,
});

/** The ids a path may carry. The hex ids are lowercase only, as shadow-connector's own `routes/ids.py` holds them; a uuid is accepted in either case. */
const PATH_RULES: Record<string, Rule> = {
  tour: pattern(/^[0-9a-f]{24}$/, '24 lowercase hex characters'),
  pano: pattern(/^[0-9a-f]{24}$/, '24 lowercase hex characters'),
  sha: pattern(/^[0-9a-f]{64}$/, '64 lowercase hex characters'),
  region: pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'a uuid'),
  read: pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'a uuid'),
  class: pattern(/^[a-z_]{2,40}$/, '2 to 40 lowercase letters or underscores'),
};

const CLASS_RULE = PATH_RULES.class;
// A model name, a codebook version or a contract hash: one token, not a sentence.
const TOKEN_RULE = pattern(/^[\w.:-]{1,80}$/, 'one token of at most 80 characters');

type AllowedRoute = {
  method: 'get' | 'post' | 'put';
  /** The route in Express's own form; the upstream path is this with each `:name` filled by its checked id. */
  route: string;
  timeoutMs: number;
  expect: 'json' | 'bytes';
  /** Query keys that are forwarded, each with its rule. Any other key is dropped here, not forwarded. */
  query?: Record<string, Rule>;
  /** `object`: the request's JSON object is forwarded. `none`: the route reads no body and none is sent. */
  body: 'object' | 'none';
};

/**
 * THE ALLOWLIST. A method-and-path pair that is not a row here never reaches shadow-connector: the lane
 * answers its own 404.
 */
const ALLOWLIST: AllowedRoute[] = [
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
    query: { mode: oneOf('unsure', 'random'), class: CLASS_RULE, limit: wholeNumber(1, 50) } },
  { method: 'get', route: '/proving', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'none',
    query: { model: TOKEN_RULE, contract: TOKEN_RULE } },
  { method: 'put', route: '/thresholds/:class', timeoutMs: LANE_TIMEOUT_MS, expect: 'json', body: 'object' },
];

/**
 * How a lane fault becomes a status. An upstream answer keeps its own status; these are the faults that
 * are the lane's. Turning one into a 200 with an empty body would replace the one useful thing in the
 * answer — that nothing was read — with silence the screen would show as data.
 */
const STATUS_FOR_FAULT = {
  unreachable: 503,   // shadow-connector is down, refused the connection, or timed out
  unreadable: 502,    // it answered, and not with the JSON the route promises
  no_secret: 503,     // this server could not read the internal secret, so nothing was sent
} as const;

type AuthenticatedRequest = express.Request & { user?: { username?: unknown } };

/** The signed-in operator's name (the mount's `authenticateToken` put it on the request), or null. */
function actingUserOf(request: express.Request): string | null {
  const username = (request as AuthenticatedRequest).user?.username;
  return typeof username === 'string' && username !== '' ? username : null;
}

/**
 * The sentence for the first id or query value that fails its rule, or null when all pass. This runs
 * before anything is forwarded: a bad id is a 422 here and never a request.
 */
function refusalFor(spec: AllowedRoute, request: express.Request): string | null {
  for (const [name, value] of Object.entries(request.params)) {
    const rule = PATH_RULES[name];
    if (!rule || typeof value !== 'string' || !rule.test(value)) return `${name} must be ${rule?.expects ?? 'a known id'}`;
  }
  for (const [name, rule] of Object.entries(spec.query ?? {})) {
    const value = request.query[name];
    if (value === undefined) continue;
    // `?q=a&q=b` and `?q[x]=1` arrive as an array or a dictionary: not one value, so not a value at all.
    if (typeof value !== 'string' || !rule.test(value)) return `${name} must be ${rule.expects}`;
  }
  const body: unknown = request.body;
  if (spec.body === 'object' && (typeof body !== 'object' || body === null || Array.isArray(body))) {
    return 'the request body must be a JSON object';
  }
  return null;
}

/** The query that is forwarded: the allowlisted keys that were named, and nothing the caller invented. */
function forwardedQuery(spec: AllowedRoute, request: express.Request): Record<string, string> {
  const query: Record<string, string> = {};
  for (const name of Object.keys(spec.query ?? {})) {
    const value = request.query[name];
    if (typeof value === 'string') query[name] = value;
  }
  return query;
}

/**
 * One answer, written. An upstream answer keeps its status and its JSON untouched — the lane never
 * reshapes a body, so the browser reads exactly what the engine wrote. Only the lane's own faults carry
 * a body of the lane's making, and that is `{ error }`.
 */
function emit(response: express.Response, answer: LaneAnswer): void {
  if (!answer.ok) {
    response.status(STATUS_FOR_FAULT[answer.reason]).json({ error: answer.message });
    return;
  }
  if (answer.kind === 'json') {
    response.status(answer.status).json(answer.body);
    return;
  }
  // An image route that answers 2xx with anything but a JPEG is a server this lane has no word for.
  if (!answer.contentType.toLowerCase().startsWith('image/jpeg')) {
    response.status(STATUS_FOR_FAULT.unreadable).json({ error: 'shadow-connector did not answer with a JPEG' });
    return;
  }
  response
    .status(answer.status)
    .set({ 'Content-Type': 'image/jpeg', 'Cache-Control': IMAGE_CACHE_CONTROL })
    .send(answer.body);
}

/**
 * The affected-areas lane's routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers validate and translate, and do nothing else: no secret is read here, no socket is
 * opened here, and no route hands shadow-connector an id it did not first hold to its shape. The
 * service owns the one transport, and the secret behind it.
 *
 * Consumer: `affected-areas.module.ts`, which hands in the service's `forward`.
 */
export function createAffectedAreasRouter(
  dependencies: Pick<AffectedAreasService, 'forward'>,
): express.Router {
  const router = express.Router();

  for (const spec of ALLOWLIST) {
    router[spec.method](spec.route, async (request, response, next) => {
      try {
        const refusal = refusalFor(spec, request);
        if (refusal !== null) {
          response.status(422).json({ error: refusal });
          return;
        }
        // The ids passed their rules, so filling them in cannot add a segment, a dot or an escape.
        const path = spec.route.replace(/:(\w+)/g, (_match, name: string) => String(request.params[name]));
        emit(response, await dependencies.forward({
          method: spec.method.toUpperCase() as 'GET' | 'POST' | 'PUT',
          path: `${UPSTREAM_PREFIX}${path}`,
          query: forwardedQuery(spec, request),
          body: spec.body === 'object' ? request.body : undefined,
          actingUser: actingUserOf(request),
          timeoutMs: spec.timeoutMs,
          expect: spec.expect,
        }));
      } catch (error) {
        // The service resolves every fault it can name, so reaching here means something this lane
        // has no word for. It belongs to the app's error handler, not to a body of our own.
        next(error);
      }
    });
  }

  // Everything else under the mount: the lane's own 404, so a path outside the allowlist is answered
  // here and never reaches shadow-connector, and never falls through to the app's catch-all.
  router.use((_request, response) => {
    response.status(404).json({ error: 'not a route of the affected-areas lane' });
  });

  // Express decodes a path id before any handler runs, and a malformed escape (`%ZZ`) throws there. It
  // is a bad id like any other: the lane's 422, with nothing forwarded. Anything else is not this lane's.
  router.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (error instanceof URIError) {
      response.status(422).json({ error: 'the path holds a malformed percent-escape' });
      return;
    }
    next(error);
  });

  return router;
}
