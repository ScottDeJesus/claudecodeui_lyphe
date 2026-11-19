/**
 * The Kanban intake door's shared secret, read from eis_backend's own env file: the line
 * `KANBAN_INTAKE_SECRET=<64 hex chars>` in `/opt/shadow-connector/.eis_backend.env`;
 * eis_backend sends that same value as the `X-Kanban-Intake-Secret` header, and the door's guard compares the header against it.
 *
 * Why the file and not `process.env`: the secret's one home is eis_backend's env file; it is never written
 * to `process.env`, this server's `.env`, a log line or an error message, so the agent sessions this server
 * spawns do not inherit it for free. That is hygiene, not a wall: those sessions run as the same user that
 * owns the file (mode 600), so one that goes looking can read the line — closing that needs a file owner the
 * sessions do not run as. A copy would also drift on
 * rotation, so the file is read at call time, its parse is kept only while the file's stat is unchanged,
 * and a rotation is picked up by the next request with no restart.
 *
 * Nothing here throws or logs a value: a missing or unusable secret is `null`, and the one warning names
 * the file and the cause only.
 */

import crypto from 'crypto';
import fs from 'node:fs/promises';

/** Where the secret lives: eis_backend's own file. A copy anywhere else is a second home that drifts. */
export const KANBAN_INTAKE_ENV_FILE_DEFAULT = '/opt/shadow-connector/.eis_backend.env';

/** The line this reader is after; `export ` is allowed and the last matching line wins. */
const SECRET_LINE = /^\s*(?:export\s+)?KANBAN_INTAKE_SECRET\s*=(.*)$/;

/** Printable ASCII with no whitespace at either end: the only shape a header value keeps intact. */
const USABLE_SECRET = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

/**
 * The secret out of an env file's text, or null when none is usable. Same rules as the lane's parser: a
 * quoted value is kept verbatim; an unquoted one loses a trailing ` # comment`.
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

/**
 * The env file to read now: `KANBAN_INTAKE_ENV_FILE` when set, so a probe can point at a scratch file. It is
 * a path only; the secret itself is never placed in the environment.
 */
export function kanbanIntakeEnvFile(): string {
  return process.env.KANBAN_INTAKE_ENV_FILE || KANBAN_INTAKE_ENV_FILE_DEFAULT;
}

/**
 * An async reader of the secret in `envFile`, read at call time. It stats the file on every call and re-parses
 * only when mtime or size changed, so a rotation needs no restart; it reports each distinct failure cause once.
 */
export function createIntakeSecretReader(envFile: string): () => Promise<string | null> {
  // The parse as last seen, keyed by what `fs.stat` said of the file.
  let parsed: { mtimeMs: number; size: number; secret: string | null } | null = null;
  // The last cause written to the log, so a missing file is one line and not one per request.
  let lastReportedCause = '';

  function report(cause: string): void {
    if (cause === lastReportedCause) return;
    lastReportedCause = cause;
    // The path and the cause only: never the line, never a value.
    console.warn(`[kanban-intake] no usable intake secret in ${envFile}: ${cause}`);
  }

  return async function readIntakeSecret(): Promise<string | null> {
    try {
      const stat = await fs.stat(envFile);
      if (!parsed || parsed.mtimeMs !== stat.mtimeMs || parsed.size !== stat.size) {
        const secret = parseSecret(await fs.readFile(envFile, 'utf8'));
        parsed = { mtimeMs: stat.mtimeMs, size: stat.size, secret };
      }
      if (parsed.secret === null) report('no KANBAN_INTAKE_SECRET= line with a printable-ASCII, unpadded value');
      else lastReportedCause = '';
      return parsed.secret;
    } catch (error) {
      parsed = null;
      const code = (error as NodeJS.ErrnoException).code;
      report(code ?? 'read failed');
      return null;
    }
  };
}

/**
 * Constant-time equality of a given secret and the wanted one. Unequal byte lengths are false up front, since
 * `timingSafeEqual` throws on them; equal lengths compare in the same time whichever bytes differ.
 */
export function secretsMatch(given: string, wanted: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(wanted, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
