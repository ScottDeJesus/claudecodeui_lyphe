import fs from 'node:fs/promises';

/**
 * Relaying a request to shadow-connector's internal-caller-gated surface — the one forwarder every
 * lane to shadow-connector goes through. Consumers: the `affected-areas` module (the Tours lane,
 * `/api/affected-areas`) and the `carrier-bulletins` module (the bulletins lane,
 * `/api/carrier-bulletins`, the second lane to shadow-connector). Each module owns its allowlist and
 * its status mapping; this file owns the transport and the secret behind it, so there is one copy of
 * both.
 *
 * This server keeps no view of what shadow-connector answers and never opens its disk or database: it
 * makes the HTTP call and carries the answer back, so a lane keeps working the day this server leaves
 * the host the engine runs on.
 *
 * The surface is internal-caller gated (R-CAP-11) — it demands `X-Internal-Secret` even from loopback —
 * and the browser never holds that value. This file is the one place it is read, and the read has
 * three rules that all come from the same reason, which is that a copy is a second home:
 *
 *  - It is read from shadow-connector's own env file, at CALL time. It is never copied into this
 *    server's `.env` or `process.env` (a copy drifts when the secret is rotated, and the agent sessions
 *    this server spawns inherit its environment), and never written to a log.
 *  - A `fs.stat` runs on every call and the file is re-parsed only when it changed, so a rotation is
 *    picked up by the next request with no restart and no watcher.
 *  - Nothing is forwarded without it: a missing secret answers `no_secret` rather than sending a
 *    request that the gate would refuse with a 403 the panel could not tell from a wrong id.
 *
 * Nothing here throws. A lane fault is a RESULT, in the shape of the Jev and heal lanes, so the route
 * can choose the status; an upstream answer — a 404, a 422, a refusal — is a RESULT too, carried whole.
 */

/** The one sentence a missing, unreadable or unusable secret earns. The cause goes to the server log. */
const NO_SECRET_MESSAGE = "CloudCLI could not read shadow-connector's internal secret";

/** The header shadow-connector's gate reads (`core/capabilities/_auth.py`). */
const SECRET_HEADER = 'X-Internal-Secret';

/** Display only: shadow-connector derives `origin` from the channel itself (R-CAP-21). */
const ACTING_USER_HEADER = 'X-Acting-User';
const ACTING_USER_MAX_CHARS = 64;

/**
 * The line this lane is after. `export ` is allowed because a `.env` is often sourced by a shell too;
 * the last matching line wins, as it does for the dotenv loader shadow-connector starts with.
 */
const SECRET_LINE = /^\s*(?:export\s+)?EIS_INTERNAL_SECRET\s*=(.*)$/;

/**
 * What a usable secret looks like: printable ASCII with no whitespace at either end (R-CAP-11). The
 * gate compares BYTES — a non-ASCII secret can never match, because Starlette decodes the header as
 * latin-1 and the gate encodes as UTF-8 — and an HTTP stack trims a header value's edges, so a padded
 * secret sent as-is arrives as a different string. Either way the honest answer is "no secret", not a
 * request that is certain to be refused.
 */
const USABLE_SECRET = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

/** Everything outside printable ASCII, for the acting user's header. */
const NOT_PRINTABLE_ASCII = /[^\x20-\x7e]/g;

/**
 * One forwarded call. Consumers: the routes of the `affected-areas` and `carrier-bulletins` modules,
 * each of which builds it from a request it has validated against its own allowlist.
 */
export type LaneRequest = {
  method: 'GET' | 'POST' | 'PUT';
  /** Absolute upstream path, already validated by the route that built it. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** The signed-in operator's name, or null when the request carried none. */
  actingUser: string | null;
  timeoutMs: number;
  /** What a 2xx answer carries: a JSON document, or the bytes of an image. */
  expect: 'json' | 'bytes';
};

/**
 * What a forwarded call came back as: the engine's own answer, or why the lane has none. Consumers: the
 * routes of the `affected-areas` and `carrier-bulletins` modules, which turn it into a response.
 *
 * Why a question went unanswered by the lane itself:
 *
 *  - `unreachable`  shadow-connector never answered: down, refused the connection, or past the timeout.
 *  - `unreadable`   it answered, and not with the JSON this route promises.
 *  - `no_secret`    the internal secret could not be read, so nothing was sent.
 */
export type LaneAnswer =
  | { ok: true; status: number; kind: 'json'; body: unknown }
  | { ok: true; status: number; kind: 'bytes'; body: Buffer; contentType: string }
  | { ok: false; reason: 'unreachable' | 'unreadable' | 'no_secret'; message: string };

/**
 * What a module hands `createShadowConnectorLane`. Consumers: `affected-areas.module.ts` and the
 * `carrier-bulletins` module, each the one place its own lane reads the environment.
 */
export type ShadowConnectorLaneDependencies = {
  /** shadow-connector's origin, e.g. `http://127.0.0.1:8001`. */
  baseUrl: string;
  /** The env file that holds `EIS_INTERNAL_SECRET=`, shadow-connector's own. */
  envFile: string;
  /** The one word that names the lane in its log warning, e.g. `affected-areas`: `[<label>] no usable internal secret …`. */
  label: string;
};

/**
 * The lane's one verb. Consumers: the `affected-areas` and `carrier-bulletins` modules (each builds
 * one) and their routes (each calls `forward`).
 */
