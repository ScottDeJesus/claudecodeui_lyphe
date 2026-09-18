import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ClaudeUsage, ClaudeUsageWindow } from '@/shared/types.js';

import { isRecord, markRolled, parseWindows } from './usage-windows.js';

/**
 * The fuel gauge's SEAM half: the token, the socket, the cache and the clock. It reads Anthropic's
 * undocumented OAuth usage endpoint server-side, so every byte the browser sees comes from this
 * process and never from Claude's own host.
 *
 * The SHAPE half — what the payload means, and what a missing window is — is `usage-windows.ts`,
 * which this file imports and which holds no credential and opens no socket. That edge runs one way
 * on purpose, and it is why the split exists. Ported from `~/.claude/descent/server_api_usage.py`,
 * which the deleted proxy served from.
 *
 * THE TOKEN SEAM — one deliberate divergence from the account store's rule, and the five bounds that
 * keep it checkable. `account-store.service.ts` never parses a token: it copies credential BYTES file
 * to file and reads only `expiresAt`. This module has to HOLD one, because the endpoint wants a
 * Bearer header. The divergence is confined to this file and bounded:
 *
 *   1. ONE READER. `readCredentials` is the only token read in this module, and the only one in the
 *      server.
 *   2. NEVER LOGGED. No line here takes the token. It is handed to `fetchUsage` and to nothing else,
 *      and it is never kept in module state.
 *   3. NEVER PERSISTED. Nothing here writes a file, a database or `state/`. The whole meter is two
 *      in-memory readings that die with the process.
 *   4. NEVER IN AN ERROR. Every failure collapses to a FIXED reason vocabulary and a status int, so
 *      no exception text, request object or credential can ride out on an error path. That is
 *      stronger than scrubbing a message after the fact: there is nothing here to scrub.
 *   5. NEVER FOLLOWS A REDIRECT. `redirect: 'manual'` means a 3xx is READ and never chased. This
 *      closes the success path — a redirect-following fetch copies its headers onto the next hop, so
 *      a hostile or hijacked upstream could re-send the whole credential to another host. The hop
 *      answers nothing here, and the reading degrades to `upstream`.
 *
 * AN EXPIRED TOKEN, A 401 OR A DEAD NETWORK KEEPS THE LAST GOOD NUMBER ON SCREEN, with
 * `degraded:true` and `staleSince` saying how old it is — "64 %, as of twenty minutes ago" beats a
 * blank gauge. The last good reading is SURRENDERED when the credential stamp moves, because a stale
 * number under another account's name is the one thing worse than an empty gauge.
 *
 * NOTHING HERE FAILS. Every path answers a `ClaudeUsage` with `reachable: true`: there is no upstream
 * here to be unreachable, only a reading that is older than we would like.
 */

/** The endpoint, and the beta header WITHOUT WHICH IT IS NOT THE ONE THAT ANSWERS. Part of the
 *  contract as OBSERVED, not one anybody was given. */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const BETA = 'oauth-2025-04-20';

/** One call's ceiling — a WALL CLOCK over the whole exchange, unlike the source's per-socket-op
 *  timeout, so a dribbling upstream cannot outlive it. */
const REQUEST_TIMEOUT_MS = 10_000;
/** The real payload is ~2 KB; anything past this is not an answer, and it is not held in memory. */
const MAX_BODY_BYTES = 256 * 1024;

/** One upstream poll per 3 minutes, however many tabs are open. */
const HEALTHY_TTL_MS = 180_000;
/** A failed poll retries sooner, so recovery is quick. */
const FAILED_TTL_MS = 30_000;
/** ⚠ EXCEPT a 429. Restarting the server repeatedly earns one from this endpoint, and retrying a door
 *  that just said "too many" is how a meter keeps it shut. The endpoint sends no `Retry-After`, so
 *  this is a fixed wait rather than a parsed one. */
