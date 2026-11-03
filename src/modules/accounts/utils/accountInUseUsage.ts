import { WINDOW_NAMES } from '@/modules/accounts/utils/usageWindows';
import type { ClaudeAccountRow, ClaudeAccounts, ClaudeUsage, ClaudeUsagePace, ClaudeUsageWindow } from '@/shared/types';

/**
 * THE METERS FOLLOW THE ACCOUNT IN USE, WHICH IS NO LONGER ALWAYS THE BOX'S LIVE LOGIN.
 *
 * `GET /api/usage` measures the login whose credential file the box holds — `liveAccountDigest()` —
 * and that is the right reading only while the account in use is that same login. Once the store
 * chooses another account (a checked sign-in token, `chosen.json`'s digest), the route's figures are
 * still the outgoing login's, and drawing them under the incoming account's name would be a number
 * under the wrong owner. The door's picture carries every account's newest reading and the pacer's
 * projection of it, so this file turns the account in use's row into the very `ClaudeUsage` the meters
 * already draw — same keys, same units, no second renderer and no change to `UsageMeters`.
 *
 * THIS IS THE ONE PLACE THE DOOR'S FRACTIONS BECOME PERCENT. The door relays `reading.five`/`.week`
 * and its `pace` figures as fractions 0..1 (window POINTS, INV-4299 — never dollars); the meters take
 * percent and do no arithmetic, so the conversion happens here, once, and nowhere else.
 *
 * AN ACCOUNT WITH NO 5-HOUR WINDOW HAS NO 5-HOUR INDICATOR. Some plans dropped the limit, and the door
 * says so with one boolean per account, `no_five` — derived by the pacer from the account's stored
 * readings. That boolean is the only thing this app reads for it: a window missing from ONE usage reply
 * also happens between 5-hour blocks on an account that has the limit, and that account keeps its
 * "No reading yet" ring and its blank bar. `hasFiveHour` is the rule, `withoutFiveHour` applies it to
 * the reading the meters draw, and the rings and the account rows ask `hasFiveHour` themselves.
 */

/** The two windows every account row states, and the labels the meters already give them. */
const FIVE_HOUR = { key: 'five_hour', label: WINDOW_NAMES.five_hour } as const;
const WEEKLY = { key: 'seven_day', label: WINDOW_NAMES.seven_day } as const;

/**
 * A fraction 0..1 as the wire's whole percent — the same rounding `usage.service.ts` applies.
 * `null` is a window the pacer could not measure, and stays `null`: the meters draw an em-dash,
 * never a false `0% used` (the pacer files one-window readings). The wire is untrusted at its
 * edges: an absent or unreadable figure is `null` too, because `Math.round(undefined * 100)` is
 * `NaN`, which `Meter` would draw as a live `NaN%` bar carrying `aria-valuenow="NaN"`.
 */
function points(fraction: number | null): number | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  return Math.round(fraction * 100);
}

/**
 * Epoch SECONDS → the ISO-8601 stamp `ClaudeUsageWindow.resetsAt` carries; no readable stamp
 * (null, absent, or not a finite number) stays `null` — `new Date(undefined)` throws in render.
 */
