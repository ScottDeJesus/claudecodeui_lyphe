import fs from 'node:fs';
import path from 'node:path';

import { renewSavedLogin } from '@/modules/providers/index.js';
import type { ClaudeUsage, ClaudeUsagePace, ClaudeUsageWindow } from '@/shared/types.js';
import { claudeConfigDir, claudeConfigDirIsDefault } from '@/shared/utils.js';

import { liveAccountDigest } from './account-digest.js';
import { note, paceOf, status as pacerStatus } from './pacer-door.js';
import { isRecord, markRolled, parseWindows } from './usage-windows.js';

/**
 * The fuel gauge's SEAM half: the token, the socket, the cache and the clock. It reads Anthropic's
 * undocumented OAuth usage endpoint server-side, so every byte the browser sees comes from this
 * process and never from Claude's own host.
 *
 * The SHAPE half — what the payload means, and what a missing window is — is `usage-windows.ts`,
 * which this file imports and which holds no credential and opens no socket. That edge runs one way
 * on purpose, and it is why the split exists: this half owns the token, so nothing that only reads
 * a payload may reach one.
 *
 * THE TOKEN SEAM — one deliberate divergence from the house's secret rule, and the five bounds that
 * keep it checkable. A sign-in token has one home (`claude_account/tokens.py`, reached only through
 * `token_for`) and never leaves it; this meter is the exception, because the endpoint wants a Bearer
 * header and the meter reads the credential file the `claude` CLI itself wrote. The divergence is
 * confined to this file and bounded:
 *
 *   1. ONE READER. `readCredentials` is the only token read in this module, and the only one in the
 *      server.
 *   2. NEVER LOGGED. No line here takes the token. It is handed to `fetchUsage` and, as the value a
 *      renewed pass is compared against, to `renewLogin`, and to nothing else; it is never kept in
 *      module state.
 *   3. NEVER PERSISTED. Nothing here writes a file, a database or `state/`: the token is never
 *      persisted, and every good reading is filed by `pacer-door.ts` and outlives this process. The
 *      credentials file is rewritten by the `claude` CLI the renewal runs, never by this module.
 *   4. NEVER IN AN ERROR. Every failure collapses to a FIXED reason vocabulary and a status int, so
 *      no exception text, request object or credential can ride out on an error path. That is
 *      stronger than scrubbing a message after the fact: there is nothing here to scrub.
 *   5. NEVER FOLLOWS A REDIRECT. `redirect: 'manual'` means a 3xx is READ and never chased. This
 *      closes the success path — a redirect-following fetch copies its headers onto the next hop, so
 *      a hostile or hijacked upstream could re-send the whole credential to another host. The hop
 *      answers nothing here, and the reading degrades to `upstream`.
 *
 * AN EXPIRED TOKEN IS NEVER SENT, IT IS RENEWED. `expiresAt` is a clock this file can read without an
 * answer from anybody, so a stamp already behind us sends nothing: the endpoint would answer a 401, and
 * `auth` reads as a refusal when the truth is an expiry. The pass is renewed first — the providers
 * module's `renewSavedLogin` runs `claude auth status` on the saved login, which makes the CLI renew
 * the pass from its refresh token and rewrite the file — and the fetch goes on in the same call with
 * the new one, because nothing else here runs the CLI on that login: chats ride saved long-lived
 * tokens, so without this the pass dies every few hours and the gauge with it. A pass that could not
 * be renewed degrades to `expired`, and so does a login the CLI itself cleared (`accessToken: ""`, what
 * it writes when the vendor refuses the refresh token) — nothing can renew that one, and `expired` is the
 * word that tells the operator to sign in. A login file that cannot be read is `credentials`. A 401 or
 * 403 on a pass the clock still trusts earns the same renewal once, and one retry only when the file then
 * holds a different token.
 *
 * A 401 or a dead network KEEPS THE LAST GOOD NUMBER ON SCREEN, with `degraded:true` and `staleSince`
 * saying how old it is — "64 %, as of twenty minutes ago" beats a blank gauge. The last good reading is
 * SURRENDERED when the credential stamp moves, because a stale number under another account's name is
 * the one thing worse than an empty gauge. The one move that is not a change of login is the CLI's own
 * rewrite of the file it was asked to renew: a new pass, or the cleared mark, on the SAME login. After a
 * renewal attempt the last good reading is re-filed under the stamp the CLI left (`reboundTo`), so a
 * fetch that fails right after a renewal, or the poll after a cleared login, still shows the numbers.
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
  | 'expired'
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
  /** The login these figures belong to — `meteredAccountDigest()`, read beside the token, `''` when it
   *  cannot be told — so the answer can say whose numbers they are. */
  account: string;
  degraded: boolean;
  reason: UsageReason;
  status: number;
  staleSince: number | null;
  checkedAt: number;
  /** The pacer's projection of the same account at the same instant, in percent, or `null` when the
   *  read call failed. Cached WITH the reading, so a served answer draws the picture its own figures
   *  were read beside. */
  pace: ClaudeUsagePace | null;
};