const RATE_LIMIT_TTL_MS = 300_000;
/**
 * How long a claimed poll may run before the slot is offered to somebody else.
 *
 * ⚠ This module has NO cap on polls in flight, where the source capped them at two. That cap existed
 * because a Python `urlopen`'s timeout is PER SOCKET OPERATION: a dribbling upstream held a thread
 * and one of the browser's ~6 connections per origin indefinitely, and enough of them took the board
 * down with them. `AbortSignal.timeout` is a WALL CLOCK over the whole exchange — headers and body —
 * so a fetch here cannot outlive ten seconds or hold a connection past it, which is why the watchdog
 * below is a belt rather than a mechanism and the herd bound has nothing left to bound.
 */
const POLL_STUCK_MS = 90_000;

/** The fixed reason vocabulary (bound 4). `''` is healthy; `pending` is not a fault at all. */
type UsageReason =
  | ''
  | 'pending'
  | 'shape'
  | 'credentials'
  | 'auth'
  | 'network'
  | 'throttled'
  | 'upstream';

/**
 * One reading as this module holds it: the wire body's fields plus the vendor status the wire does
 * not carry, with every instant in epoch MILLISECONDS.
 *
 * ⚠ MILLISECONDS is this module's ONE unit, because it is JavaScript's own clock. The wire's
 * `checkedAt` and `staleSince` are epoch SECONDS — the client multiplies by 1000 — and the conversion
 * happens at exactly one place, `toWire`, so nothing else here has to remember which is which.
 */
type Reading = {
  windows: ClaudeUsageWindow[];
  degraded: boolean;
  reason: UsageReason;
  status: number;
  staleSince: number | null;
  checkedAt: number;
};

/** The last reading that came back whole, with the credential stamp it belongs to. */
type LastGood = { windows: ClaudeUsageWindow[]; at: number; stamp: number | null };

/** A reading in the cache, and WHEN it was taken — the other half of the TTL question. */
type Cached = { at: number; reading: Reading; stamp: number | null };

/** Where the live login's credential bytes live. Deliberately NOT environment-redirectable, unlike
 *  the account store's slots: a variable that moved this path could meter an account nobody named. */
function credentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

/**
 * The ONE token read in the server → the bearer value and the stamp it belongs to.
 *
 * ⚠ BOTH COME OUT OF ONE READ, and that is the point. Reading the token and the stamp separately left
 * a window where a whole-box swap landed between them and account B's percentages were filed under
 * account A's stamp, then rendered under account A's name with a reassuring "stale" caption. One read
 * cannot disagree with itself — this is the single `JSON.parse` in the module, and nothing but this
 * function ever sees the file.
 *
 * `expiresAt` is the SAME field the account store reads and documents as a freshness clock rather
 * than a credential — the cache key, and not a secret. It is what makes a swap honest: each account's
 * file carries its own expiry, so a swap always moves it and both caches miss. An unreadable file is
 * not an error — it is "no login", which is one fact to a gauge.
 */
function readCredentials(): { token: string | null; stamp: number | null } {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
    const oauth = isRecord(parsed) && isRecord(parsed.claudeAiOauth) ? parsed.claudeAiOauth : {};
    const token = oauth.accessToken;
    return {
      token: typeof token === 'string' && token ? token : null,
      stamp: asStamp(oauth.expiresAt),
    };
  } catch {
    return { token: null, stamp: null }; // absent, unreadable or not JSON — all one fact here
  }
}

/**
 * One `expiresAt` value → an integer stamp, or `null`. TOTAL — it is called from a route.
 *
 * ⚠ `Math.trunc` rather than a `Number.isInteger` test: refusing a fractional stamp would make every
 * cache lookup miss, and a cache that never hits polls the vendor on every request — the opposite of
 * what this file is for. `true` is not a number here, and neither is `NaN` or `Infinity`, which
 * `JSON.parse` will hand over quite happily.
 */
function asStamp(expiresAt: unknown): number | null {
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? Math.trunc(expiresAt) : null;
}

/** One upstream GET → the status and the parsed payload. Status 0 means the request never completed,
 *  and NOTHING from the exception escapes: not its message, not its request object, not the header it
 *  carried. */