function resetStamp(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** A window nobody has measured reads as an em-dash over an empty track, never as zero used. */
function unmeasuredWindow(window: { key: string; label: string }): ClaudeUsageWindow {
  return { key: window.key, label: window.label, percent: null, resetsAt: null };
}

/**
 * The row's pace (fractions) as `ClaudeUsage.pace` (percent), the shape `UsageMeters` already reads.
 * The row carries only where each window PROJECTS and its ceiling; the used figure is the reading's
 * own, and `words` is empty because the rule's caption belongs to the live route's picture, not to a
 * filed reading. `undefined` when the pacer could weigh neither window — `ClaudeUsage.pace` is ABSENT
 * on a reading with no pace, exactly like the route's absent key.
 */
function paceInPercent(row: ClaudeAccountRow, five: number | null, week: number | null): ClaudeUsagePace | undefined {
  const pace = row.pace;
  if (pace === null) return undefined;
  return {
    used5: five,
    projected5: pace.five === null ? null : points(pace.five.projected),
    ceiling5: pace.five === null ? null : points(pace.five.ceiling),
    used7: week,
    projected7: pace.week === null ? null : points(pace.week.projected),
    ceiling7: pace.week === null ? null : points(pace.week.ceiling),
    words: '',
  };
}

/**
 * The account in use, as the door marks it.
 *
 * The door puts `in_use` on exactly one row: the chosen account when it holds a checked token, else
 * the live login (`store.current()`). So the mark, not a guess assembled from `chosen` and `live`, is
 * the answer — and a picture the door could not answer has no account in use at all.
 */
export function accountInUse(picture: ClaudeAccounts | null | undefined): ClaudeAccountRow | null {
  if (picture === null || picture === undefined || !picture.reachable) return null;
  return picture.accounts.find((account) => account.in_use) ?? null;
}

/**
 * Whether an account has a 5-hour window. A picture that carries no `no_five` key — an older door — and an
 * absent account both read as "has one", which is what the app drew before the door said otherwise.
 * Used by this module's `accountInUseUsage` and by the accounts module's UsageRings and ClaudeAccountRowViews,
 * so the default lives in one place.
 */
export function hasFiveHour(row: ClaudeAccountRow | null | undefined): boolean {
  return row?.no_five !== true;
}

/**
 * A reading without its 5-hour window: the window's meter and the pacer's marks on it go, the weekly's stay.
 * An unreachable reading has no windows to drop and is passed through.
 */
function withoutFiveHour(usage: ClaudeUsage): ClaudeUsage {
  if (!usage.reachable || !Array.isArray(usage.windows)) return usage;
  return { ...usage, windows: usage.windows.filter((window) => window.key !== FIVE_HOUR.key) };
}

/**
 * The account in use's newest reading and pace, as the two-window `ClaudeUsage` the meters draw.
 *
 * Drawn at full strength whatever its age: never `degraded`, never an "as of" line. The account in use
 * is read only through the rate-limit reports of the chats and jobs that run on it, and its figures move
 * a whole percent at a time, so a filed-at stamp hours old is still the current figure while nothing
 * has moved it.
 */
function pictureReading(row: ClaudeAccountRow, nowMs: number): ClaudeUsage {
  const reading = row.reading;
  if (reading === null) {
    return {
      reachable: true,
      account: row.digest,
      windows: [unmeasuredWindow(FIVE_HOUR), unmeasuredWindow(WEEKLY)],
      degraded: false,
      reason: '',
      staleSince: null,
      checkedAt: Math.floor(nowMs / 1000),
    };
  }

  const five = points(reading.five);
  const week = points(reading.week);
  // The row's filed-at is wire input as much as its figures are, and `checkedAt` must stay a number:
  // a stamp naming no instant is replaced by the moment this picture was read, the only time we can
  // vouch for.
  const filedAt = Number.isFinite(reading.at) ? reading.at : Math.floor(nowMs / 1000);
  const pace = paceInPercent(row, five, week);

  return {
    reachable: true,
    account: row.digest,
    windows: [
      { key: FIVE_HOUR.key, label: FIVE_HOUR.label, percent: five, resetsAt: resetStamp(reading.five_resets) },
      { key: WEEKLY.key, label: WEEKLY.label, percent: week, resetsAt: resetStamp(reading.week_resets) },
    ],
    degraded: false,
    reason: '',
    staleSince: null,
    checkedAt: filedAt,
    // The key stays absent, not null, when the pacer could weigh neither window.
    ...(pace === undefined ? {} : { pace }),
  };
}

/**
 * The `ClaudeUsage` the account panel's meters draw.
 *
 * Used by the accounts module's AccountPanelBody, so the meters name the account in use and show its figures.
 *
 * The route's body wins when it belongs to the account in use and is healthy — it is a measurement
 * taken now, fresher than anything filed. Every other case falls back to the account in use's newest
 * reading from the door's picture. With no account in use to name (no picture yet, or a door that
 * could not answer) the route's body is passed through untouched, which is exactly what the panel
 * drew before this file existed.
 */
export function accountInUseUsage(
  usage: ClaudeUsage | null,
  picture: ClaudeAccounts | null | undefined,
  nowMs: number,
): ClaudeUsage | null {
  const row = accountInUse(picture);
  if (row === null) return usage;
  const reading = usage !== null && usage.reachable && !usage.degraded && usage.account === row.digest
    ? usage
    : pictureReading(row, nowMs);
  return hasFiveHour(row) ? reading : withoutFiveHour(reading);
}
