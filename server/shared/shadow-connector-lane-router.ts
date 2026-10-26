import express from 'express';

import type { LaneAnswer, ShadowConnectorLane } from './shadow-connector-lane.js';

/**
 * The routes of a lane to shadow-connector — the one allowlist router every lane's routes file hands its
 * table to. Consumers: the `affected-areas` module (the Tours lane, `/api/affected-areas`) and the
 * `carrier-bulletins` module (the bulletins lane, `/api/carrier-bulletins`). Each module owns its table,
 * its id rules and its upstream prefix; this file owns what the two lanes would otherwise each write the
 * same way, so the rules below hold for both and cannot drift apart:
 *
 *  - A method-and-path pair that is not a row of the table never reaches shadow-connector: the lane answers
 *    its own 404, so the request is neither forwarded nor handed to the app's catch-all.
 *  - Every id and every query value is held to its rule BEFORE a byte leaves. A failure is the lane's own
 *    422 `{ error }`, and the id that failed is never put in a URL (the checked ids cannot add a segment, a
 *    dot or an escape, which is why filling them into the path is safe).
 *  - An upstream answer keeps its status and its JSON untouched; only the lane's own faults carry a body of
 *    the lane's making, and that is `{ error }`.
 *
 * Routes here validate and translate and do nothing else: no secret is read, no socket is opened. The
 * forwarder (`./shadow-connector-lane`) owns the one transport and the secret behind it.
 */

//----------------- THE CHECKS A LANE HOLDS EVERY ID TO ------------

/**
 * A check one id or one query value is held to before anything is forwarded. `expects` is the half of the
 * 422 sentence that follows the field's name: `<name> must be <expects>`. Consumers: the id tables of the
 * `affected-areas` and `carrier-bulletins` routes, and this file's router.
 */
export type LaneRule = { test: (value: string) => boolean; expects: string };

/** A rule that a value must match whole. Consumers: the `affected-areas` and `carrier-bulletins` routes, for each id shape they accept. */
export const patternRule = (regex: RegExp, expects: string): LaneRule => ({
  test: (value) => regex.test(value),
  expects,
});

/**
 * One lowercase hyphenated uuid, as regex source. Lowercase only: shadow-connector's own path patterns
 * hold ids in this one spelling, so an uppercase id is a 422 here rather than a request it would refuse.
 * Consumer: the `affected-areas` routes, which build a comma-joined list of them for `skip`.
 */
export const LOWERCASE_UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** A lowercase uuid. Consumers: the `affected-areas` routes (`region`, `read`) and the `carrier-bulletins` routes (`bulletin`). */
export const LOWERCASE_UUID_RULE: LaneRule = patternRule(new RegExp(`^${LOWERCASE_UUID_SOURCE}$`), 'a lowercase uuid');

/** The sha256 of a file's bytes: 64 lowercase hex characters. Consumers: the `affected-areas` routes (`/images/:sha`) and the `carrier-bulletins` routes (`/files/:sha/...`). */
export const SHA256_RULE: LaneRule = patternRule(/^[0-9a-f]{64}$/, '64 lowercase hex characters');

//----------------- THE TABLE A LANE DECLARES ------------

/**
 * The one image type a `bytes` answer may be: a 2xx whose Content-Type is anything else, or whose bytes do not
 * begin with `signature` (the format's magic number: `89504e470d0a1a0a` for a PNG, `ffd8ff` for a JPEG, `<svg` for
 * the day-one plan's drawing), is the lane's `unreadable`: the Content-Type is the engine's word and the bytes are
 * what would be cached for a year. `noun` ('a JPEG', 'a PNG', 'an SVG') is how the 502 sentence names what was expected.
 * Consumers: a lane's `image` (its default) and a `bytes` row's own `image`, which wins over it.
 */
export type LaneImage = { contentType: string; noun: string; signature: Buffer };

/**
 * One row of a lane's allowlist. Consumers: the `affected-areas` and `carrier-bulletins` routes, each of
 * which declares its whole contract as a list of these.
 */
export type LaneRoute = {
  method: 'get' | 'post' | 'put';
  /** The route in Express's own form; the upstream path is this with each `:name` filled by its checked id. */
  route: string;
  timeoutMs: number;
  expect: 'json' | 'bytes';
  /** Query keys that are forwarded, each with its rule. Any other key is dropped here, not forwarded. */
  query?: Record<string, LaneRule>;
  /** `object`: the request's JSON object is forwarded. `none`: the route reads no body and none is sent. */
  body: 'object' | 'none';
  /**
   * The image type THIS `bytes` row answers, for a lane that serves more than one (the Tours lane's views are JPEGs and
   * its plan drawings SVGs). It wins over the lane's `image`; a row that names none answers the lane's. Meaningless on a
   * `json` row.
   */
  image?: LaneImage;
};

/**
 * What a lane's routes file hands `createLaneRouter`. Consumers: `affected-areas.routes.ts` and
 * `carrier-bulletins.routes.ts`.
 */