async function fetchUsage(token: string): Promise<{ status: number; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        'anthropic-beta': BETA,
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // Bound 5. A 3xx is read, never chased.
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 0, payload: null };
  }

  const body = await readBodyCapped(response);
  if (body === null) return { status: response.status, payload: null }; // reached, not read (rule 2)
  try {
    const parsed: unknown = JSON.parse(body);
    return { status: response.status, payload: parsed };
  } catch {
    return { status: response.status, payload: null };
  }
}

/** The body, bounded. A 200 that is not JSON, or one longer than any answer this endpoint has ever
 *  sent, is still REACHED — the caller keeps the status and reports a parse it cannot make. */
async function readBodyCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Which reading this module is holding, and whether a new one may be fetched. */
let current: Cached | null = null;
let lastGood: LastGood | null = null;
let polling = false;
let pollingSince = 0;
let generation = 0;

/**
 * ⚠ THE CLAIM ON `polling` NEEDS NO LOCK, and that is a property of the runtime rather than a
 * shortcut: Node runs the check and the claim without yielding, so two requests cannot both find the
 * cache cold. What DOES interleave is the await, which is what `generation` is for — a poll a newer
 * one superseded answers the caller that started it while owning nothing: it installs no reading and
 * clears no flag.
 */

/** How long the cached answer may stand before another poll is allowed. A 429 is the one failure
 *  where retrying sooner makes it worse, so it backs off instead. */
function ttlFor(reading: Reading | null): number {
  if (!reading || !reading.degraded) return HEALTHY_TTL_MS;
  return reading.status === 429 ? RATE_LIMIT_TTL_MS : FAILED_TTL_MS;
}

/** A poll is in flight and its answer is not ours to show — *reading*, not *broken*. ⚠ It has its own
 *  word because borrowing `network` announced a fault that was not happening, which trains the reader
 *  to ignore the one that is. */
function pending(now: number): Reading {
  return { windows: [], degraded: false, reason: 'pending', status: 0, staleSince: null, checkedAt: now };
}

/** The last good numbers plus WHY they are old — the honest state, never a blank. ⚠ The last good
 *  reading is surrendered when the STAMP moved: those percentages belonged to whoever was at the helm
 *  then, and a stale number under the wrong account's name is worse than an empty gauge. */
function degraded(reason: UsageReason, status: number, now: number, stamp: number | null): Reading {
  const good = lastGood; // ONE read of the snapshot
  const same = good !== null && stamp !== null && good.stamp === stamp;
  return {
    windows: same ? [...good.windows] : [],
    degraded: true,
    reason,
    status,
    staleSince: same ? good.at : null,
    checkedAt: now,
  };
}

/**
 * The last gate before anything leaves this module: void what the clock has already voided.
 *
 * Every answer goes through here, fresh or cached, because the reset instant is knowable without a
 * poll. On the healthy path this catches at most one TTL; on the degraded path it is the difference
 * between "67 %, read nine hours ago" and "that window rolled at 5 a.m." — the second is true and the
 * first is not.
 *
 * ⚠ It COPIES. The reading it is handed is usually the cache's, and marking that in place would write
 * the flag into the cache, where it would outlive the reading it describes.
 */
function served(reading: Reading, now: number): Reading {
  if (reading.windows.length === 0) return reading;
  // WHEN THE READING WAS TAKEN, which is not when we last tried: a degraded answer's windows come out
  // of `lastGood`, so `staleSince` is the read instant.
  const readAt = reading.staleSince ?? reading.checkedAt;
  return { ...reading, windows: markRolled(reading.windows, now, readAt) };
}

/** The wire body. `reachable` is true on every answer this module can compute — there is no upstream
 *  here to be unreachable — and the two stamps become epoch SECONDS, the client's unit. */
function toWire(reading: Reading): ClaudeUsage {
  return {
    reachable: true,
    windows: reading.windows,
    degraded: reading.degraded,
    reason: reading.reason,
    staleSince: reading.staleSince === null ? null : Math.floor(reading.staleSince / 1000),
    checkedAt: Math.floor(reading.checkedAt / 1000),
  };
}

