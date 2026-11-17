import { readTokenUsername } from '@/modules/auth/index.js';
import type { RequestSource } from '@/shared/request-source.js';

/** What the route read off the request beside the body: who stands behind it, never what it said. */
export type BootReportContext = RequestSource & {
  /** The bearer token the page held when it reported, or null. Read to name the account and written nowhere. */
  token: string | null;
};

/** How a report ended: `logged` is the one that wrote a line. */
type BootReportOutcome = 'logged' | 'duplicate' | 'rate-limited' | 'unreadable';

const MAX_LEAVES = 170;
const MAX_DEPTH = 4;
const MAX_ITEMS = 12;
const MAX_TEXT = 260;
// The page caps its own body at 12,000 characters and a flattened line runs a little longer than the JSON it came from (every leaf repeats
// its path), so a body the page was willing to send is never cut here; the cut is for a sender that is not our page.
const MAX_LINE_CHARS = 14000;
// A page sends at most 4, and every page opened on this box (a builder's, a probe's) reaches the door from the SAME address — the Vite
// proxy's 127.0.0.1 — so a dev-server restart that fails them all at once must fit under the per-source cap or its reports are lost.
const GLOBAL_REPORTS_PER_MINUTE = 60;
const SOURCE_REPORTS_PER_MINUTE = 30;
const REMEMBERED_IDS = 256;
const MINUTE_MS = 60_000;
// No `=`: a value that holds one is quoted, so the head's own grammar (`from=…`) never appears bare in text a page supplied.
const BARE_VALUE = /^[\w.:/@%+#,-]{1,80}$/;
// A kind is a word of ours, never page text: it sits in the head, which is the only part of the line this server writes from the connection.
const KIND_WORD = /^[a-z][a-z-]{0,23}$/;
// Anything shaped like a JWT, wherever it sits in what a page said: a log line never holds part of a token.
const TOKEN_SHAPE = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/** One value as it is written in the line: a bare word when it is one, else a JSON string, never a second line. */
function writeText(raw: string): string {
  const text = raw.replace(TOKEN_SHAPE, '[token]').replace(CONTROL_CHARACTERS, ' ').trim();
  const clipped = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
  return BARE_VALUE.test(clipped) ? clipped : JSON.stringify(clipped);
}

function writeKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24) || '_';
}

/**
 * The page's own words as `path=value` pairs, whatever shape it sent. The server reads no schema on purpose: what a page
 * saw of its boot is evidence, and a field the inline script grows tomorrow must reach the log without a second edit here.
 * Depth, item count, leaf count and text length are all capped, so the line's size is the server's decision, not the sender's.
 */
function flatten(value: unknown, path: string, pairs: string[], depth: number): void {
  if (pairs.length >= MAX_LEAVES) return;
  if (value === null || value === undefined) {
    pairs.push(`${path}=null`);
  } else if (typeof value === 'number') {
    pairs.push(`${path}=${Number.isFinite(value) ? Math.round(value * 100) / 100 : 'NaN'}`);
  } else if (typeof value === 'boolean') {
    pairs.push(`${path}=${value}`);
  } else if (typeof value === 'string') {
    pairs.push(`${path}=${writeText(value)}`);
  } else if (depth >= MAX_DEPTH) {
    pairs.push(`${path}=…`);
  } else if (Array.isArray(value)) {
    value.slice(0, MAX_ITEMS).forEach((item, index) => flatten(item, `${path}.${index}`, pairs, depth + 1));
    if (value.length > MAX_ITEMS) pairs.push(`${path}.more=${value.length - MAX_ITEMS}`);
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS * 3)) {
      flatten(item, `${path}.${writeKey(key)}`, pairs, depth + 1);
    }
  }
}

/** The account a held token names, `none` for no token and `unverified` for one this server did not sign. */
function reporterOf(token: string | null): string {
  if (token === null) return 'none';
  const username = readTokenUsername(token);
  return typeof username === 'string' ? writeText(username) : 'unverified';
}

/** A sliding one-minute window per key; `take` says whether one more fits and counts it when it does. */
function createWindowLimiter(limit: number, now: () => number) {
  const stamps = new Map<string, number[]>();
  return {
    take(key: string): boolean {
      const cutoff = now() - MINUTE_MS;
      const live = (stamps.get(key) ?? []).filter((stamp) => stamp > cutoff);
      if (live.length >= limit) {
        stamps.set(key, live);
        return false;
      }
      live.push(now());
      stamps.set(key, live);
      // Sources come and go; a map that only grows is a slow leak for the life of the process.
      if (stamps.size > 500) for (const [other, kept] of stamps) if (kept.every((stamp) => stamp <= cutoff)) stamps.delete(other);
      return true;
    },
  };
}

/**
 * Used by the module's route. Turns what a page that failed to draw posted into ONE log line — the journal is where
 * the operator reads why a page did not draw, and a line per report keeps `journalctl | grep boot-report` the whole query.
 *
 * The door is public (the page holds nothing it can show), so everything it takes is bounded here: a global and a
 * per-source rate, a report id seen once, text with no control characters and no token shape, and a line cut at a fixed length.
 */
export function createBootReportService(now: () => number = Date.now) {
  const globalLimiter = createWindowLimiter(GLOBAL_REPORTS_PER_MINUTE, now);
  const sourceLimiter = createWindowLimiter(SOURCE_REPORTS_PER_MINUTE, now);
  const seenIds = new Set<string>();
  let droppedAt = 0;

  return {
    accept(body: unknown, context: BootReportContext): BootReportOutcome {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'unreadable';
      const report = body as Record<string, unknown>;
      // A report names its kind. The body-parser hands a POST it skipped (no body, a form) to the route as `{}`, and a scanner's probe is not
      // a report: a 400 that spends no rate slot and writes no line.
      if (typeof report.kind !== 'string' || report.kind === '') return 'unreadable';

      // A page re-sends the last report it could not confirm (its outbox, after the server was unreachable); the id makes a
      // delivery that did arrive the first time a no-op rather than a second line.
      const id = typeof report.id === 'string' ? report.id.slice(0, 40) : '';
      if (id !== '' && seenIds.has(id)) return 'duplicate';

      if (!globalLimiter.take('all') || !sourceLimiter.take(context.from)) {
        // One line per minute of refusing, not one per refusal: a flood must not become a log flood.
        if (now() - droppedAt > MINUTE_MS) {
          droppedAt = now();
          console.warn(`[boot-report] rate limit: refusing reports from=${writeText(context.from)}`);
        }
        return 'rate-limited';
      }

      if (id !== '') {
        seenIds.add(id);
        if (seenIds.size > REMEMBERED_IDS) seenIds.delete(seenIds.values().next().value as string);
      }

      const kind = KIND_WORD.test(report.kind) ? report.kind : 'unknown';
      const rest = { ...report };
      delete rest.kind;
      delete rest.id;
      const pairs: string[] = [];
      flatten(rest, '', pairs, 0);
      const head = `[boot-report] kind=${kind} from=${writeText(context.from)} host=${writeText(context.host)} user=${reporterOf(context.token)}`;
      const line = `${head} ${pairs.map((pair) => pair.slice(1)).join(' ')}`;
      console.warn(line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…[cut]` : line);
      return 'logged';
    },
  };
}

export type BootReportService = ReturnType<typeof createBootReportService>;