export type LaneRouterDefinition = {
  /** The lane's name in its own 404 sentence: `not a route of the <lane> lane`. */
  lane: string;
  /** The prefix this lane serves, and the one shadow-connector serves the same surface under. */
  upstreamPrefix: string;
  /** The check for each `:name` an allowlisted route carries. A `:name` with no rule here is refused, never forwarded. */
  pathRules: Record<string, LaneRule>;
  allowlist: LaneRoute[];
  /** The forwarder's `forward`. */
  forward: ShadowConnectorLane['forward'];
  /**
   * The image type this lane's `bytes` routes answer unless a row names its own (`LaneRoute.image`): see `LaneImage`
   * for what a different Content-Type or signature makes of a 2xx.
   */
  image: LaneImage;
  /**
   * Upstream response headers a JSON answer carries back to the browser, named in lower case (the
   * forwarder's `LaneRequest.passHeaders`). Absent carries none, so a lane reads only what it names: the
   * bulletins lane names `x-left-out` (a carrier the overview could not list) and `cache-control`
   * (`no-store`: what Claude has read changes with every pull). Never the secret, never a `Set-Cookie`:
   * name a header only when this lane's view reads it or its caching depends on it.
   */
  passHeaders?: readonly string[];
};

//----------------- HOW A FAULT BECOMES A STATUS ------------

/**
 * How a lane fault becomes a status. An upstream answer keeps its own status; these are the faults that
 * are the lane's. Turning one into a 200 with an empty body would replace the one useful thing in the
 * answer — that nothing was read — with silence the screen would show as data.
 */
const STATUS_FOR_FAULT = {
  unreachable: 503,   // shadow-connector is down, refused the connection, or timed out
  unreadable: 502,    // it answered, and not with the JSON (or the image) the route promises
  no_secret: 503,     // this server could not read the internal secret, so nothing was sent
} as const;

/** What the browser may keep of an image for a year: the id IS the sha256 of the bytes, so it never changes. */
const IMAGE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

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
function refusalFor(spec: LaneRoute, pathRules: Record<string, LaneRule>, request: express.Request): string | null {
  for (const [name, value] of Object.entries(request.params)) {
    const rule = pathRules[name];
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
function forwardedQuery(spec: LaneRoute, request: express.Request): Record<string, string> {
  const query: Record<string, string> = {};
  for (const name of Object.keys(spec.query ?? {})) {
    const value = request.query[name];
    if (typeof value === 'string') query[name] = value;
  }
  return query;
}

/**
 * One answer, written. An upstream answer keeps its status and its JSON untouched — the lane never
 * reshapes a body, so the browser reads exactly what the engine wrote — and carries back the headers
 * the lane named (`passHeaders`), none otherwise. A 2xx image is relayed as bytes, under the one type
 * the route expects (its row's own `image`, else the lane's) and a year's cache (it is keyed by the sha256 of what it shows).
 */
function emit(response: express.Response, answer: LaneAnswer, image: LaneImage): void {
  if (!answer.ok) {
    response.status(STATUS_FOR_FAULT[answer.reason]).json({ error: answer.message });
    return;
  }
  if (answer.kind === 'json') {
    response.status(answer.status).set(answer.headers).json(answer.body);
    return;
  }
  // An image route that answers 2xx with anything but the expected type, or with bytes that are not that
  // format (an error page stamped `image/png`), is a server this lane has no word for: nothing is cached.
  if (
    !answer.contentType.toLowerCase().startsWith(image.contentType) ||
    !answer.body.subarray(0, image.signature.length).equals(image.signature)
  ) {
    response.status(STATUS_FOR_FAULT.unreadable).json({ error: `shadow-connector did not answer with ${image.noun}` });
    return;
  }
  response
    .status(answer.status)
    .set({ 'Content-Type': image.contentType, 'Cache-Control': IMAGE_CACHE_CONTROL })
    .send(answer.body);
}

//----------------- THE ROUTER ------------

/**
 * Builds a lane's router from its table. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * Every row becomes one handler: check, fill the path, forward, write the answer. Then two tails, in
 * order: the lane's own 404 for every other path under the mount, and the 422 for a malformed escape.
 * Consumers: `createAffectedAreasRouter` and `createCarrierBulletinsRouter`.
 */
export function createLaneRouter({
  lane,
  upstreamPrefix,
  pathRules,
  allowlist,
  forward,
  image,
  passHeaders,
}: LaneRouterDefinition): express.Router {
  const router = express.Router();

  for (const spec of allowlist) {
    router[spec.method](spec.route, async (request, response, next) => {
      try {
        const refusal = refusalFor(spec, pathRules, request);
        if (refusal !== null) {
          response.status(422).json({ error: refusal });
          return;
        }
        // The ids passed their rules, so filling them in cannot add a segment, a dot or an escape.
        const path = spec.route.replace(/:(\w+)/g, (_match, name: string) => String(request.params[name]));
        emit(
          response,
          await forward({
            method: spec.method.toUpperCase() as 'GET' | 'POST' | 'PUT',
            path: `${upstreamPrefix}${path}`,
            query: forwardedQuery(spec, request),
            body: spec.body === 'object' ? request.body : undefined,
            actingUser: actingUserOf(request),
            timeoutMs: spec.timeoutMs,
            expect: spec.expect,
            passHeaders,
          }),
          spec.image ?? image,
        );
      } catch (error) {
        // The forwarder resolves every fault it can name, so reaching here means something this lane
        // has no word for. It belongs to the app's error handler, not to a body of our own.
        next(error);
      }
    });
  }

  // Everything else under the mount: the lane's own 404, so a path outside the allowlist is answered
  // here and never reaches shadow-connector, and never falls through to the app's catch-all.
  router.use((_request, response) => {
    response.status(404).json({ error: `not a route of the ${lane} lane` });
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
