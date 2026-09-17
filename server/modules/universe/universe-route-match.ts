/**
 * Which star a served request pulses: a method and a path turned into the node of the file that
 * declares the route.
 *
 * This lives here and NOT in the crawler (which dumps the route table) because matching is a
 * RUNTIME concern: it runs on up to 164k journal lines a day, inside a Node child that cannot call
 * Python. The crawler would have to answer "which route is this request" for every future request,
 * which it cannot — it only ever sees its own dump. Two implementations of one tie-breaking rule is
 * drift with a lit fuse, so there is one, and it is this file.
 */

/**
 * One route as the crawler wrote it: method, path pattern, and the node of the file that declares
 * it. Structural, not nominal, because it is also what `UniverseMap['routes']` holds.
 */
export type RouteEntry = { m: string; p: string; n: number };

/**
 * A request or route path in segments, with the query string and empty segments gone.
 *
 * The query is dropped before the split, never after: `/api/memory?status=pending` and
 * `/api/memory?page=2` are one route, and a segment count that included the query would match
 * neither.
 */
function segmentsOf(value: string): string[] {
  const query = value.indexOf('?');
  const bare = query === -1 ? value : value.slice(0, query);
  return bare.split('/').filter((segment) => segment !== '');
}

/** A `{param}` segment: it matches any one segment and never counts as a literal. */
function isParam(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}');
}

/**
 * The node index of the route a request was served by, or `null` when no route fits it.
 *
 * Among routes of the same method and the same segment count, the one with the MOST literal
 * segments matching wins — so `/api/eis/jobs/summary` beats `/api/eis/jobs/{id}` and a summary
 * request pulses the file that declares the summary, not the file that declares the detail route.
 * A `{param}` matches anything and loses every tie it is in, which is what makes that ordering
 * total rather than merely likely.
 *
 * Equal scores are broken by the crawler's own order — the first candidate wins — because the
 * route table is the crawler's and nothing here has a better claim on which of two equals is meant.
 * Comparison is case-insensitive on the method (uvicorn logs `POST`, the dump holds `POST`) and
 * exact on the path segments, which is what HTTP path matching is.
 */
export function matchPath(routes: readonly RouteEntry[], method: string, path: string): number | null {
  const wanted = segmentsOf(path);
  const wantedMethod = method.toUpperCase();

  let best: number | null = null;
  let bestLiterals = -1;

  for (const route of routes) {
    if (route.m.toUpperCase() !== wantedMethod) continue;

    const pattern = segmentsOf(route.p);
    if (pattern.length !== wanted.length) continue;

    let literals = 0;
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (isParam(pattern[index])) continue;
      if (pattern[index] !== wanted[index]) {
        matched = false;
        break;
      }
      literals += 1;
    }
    if (!matched) continue;

    if (literals > bestLiterals) {
      bestLiterals = literals;
      best = route.n;
    }
  }

  return best;
}
