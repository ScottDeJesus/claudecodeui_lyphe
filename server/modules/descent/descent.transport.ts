/**
 * The lane-independent Descent layer: the wire, the three failure words, and
 * the one payload reader both the accounts and memory lanes share.
 * `readNumberOrNull`, `readFlag` and `readRecord` do NOT live here — each has
 * one consumer, the accounts mapper, and stays in `descent.service.ts`.
 */

/**
 * Why one Descent call could not be answered. These three words are the ONLY
 * thing this proxy ever says about a failure: never Descent's body, never a
 * stack, never a URL, never a filesystem path, never a token byte.
 */
export type DescentFailureReason = 'unreachable' | 'timeout' | 'bad-response';

export type DescentServiceDependencies = {
  /** Descent's origin, e.g. `http://127.0.0.1:7878`; a trailing slash is tolerated. */
  baseUrl: string;
  /** Injected so a probe can point the service at a closed port without touching the real one. */
  fetchImpl: typeof fetch;
  /** Wall-clock ceiling for one call. Must stay well under the client's poll interval. */
  timeoutMs: number;
};

/**
 * Thrown by the WRITE verbs (`switchAccount`, `capture`) when Descent never
 * answered, or answered with something that is not JSON — in either case there
 * is no status of Descent's to pass through. `descent.routes.ts` is the only
 * consumer: it turns this into a 503 carrying nothing but `reason`.
 *
 * Reads never throw. An unknown account picture is a calm 200
 * `{reachable:false, reason}` (Descent GOTCHAS #176), never a 5xx.
 */
export class DescentUnreachable extends Error {
  readonly reason: DescentFailureReason;

  constructor(reason: DescentFailureReason) {
    super(`Descent is not reachable (${reason})`);
    this.name = 'DescentUnreachable';
    this.reason = reason;
  }
}

/** A non-empty string, or `null` — Descent itself sends `null` for a label it cannot read. */
export function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The `name` of a thrown value without assuming it is an `Error` (undici throws DOMExceptions). */
function readThrownName(value: unknown): string {
  const named = value as { name?: unknown; cause?: unknown } | null;
  return typeof named?.name === 'string' ? named.name : '';
}

/**
 * Names a fetch failure in one word. A timeout is the abort our own
 * `AbortSignal.timeout` raised — undici surfaces it as a `TimeoutError`, either
 * directly or wrapped as the `cause` of a `TypeError: fetch failed`. Everything
 * else a socket can do (connection refused, DNS, reset) is `unreachable`.
 *
 * The signal covers the BODY as well as the headers, so a read that stalls
 * mid-stream aborts here too — hence `fallback`, which lets the body-reading
 * catch keep `bad-response` for a genuine parse failure while still naming a
 * timeout a timeout.
 */
function classifyFetchFailure(
  error: unknown,
  fallback: DescentFailureReason = 'unreachable',
): DescentFailureReason {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return readThrownName(error) === 'TimeoutError' || readThrownName(cause) === 'TimeoutError'
    ? 'timeout'
    : fallback;
}

/**
 * Builds the Descent proxy used by `descent.module.ts` and by the down-path
 * probe, which constructs it against a closed port.
 *
 * Nothing here caches: Descent already does, and a second cache would age its
 * figures a second time. Nothing here opens a credential file either — the
 * whole account picture arrives over HTTP, and token bytes never enter this
 * process (Descent GOTCHAS #172).
 */
export function createDescentTransport(dependencies: DescentServiceDependencies) {
  const origin = dependencies.baseUrl.replace(/\/$/, '');

  /**
   * GETs one Descent path. A non-2xx is NOT special-cased: such a body fails the
   * mapper's `ok` gate and carries no `accounts`/`usage` key either, so the
   * caller says `bad-response` — one path for "Descent answered with no picture".
   */
  async function readJson(path: string): Promise<{ body: unknown } | { failure: DescentFailureReason }> {
    let response: Response;
    try {
      response = await dependencies.fetchImpl(`${origin}${path}`, {
        signal: AbortSignal.timeout(dependencies.timeoutMs),
      });
    } catch (error) {
      return { failure: classifyFetchFailure(error) };
    }

    try {
      return { body: await response.json() };
    } catch (error) {
      // Headers arrived, so this is a body that could not be read — a parse
      // failure, or the timeout firing while the body was still streaming.
      return { failure: classifyFetchFailure(error, 'bad-response') };
    }
  }

  /** POSTs one Descent path and hands back Descent's OWN status and body, untouched. */
  async function writeJson(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await dependencies.fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(dependencies.timeoutMs),
      });
    } catch (error) {
      throw new DescentUnreachable(classifyFetchFailure(error));
    }

    try {
      return { status: response.status, body: await response.json() };
    } catch (error) {
      // Descent answered, but with no JSON body to pass through — there is
      // nothing to forward, so this is a failure to reach it, not its verdict.
      throw new DescentUnreachable(classifyFetchFailure(error, 'bad-response'));
    }
  }

  return { readJson, writeJson };
}

export type DescentTransport = ReturnType<typeof createDescentTransport>;
