import { BUDGET_HEADER } from './gemini-budget-relay.js';

/**
 * What a call to shadow-connector carries out and what its failure says — the part of the lane that its two
 * modes, `forward` (a JSON or image answer) and `stream` (an event stream), would otherwise each write. They
 * share it so a header, the way a URL is built and a failure's sentence cannot drift between them.
 * Consumers: `shadow-connector-lane.ts` (the forwarder, which also owns the one read of the secret) and
 * `shadow-connector-lane-stream.ts` (the event-stream transport).
 *
 * The secret is only ever a PARAMETER here: it is read in `shadow-connector-lane.ts` and nowhere else
 * (INV-8633), and handed to the one function below that puts it on a request.
 */

/** The one sentence a missing, unreadable or unusable secret earns. The cause goes to the server log. */
export const NO_SECRET_MESSAGE = "CloudCLI could not read shadow-connector's internal secret";

/** The header shadow-connector's gate reads (`core/capabilities/_auth.py`). */
const SECRET_HEADER = 'X-Internal-Secret';

/** Display only: shadow-connector derives `origin` from the channel itself (R-CAP-21). */
const ACTING_USER_HEADER = 'X-Acting-User';
const ACTING_USER_MAX_CHARS = 64;

/** Everything outside printable ASCII, for the acting user's header. */
const NOT_PRINTABLE_ASCII = /[^\x20-\x7e]/g;

/** A header value shadow-connector can read: printable ASCII only, trimmed, bounded. Null when nothing is left. */
function sanitiseActingUser(actingUser: string | null): string | null {
  if (actingUser === null) return null;
  const clean = actingUser.replace(NOT_PRINTABLE_ASCII, '?').trim().slice(0, ACTING_USER_MAX_CHARS).trim();
  return clean === '' ? null : clean;
}

/**
 * The headers every call to shadow-connector carries: the secret, what it accepts back, who is acting
 * (display only) and the Gemini budget (from `relayBudgetOf`; null carries none). Consumers: `forward` and
 * `stream`, each of which adds the headers only its own mode needs (a body's Content-Type, a `Last-Event-ID`).
 */
export function laneHeaders(
  secret: string,
  accept: string,
  call: { actingUser: string | null; budget: string | null },
): Record<string, string> {
  const headers: Record<string, string> = { [SECRET_HEADER]: secret, Accept: accept };
  const actingUser = sanitiseActingUser(call.actingUser);
  if (actingUser !== null) headers[ACTING_USER_HEADER] = actingUser;
  if (call.budget !== null) headers[BUDGET_HEADER] = call.budget;
  return headers;
}

/**
 * The upstream URL: the lane's origin and an absolute path the route already validated, with the query set
 * through `searchParams` so a value is escaped and cannot add a key. Throws on an origin that is not a URL,
 * so a caller builds it inside the try that turns a throw into an `unreachable` answer.
 * Consumers: `forward` and `stream`.
 */
export function upstreamUrl(origin: string, path: string, query: Record<string, string> | undefined): URL {
  const url = new URL(`${origin}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url;
}

/**
 * A sentence for a request that never got an answer. Only the error's NAME and its cause's CODE are
 * used, never its message: a transport error can quote the request, and the request carries the secret.
 * Consumers: `forward` and `stream`.
 */
export function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `shadow-connector did not answer within ${timeoutMs / 1000} s`;
  }
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return `CloudCLI could not reach shadow-connector${typeof code === 'string' ? ` (${code})` : ''}`;
}
