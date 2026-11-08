import { WINDOW_NAMES, windowPastReset } from '@/modules/accounts/utils/usageWindows';
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
 * THIS IS THE ONE PLACE THE DOOR'S FRACTIONS BECOME PERCENT. The door relays `reading.week`
 * and its `pace` figures as fractions 0..1 (window POINTS, INV-4299 — never dollars); the meters take
 * percent and do no arithmetic, so the conversion happens here, once, and nowhere else.
 *
 * A WINDOW PAST ITS RESET IS DRAWN AS THE WINDOW THAT BEGAN THERE (`windowPastReset`, the one rule). Every
 * reading this file hands out — a row's (`pictureReading`, which the account rows draw through `rowWeek`) and the
 * live route's — has the rule applied before it leaves, so no surface draws a closed window's figure and none carries
 * a rule of its own.
 */

/** The one window every account row draws, and the label the meters already give it. */
const WEEKLY = { key: 'seven_day', label: WINDOW_NAMES.seven_day } as const;

/**
 * A fraction 0..1 as the wire's whole percent — the same rounding `usage.service.ts` applies.
 * `null` is a week the pacer could not measure, and stays `null`: the meters draw an em-dash,
 * never a false `0% used`. The wire is untrusted at its edges: an absent or unreadable figure is
 * `null` too, because `Math.round(undefined * 100)` is `NaN`, which `Meter` would draw as a live
 * `NaN%` bar carrying `aria-valuenow="NaN"`.
 */
function points(fraction: number | null): number | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  return Math.round(fraction * 100);
}

/**
 * Epoch SECONDS → the ISO-8601 stamp `ClaudeUsageWindow.resetsAt` carries; no readable stamp
 * (null, absent, not a finite number, or a number past the Date range) stays `null` —
 * `toISOString` throws in render on an invalid Date, and every row's windows are built here.
 */