/** The last reading that came back whole, with the credential stamp it belongs to. */
type LastGood = { windows: ClaudeUsageWindow[]; at: number; stamp: number | null };

/** A reading in the cache, and WHEN it was taken — the other half of the TTL question. */
type Cached = { at: number; reading: Reading; stamp: number | null };

/** Where the live login's credential bytes live: the `claude` CLI's own config directory, the one
 *  the Claude provider reads the same file in and the one `renewSavedLogin` runs the CLI against —
 *  the readers and the writer of one file must agree on where it is. */
function credentialsPath(): string {
  return path.join(claudeConfigDir(), '.credentials.json');
}

/**
 * The account digest these figures are named and filed under: `liveAccountDigest()`'s answer — read
 * from `~/.claude.json` — only while the credentials file is the default config directory's. With
 * `CLAUDE_CONFIG_DIR` moved, the CLI keeps its identity file in that directory too, so `~/.claude.json`
 * would name (and the pacer would file) the token's readings under another login. `''` is "could not
 * be told", which every consumer already treats as no evidence.
 */
function meteredAccountDigest(): string {
  return claudeConfigDirIsDefault() ? liveAccountDigest() : '';
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
 * `expiresAt` is read as a freshness clock rather than a credential — the cache key, and not a
 * secret. It is what makes a new login honest: the live file carries its own expiry, so signing in
 * again moves it and the cache misses. An unreadable file is
 * not an error — it is "no login", which is one fact to a gauge.
 *
 * `cleared` is the one other fact the file can hold: the CLI's own mark for a login whose refresh token
 * the vendor refused — it writes `accessToken: ""`, an empty refresh token and `expiresAt: 0`, and exits
 * 0. That is an expired pass nothing can renew, not an unreadable file, and it is a boolean about the
 * file, never a part of it.
 */
function readCredentials(): { token: string | null; stamp: number | null; cleared: boolean } {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
    const oauth = isRecord(parsed) && isRecord(parsed.claudeAiOauth) ? parsed.claudeAiOauth : {};
    const token = oauth.accessToken;
    return {
      token: typeof token === 'string' && token ? token : null,
      stamp: asStamp(oauth.expiresAt),
      cleared: token === '',
    };
  } catch {
    return { token: null, stamp: null, cleared: false }; // absent, unreadable or not JSON — all one fact here
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
function pending(now: number, account: string): Reading {
  return { windows: [], account, degraded: false, reason: 'pending', status: 0, staleSince: null, checkedAt: now, pace: null };
}

/** The last good numbers plus WHY they are old — the honest state, never a blank. ⚠ The last good
 *  reading is surrendered when the STAMP moved: those percentages belonged to whoever was at the helm
 *  then, and a stale number under the wrong account's name is worse than an empty gauge. */
function degraded(reason: UsageReason, status: number, now: number, stamp: number | null, account: string): Reading {
  const good = lastGood; // ONE read of the snapshot
  const same = good !== null && stamp !== null && good.stamp === stamp;
  return {
    windows: same ? [...good.windows] : [],
    account,
    degraded: true,
    reason,
    status,
    staleSince: same ? good.at : null,
    checkedAt: now,
    // A degraded answer is a FAILURE's answer: the pacer's picture is not read on this path, and
    // pairing last time's marks with a projection nobody refreshed would be a second staleness the
    // "as of" line does not admit.
    pace: null,
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
    // WHICH ACCOUNT these figures were read from, so the panel can tell whether they belong to the
    // account in use. `''` is "could not be told", never a guess.
    account: reading.account,
    degraded: reading.degraded,
    reason: reading.reason,
    staleSince: reading.staleSince === null ? null : Math.floor(reading.staleSince / 1000),
    checkedAt: Math.floor(reading.checkedAt / 1000),
    // ABSENT, never `null`, on a reading with no picture: a missing key is "not drawn", which is
    // exactly what an older server's client and a pacer fault both need.
    ...(reading.pace === null ? {} : { pace: reading.pace }),
  };
}

/** A clock time for the log, in the server's local time — `20:13`, the one the operator reads. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** What a renewal attempt left in the file: a NEW pass to go on with, or none — and either way the
 *  stamp the file holds now, which the CLI may have rewritten (`null` when it cannot be read). */
type Renewal = { fresh: true; token: string; stamp: number | null } | { fresh: false; stamp: number | null };

/**
 * Asks for the saved login's pass to be renewed, logs the one line the attempt earns, and answers what
 * the file holds now.
 *
 * ⚠ NEW MEANS A DIFFERENT TOKEN than the one that just failed, not merely a live stamp: when the
 * endpoint refuses a pass the clock still trusts, the CLI hands back the same one, and fetching with it
 * again would only be refused again. `staleToken` is compared and never logged or kept. The log line
 * is per ATTEMPT — an answer from the renewal's cooldown started no CLI and says nothing — and its
 * detail is the verb's own words, which carry no token. Total: the verb never rejects.
 */
async function renewLogin(why: string, staleToken: string): Promise<Renewal> {
  const renewal = await renewSavedLogin();
  const { token, stamp } = readCredentials();
  const isNewPass = renewal.renewed && token !== null && token !== staleToken;
  if (renewal.attempted) {
    const outcome = isNewPass
      ? `renewed, valid until ${stamp === null ? 'an unknown time' : clockTime(stamp)}`
      : `not renewed (${renewal.detail})`;
    console.log(`[usage] ${why}; renewing with claude auth status → ${outcome}`);
  }
  return isNewPass ? { fresh: true, token, stamp } : { fresh: false, stamp };
}

/**
 * The last good reading, re-filed under the stamp a renewal attempt left in the file — or `null` when
 * there is none to move.
 *
 * ⚠ A RENEWAL MOVES THE STAMP WITHOUT CHANGING THE LOGIN: the CLI hands the same account a new pass,
 * or writes its cleared mark (`stamp` 0). `degraded` keeps the last good numbers only while the stamps
 * agree, so without this a fetch that failed right after a renewal — and every poll after a cleared
 * login — drew an empty gauge where the numbers were still the right account's. `readUnder` is the
 * stamp the figures were read under; a last good reading filed under any OTHER stamp is another
 * login's and stays where it is, to be surrendered. The caller hands the copy back to be installed
 * under the generation check, like every other snapshot.
 */
function reboundTo(readUnder: number | null, leftBehind: number | null): LastGood | null {
  const good = lastGood;
  if (good === null || readUnder === null || leftBehind === null || good.stamp !== readUnder) return null;
  return { ...good, stamp: leftBehind };
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
  let now = Date.now();
  const first = readCredentials();
  let token = first.token;
  let stamp = first.stamp;
  // WHICH LOGIN these figures will belong to, read beside the token and before the fetch. The
  // credential stamp is the witness for the pair: a whole-box swap moves it, so a swap that lands
  // while the request is out leaves a different stamp to compare below.
  let digest = meteredAccountDigest();
  // No token is no login: nothing to send and nothing for the CLI to renew. Except the CLI's own
  // cleared mark, which is an expiry nothing can renew — it reads as `expired`, the words that tell
  // the operator to sign in, and starts no CLI to learn what the file already says.
  if (token === null) {
    return { reading: degraded(first.cleared ? 'expired' : 'credentials', 0, now, stamp, digest), stamp, good: null };
  }
  // The stamp the figures on screen were read under. A renewal moves `stamp` (the same login, a new
  // pass) and does not move this; `carried` is the last good reading re-filed under what the CLI left.
  const readUnder = stamp;
  let carried: LastGood | null = null;
  // ⚠ A STAMP ALREADY BEHIND US IS NOT SENT. `expiresAt` is epoch MILLISECONDS, the same clock as
  // `now`; the endpoint would answer 401 and the reading would say `auth` — a refusal — when the
  // truth is an expiry. No request leaves this process with a dead token: the pass is renewed
  // first, and the fetch below goes on in this same call with the new one.
  if (stamp !== null && stamp <= now) {
    const renewal = await renewLogin(`the saved login's pass expired at ${clockTime(stamp)}`, token);
    now = Date.now(); // a renewal is a CLI run of up to 30 s; the reading is dated by when it ends
    carried = reboundTo(readUnder, renewal.stamp);
    if (!renewal.fresh) {
      // The CACHE is keyed by the file as it stands, which a CLI that failed may have rewritten.
      return {
        reading: degraded('expired', 0, now, readUnder, digest),
        stamp: renewal.stamp,
        good: carried,
      };
    }
    token = renewal.token;
    stamp = renewal.stamp;
    digest = meteredAccountDigest(); // read beside the new token, as above
  }

  let { status, payload } = await fetchUsage(token);
  if (status === 401 || status === 403) {
    // A pass the clock trusts that the endpoint refuses: one renewal, and one retry if it came back new.
    const renewal = await renewLogin(`the usage endpoint answered ${status} to the saved login's pass`, token);
    now = Date.now();
    carried = reboundTo(readUnder, renewal.stamp);
    if (renewal.fresh) {
      token = renewal.token;
      stamp = renewal.stamp;
      digest = meteredAccountDigest();
      ({ status, payload } = await fetchUsage(token));
    }
  }
  if (status !== 200) {
    const reason: UsageReason =
      status === 401 || status === 403
        ? 'auth'
        : status === 0
          ? 'network'
          : status === 429
            ? 'throttled'
            : 'upstream';
    return { reading: degraded(reason, status, now, readUnder, digest), stamp, good: carried };
  }

  const windows = parseWindows(payload);
  if (windows.length === 0) {
    // Rule 2: REACHED but unreadable. Not degraded — the meter asked and got an answer, it just has
    // nothing to draw — and the last good reading is left alone rather than erased.
    return {
      reading: {
        windows: [], account: digest, degraded: false, reason: 'shape', status,
        staleSince: null, checkedAt: now, pace: null,
      },
      stamp,
      good: carried,
    };
  }
  // ⚠ EVERY GOOD READING IS FILED WITH THE PACER, under the login it came from — but only while
  // that login held still for the whole fetch. The stamp is read again: a swap during the request
  // means these percentages might be either account's, and an unknown stamp is no evidence at all.
  // `note` is fire-and-forget (a child with its own timeout); nothing on this path awaits it.
  const after = readCredentials().stamp;
  if (stamp !== null && after === stamp) note(digest, windows, now, 'meter');
  // THE PACER'S PICTURE OF THIS LOGIN, drawn at the instant its figures were read: `digest` is the
  // account read beside the token before the fetch, and `status` names it explicitly, so the marks
  // on the bars can belong to no other account. A failure here answers null and the reading travels
  // without a pace — the meters then draw exactly what they drew before the picture existed.
  const pace = paceOf(await pacerStatus(digest));
  return {
    reading: {
      windows, account: digest, degraded: false, reason: '', status: 200,
      staleSince: null, checkedAt: now, pace,
    },
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
    // A pending answer names the login ASKED NOW, never a cache entry's: a moved stamp means the
    // old entry belongs to another account.
    return toWire(served(
      sameCredential && cached ? cached.reading : pending(now, meteredAccountDigest()),
      now,
    ));
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
    outcome = { reading: degraded('network', 0, now, stamp, meteredAccountDigest()), stamp, good: null };
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