export type ShadowConnectorLane = {
  forward(request: LaneRequest): Promise<LaneAnswer>;
};

/**
 * The secret out of an env file's text, or null when it names none this lane can use.
 *
 * A quoted value is whatever stands between its quotes, kept verbatim; only whitespace or a `# comment`
 * may follow the closing quote, and a quote that never closes names no secret. An unquoted value loses a
 * trailing ` # comment` and its edge whitespace. Both are the way the dotenv loader reads the same line.
 */
function parseSecret(envText: string): string | null {
  let raw: string | null = null;
  for (const line of envText.split(/\r?\n/)) {
    const match = SECRET_LINE.exec(line);
    if (match) raw = match[1];
  }
  if (raw === null) return null;

  let value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closing = value.indexOf(quote, 1);
    if (closing === -1 || !/^\s*(?:#.*)?$/.test(value.slice(closing + 1))) return null;
    value = value.slice(1, closing);
  } else {
    const comment = value.search(/\s#/);
    if (comment !== -1) value = value.slice(0, comment).trimEnd();
  }
  return USABLE_SECRET.test(value) ? value : null;
}

/** A header value shadow-connector can read: printable ASCII only, trimmed, bounded. Null when nothing is left. */
function sanitiseActingUser(actingUser: string | null): string | null {
  if (actingUser === null) return null;
  const clean = actingUser.replace(NOT_PRINTABLE_ASCII, '?').trim().slice(0, ACTING_USER_MAX_CHARS).trim();
  return clean === '' ? null : clean;
}

/**
 * A sentence for a request that never got an answer. Only the error's NAME and its cause's CODE are
 * used, never its message: a transport error can quote the request, and the request carries the secret.
 */
function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `shadow-connector did not answer within ${timeoutMs / 1000} s`;
  }
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return `CloudCLI could not reach shadow-connector${typeof code === 'string' ? ` (${code})` : ''}`;
}

/**
 * Builds a forwarder. Consumers: `affected-areas.module.ts` and the `carrier-bulletins` module, so each
 * lane's environment is read in its own module and passed down, and each lane holds its own parse of the
 * file and its own last-reported cause (one log line per distinct cause, per lane).
 */
export function createShadowConnectorLane({
  baseUrl,
  envFile,
  label,
}: ShadowConnectorLaneDependencies): ShadowConnectorLane {
  const origin = baseUrl.replace(/\/+$/, '');

  // The parse of the file as last seen, keyed by what `fs.stat` said of it: re-parsing on every call
  // would read the file thirty times a page, and trusting the parse forever would keep a rotated secret.
  let parsed: { mtimeMs: number; size: number; secret: string | null } | null = null;
  // The last cause written to the log, so a missing file is one line and not one line per request.
  let lastReportedCause = '';

  function report(cause: string): void {
    if (cause === lastReportedCause) return;
    lastReportedCause = cause;
    // The path and the cause only — never the line, and never anything parsed from it.
    console.warn(`[${label}] no usable internal secret in ${envFile}: ${cause}`);
  }

  async function currentSecret(): Promise<string | null> {
    try {
      const stat = await fs.stat(envFile);
      if (!parsed || parsed.mtimeMs !== stat.mtimeMs || parsed.size !== stat.size) {
        const secret = parseSecret(await fs.readFile(envFile, 'utf8'));
        parsed = { mtimeMs: stat.mtimeMs, size: stat.size, secret };
      }
      if (parsed.secret === null) report('no EIS_INTERNAL_SECRET= line with a printable-ASCII, unpadded value');
      else lastReportedCause = '';
      return parsed.secret;
    } catch (error) {
      parsed = null;
      report(`${(error as NodeJS.ErrnoException).code ?? 'read failed'}`);
      return null;
    }
  }

  async function forward(request: LaneRequest): Promise<LaneAnswer> {
    const secret = await currentSecret();
    if (secret === null) return { ok: false, reason: 'no_secret', message: NO_SECRET_MESSAGE };

    const headers: Record<string, string> = {
      [SECRET_HEADER]: secret,
      Accept: request.expect === 'bytes' ? 'image/jpeg' : 'application/json',
    };
    const actingUser = sanitiseActingUser(request.actingUser);
    if (actingUser !== null) headers[ACTING_USER_HEADER] = actingUser;
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';

    let status: number;
    let contentType: string;
    let bytes: Buffer | null = null;
    let text = '';
    try {
      const url = new URL(`${origin}${request.path}`);
      for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
      // `redirect: 'manual'` keeps the secret header from following a Location anywhere: the surface
      // never redirects, so a 3xx is a server this lane does not know. One with no JSON body falls out as
      // unreadable; one that carries JSON is relayed like any other answer, and its Location is not.
      const response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs),
        redirect: 'manual',
      });
      status = response.status;
      contentType = response.headers.get('content-type') ?? '';
      // A bytes route answers bytes only on success; its refusals (404 `no such image`) are JSON.
      if (request.expect === 'bytes' && response.ok) bytes = Buffer.from(await response.arrayBuffer());
      else text = await response.text();
    } catch (error) {
      return { ok: false, reason: 'unreachable', message: describeFailure(error, request.timeoutMs) };
    }

    if (bytes !== null) return { ok: true, status, kind: 'bytes', body: bytes, contentType };
    try {
      return { ok: true, status, kind: 'json', body: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, reason: 'unreadable', message: 'shadow-connector did not answer with JSON' };
    }
  }

  return { forward };
}