/**
 * One measurement → the reading, the stamp it belongs to, and a new last-good or `null`.
 *
 * ⚠ It does NOT install the snapshot itself. A reclaimed-slot poll can still be running when a newer
 * one finishes, and a late writer would rebind the last good reading to the older figures. Handing it
 * back lets the caller install it under the same generation check that guards the cache, so there is
 * exactly one writer. Every leg is total; nothing here raises.
 */
async function measure(): Promise<{ reading: Reading; stamp: number | null; good: LastGood | null }> {
  const now = Date.now();
  const { token, stamp } = readCredentials();
  if (token === null) return { reading: degraded('credentials', 0, now, stamp), stamp, good: null };

  const { status, payload } = await fetchUsage(token);
  if (status !== 200) {
    const reason: UsageReason =
      status === 401 || status === 403
        ? 'auth'
        : status === 0
          ? 'network'
          : status === 429
            ? 'throttled'
            : 'upstream';
    return { reading: degraded(reason, status, now, stamp), stamp, good: null };
  }

  const windows = parseWindows(payload);
  if (windows.length === 0) {
    // Rule 2: REACHED but unreadable. Not degraded — the meter asked and got an answer, it just has
    // nothing to draw — and the last good reading is left alone rather than erased.
    return {
      reading: { windows: [], degraded: false, reason: 'shape', status, staleSince: null, checkedAt: now },
      stamp,
      good: null,
    };
  }
  return {
    reading: { windows, degraded: false, reason: '', status: 200, staleSince: null, checkedAt: now },
    stamp,
    good: { windows, at: now, stamp },
  };
}

/**
 * The meter: serve the cache, poll at most once a window, and never fail.
 *
 * ⚠ THE CACHE IS KEYED BY THE CREDENTIAL STAMP, so a whole-box swap always misses it. It would
 * otherwise serve the OUTGOING account's percentages for up to three minutes after the operator takes
 * the helm, under the incoming account's name.
 */
export async function readUsage(): Promise<ClaudeUsage> {
  const now = Date.now();
  const { stamp } = readCredentials();
  const cached = current;
  // ⚠ WHOSE numbers the cache holds — asked once and reused by every branch below — and the
  // `stamp !== null` leg is load-bearing: `null === null` is true, so without it an unreadable
  // credentials file would collapse every account into ONE cache slot, and the gauge would show the
  // outgoing account's numbers marked fresh.
  const sameCredential = cached !== null && stamp !== null && cached.stamp === stamp;

  if (sameCredential && now - cached.at < ttlFor(cached.reading)) {
    return toWire(served(cached.reading, now));
  }
  // Somebody is already asking upstream: answer from cache rather than park this request on a socket
  // nobody controls. The client reloads the panel the instant a switch resolves, so reaching here with
  // a MOVED stamp is the likely path, not an exotic one — hence `pending`, never the old numbers
  // under a new name.
  if (polling && now - pollingSince < POLL_STUCK_MS) {
    return toWire(served(sameCredential && cached ? cached.reading : pending(now), now));
  }

  polling = true;
  pollingSince = now;
  const mine = ++generation;

  let outcome: Awaited<ReturnType<typeof measure>>;
  try {
    outcome = await measure();
  } catch {
    // A belt. `measure`'s legs are already total, so this is unreachable by construction — but the
    // route is forbidden to fail, and a fuel gauge is not worth a traceback.
    outcome = { reading: degraded('network', 0, now, stamp), stamp, good: null };
  }

  if (generation === mine) {
    current = { at: Date.now(), reading: outcome.reading, stamp: outcome.stamp };
    if (outcome.good) lastGood = outcome.good; // rebound whole, never mutated
    polling = false;
  }
  // ⚠ NOT `now` — that was taken before the poll, and nothing bounds a read's wall clock, so a slow
  // fetch would otherwise have this answer judged against a clock from before it started.
  return toWire(served(outcome.reading, Date.now()));
}