function resetStamp(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  // Finite is not enough: `1e20` seconds is past the ±8.64e15 ms a Date can hold, and is an invalid Date.
  const instant = new Date(seconds * 1000);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** A window nobody has measured reads as an em-dash over an empty track, never as zero used. */
function unmeasuredWindow(window: { key: string; label: string }): ClaudeUsageWindow {
  return { key: window.key, label: window.label, percent: null, resetsAt: null };
}

/**
 * The row's pace (fractions) as `ClaudeUsage.pace` (percent), the shape `UsageMeters` already reads.
 * The row carries only where the week PROJECTS and its ceiling; the used figure is the reading's
 * own, and `words` is empty because the rule's caption belongs to the live route's picture, not to a
 * filed reading. `undefined` when the pacer could not weigh the week — `ClaudeUsage.pace` is ABSENT
 * on a reading with no pace, exactly like the route's absent key.
 */
function paceInPercent(row: ClaudeAccountRow, week: number | null): ClaudeUsagePace | undefined {
  const pace = row.pace;
  // `!pace` and `?? null`: the wire is untrusted, and a row with no `pace`, or a `pace` with no `week`, is a pacer that
  // weighed nothing — never a throw in render, which every page runs through the rail's ring.
  if (!pace) return undefined;
  const weekPace = pace.week ?? null;
  return {
    used7: week,
    projected7: weekPace === null ? null : points(weekPace.projected),
    ceiling7: weekPace === null ? null : points(weekPace.ceiling),
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

/** A reading the route could take: the `reachable: true` arm of `ClaudeUsage`. */
type ReachableUsage = Extract<ClaudeUsage, { reachable: true }>;

/**
 * A reading with every window past its reset carried to the window that began there (`windowPastReset`), and
 * the pacer's marks on a carried week dropped with the figure they were projected from: the projected end
 * and the caption describe the closed week, so only the ceiling — a setting, not a reading — stays on
 * it. Returned untouched when no window is past its reset.
 *
 * `staleSince ?? checkedAt` is when the figures were READ, the instant a reset must follow to be one the
 * reading has not seen (a row's `checkedAt` is its filed-at): a figure read at or after its own reset is the
 * provider's word for that moment and is never zeroed.
 */
function withCarriedWindows(usage: ReachableUsage, nowMs: number): ReachableUsage {
  if (!Array.isArray(usage.windows)) return usage;
  const readAtMs = (usage.staleSince ?? usage.checkedAt) * 1000;
  const windows = usage.windows.map((usageWindow) => windowPastReset(usageWindow, readAtMs, nowMs));
  const carriedKeys = new Set(windows.filter((usageWindow, index) => usageWindow !== usage.windows[index]).map((usageWindow) => usageWindow.key));
  if (carriedKeys.size === 0) return usage;

  const pace = usage.pace;
  // `!pace`, not `=== undefined`: the wire is untrusted, and a `null` pace spread below would invent a partial one
  // with no `words` for the caption to trim.
  if (!pace) return { ...usage, windows };
  return {
    ...usage,
    windows,
    pace: {
      ...pace,
      ...(carriedKeys.has(WEEKLY.key) ? { used7: 0, projected7: null, words: '' } : {}),
    },
  };
}

/**
 * A row's newest reading and pace, as the `ClaudeUsage` the meters draw, with a window past its
 * reset carried to the window that began there.
 *
 * Drawn at full strength whatever its age: never `degraded`, never an "as of" line. An account is read only
 * through the rate-limit reports of the chats and jobs that run on it, and its figures move a whole percent
 * at a time, so a filed-at stamp hours old is still the current figure while nothing has moved it — and a
 * reset that has passed since is a window nothing has used.
 */
function pictureReading(row: ClaudeAccountRow, nowMs: number): ReachableUsage {
  const reading = row.reading;
  if (reading === null) {
    return {
      reachable: true,
      account: row.digest,
      windows: [unmeasuredWindow(WEEKLY)],
      degraded: false,
      reason: '',
      staleSince: null,
      checkedAt: Math.floor(nowMs / 1000),
    };
  }

  const week = points(reading.week);
  // The row's filed-at is wire input as much as its figures are, and `checkedAt` must stay a number:
  // a stamp naming no instant is replaced by the moment this picture was read, the only time we can
  // vouch for.
  const filedAt = Number.isFinite(reading.at) ? reading.at : Math.floor(nowMs / 1000);
  const pace = paceInPercent(row, week);

  return withCarriedWindows({
    reachable: true,
    account: row.digest,
    windows: [{ key: WEEKLY.key, label: WEEKLY.label, percent: week, resetsAt: resetStamp(reading.week_resets) }],
    degraded: false,
    reason: '',
    staleSince: null,
    checkedAt: filedAt,
    // The key stays absent, not null, when the pacer could not weigh the week.
    ...(pace === undefined ? {} : { pace }),
  }, nowMs);
}

/**
 * One account row's week as every surface draws it: its newest reading, the week carried when it is past its
 * reset (`pictureReading`), so a row, the meters and the ring never disagree about it. A row with no reading
 * has an unmeasured week (`percent: null`, no reset).
 *
 * Used by the accounts module's ClaudeAccountRowViews, for each row's ring.
 */
export function rowWeek(row: ClaudeAccountRow, nowMs: number): ClaudeUsageWindow {
  const { windows } = pictureReading(row, nowMs);
  return windows.find((usageWindow) => usageWindow.key === WEEKLY.key) ?? unmeasuredWindow(WEEKLY);
}

/**
 * The `ClaudeUsage` the account panel's meters draw.
 *
 * Used by the accounts module's AccountPanelBody, so the meters name the account in use and show its figures.
 *
 * The route's body wins when it belongs to the account in use and is healthy — it is a measurement
 * taken now, fresher than anything filed. Every other case falls back to the account in use's newest
 * reading from the door's picture. With no account in use to name (no picture yet, or a door that
 * could not answer) the route's body is drawn as it is. Whichever reading wins, a window past its reset
 * is carried (`windowPastReset`) — a route window the server marked `rolled`, and one whose reset passed
 * since the body was read.
 */
export function accountInUseUsage(
  usage: ClaudeUsage | null,
  picture: ClaudeAccounts | null | undefined,
  nowMs: number,
): ClaudeUsage | null {
  const row = accountInUse(picture);
  if (row === null) return usage !== null && usage.reachable ? withCarriedWindows(usage, nowMs) : usage;
  return usage !== null && usage.reachable && !usage.degraded && usage.account === row.digest
    ? withCarriedWindows(usage, nowMs)
    : pictureReading(row, nowMs);
}
