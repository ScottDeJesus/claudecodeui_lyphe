import type { ClaudeUsageWindow, Tone } from '@/shared/types';

/** The window this app has its own name for, in the words the meters print and the usage ring's hover repeats. */
export const WINDOW_NAMES = { seven_day: 'This week' } as const;

/** Amber from here up (D7). One number, written once, so no two readings of a window disagree about what "heavy" is. */
export const HEAVY_PERCENT = 80;

/**
 * The reading, rounded ONCE.
 *
 * The meter emits one decimal place (`server/modules/accounts/usage-windows.ts`, `round1`), so a
 * raw 79.6 used to print "80% used" over a calm green bar: the label rounded and the threshold
 * did not. Everything downstream — the figure, the tone, the bar, `aria-valuenow` — reads this
 * one integer, so the number the reader sees is the number the threshold judged.
 *
 * The wire is untrusted at its edges: an ABSENT or non-finite `percent` is `null` too, because
 * `Math.round(undefined)` is `NaN`, which no threshold judges and every reader would draw as "NaN%".
 */
export function windowPercent(usageWindow: ClaudeUsageWindow): number | null {
  const { percent } = usageWindow;
  return typeof percent === 'number' && Number.isFinite(percent) ? Math.round(percent) : null;
}

/**
 * Warn is a FLOOR, never a ceiling. `severity` is present only when the vendor flagged that
 * window, so its presence alone forces amber: a flagged window can read a comfortable 12 %
 * and still mean an account lock.
 */
export function windowTone(usageWindow: ClaudeUsageWindow, percent: number | null): 'accent' | 'warn' {
  if (usageWindow.severity) return 'warn';
  return percent !== null && percent >= HEAVY_PERCENT ? 'warn' : 'accent';
}

/**
 * The figure as the reader should see it.
 *
 * `0` is a REAL reading and says "0% used" over an empty track; only `null` is an em-dash.
 *
 * No `▲` is written here: the Meter's own warn rule prepends it, and a second one would
 * double the mark.
 */
export function windowValue(percent: number | null): string {
  return percent === null ? '—' : `${percent}% used`;
}

/** Red from here, on the ring: the figure where the account is approaching its last usage. */
const RING_DANGER_PERCENT = 90;

/** Yellow from here. The week is the window the operator watches for how bad it is. Written here and nowhere else. */
const RING_WARN_PERCENT = 75;

/**
 * The Verve tone a usage ring's container carries as `data-tone`: green below `RING_WARN_PERCENT`, yellow from it, red
 * from `RING_DANGER_PERCENT`. A figure ON a boundary takes the higher colour (75 is yellow, 90 is red).
 * Judged on the ROUNDED figure `windowPercent` gives, the one the tooltip prints, so a ring never says 75% beside green.
 * `null` is no reading and no tone — the ring draws its track alone. The bar meters keep `windowTone`'s own two states.
 */
export function ringTone(percent: number | null): Tone | null {
  if (percent === null) return null;
  if (percent >= RING_DANGER_PERCENT) return 'danger';
  return percent >= RING_WARN_PERCENT ? 'warn' : 'positive';
}

/**
 * `Z` or a numeric offset at the end of an ISO stamp — the difference between a UTC instant and one
 * `Date` would read as local time. Mirrored from the server's own `HAS_ZONE`
 * (`server/modules/accounts/usage-windows.ts`), because the two ends must agree.
 */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * One `resetsAt` string → the instant it names, in epoch MILLISECONDS — or `NaN` when it names none.
 *
 * ⚠ A stamp carrying NO offset is read as UTC, which is the rule the server's `resetEpoch` applies
 * too. The server decides `rolled` from this same string, so a reader that answered differently
 * would carry a window to 0% by one moment and count down to another. The live payload carries
 * `+00:00`; this is the rule for the day it stops.
 */
export function resetInstant(resetsAt: string): number {
  return new Date(HAS_ZONE.test(resetsAt) ? resetsAt : `${resetsAt}Z`).getTime();
}

/**
 * The time left until `resetsAt`, as a usage ring's label says it: ONE unit, rounded UP — whole days while a day or more
 * is left, then whole hours, then whole minutes ("5d", "4h", "45m"), and "0m" once the moment has passed. Rounded up, so
 * the label never says the reset is nearer than it is; a figure that rounds up into the next unit is said in that unit
 * ("1h", never "60m"; "1d", never "24h"). `null` when there is no reset time to count to.
 *
 * `now` is the caller's clock in epoch milliseconds (the rings' minute tick), so the label moves on with it.
 */
export function resetCountdown(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const msLeft = resetInstant(resetsAt) - now;
  if (Number.isNaN(msLeft)) return null;
  if (msLeft <= 0) return '0m';
  const minutes = Math.ceil(msLeft / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(msLeft / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(msLeft / 86_400_000)}d`;
}

/** A weekly window turns over every seven days to the second, so its stored reset steps by exactly this. */
const WEEK_MS = 7 * 86_400_000;

/**
 * Whether a window's period is a week: `seven_day`, its model-scoped kin and `weekly_scoped:*`. Any other window
 * (`limit:*`) starts at first use or at a period nobody here knows, so its next reset is not knowable.
 */
function repeatsWeekly(key: string): boolean {
  return key.startsWith('seven_day') || key.startsWith('weekly_scoped');
}

/**
 * THE ONE RULE FOR A WINDOW PAST ITS RESET: it reads as the window that began at that reset — 0% used.
 *
 * A figure moves only when something uses the account, and a window that has reset since the last reading
 * has been used by nothing the reading could have seen: the old figure describes a closed window, and
 * drawing it (or "was N%") would put last week's number on this week. So the figure is 0, and the reset it
 * names is the next one:
 *   - a weekly window's reset steps forward in whole 7-day steps to the first still ahead of `nowMs`;
 *   - any other window states NO reset (`resetsAt: null`) — it starts at first use or at a period nobody here
 *     knows, so after its reset there is no running window and no reset to count to, until a reading brings one.
 * The figure the window held before does not matter, and neither does the vendor's `severity`: it flagged the
 * closed window, so a carried window carries neither (a flag would keep a 0% bar amber).
 *
 * A window is past its reset when the server marked it `rolled` (its reading predates a reset that has
 * passed — `server/modules/accounts/usage-windows.ts`), or when its reset is at or before `nowMs` and fell AFTER
 * the reading was taken (`readAtMs`): the same test, for what the server did not mark — a door row's reading, or
 * a route body that has aged past its reset on this clock. A reading taken at or after the instant is
 * authoritative for the moment it answered, so clock skew never zeroes a fresh figure; a reset that names no
 * instant carries nothing. Neither does a window with NO figure (`windowPercent` answers `null`): there is no
 * closed window's number to protect, and a carried 0% would draw a window nobody measured as "nothing used".
 *
 * Returns the SAME object when the window is not carried, so a caller can tell a carried window by
 * identity. The carried 0% is drawn, never filed: this is presentation, and the pacer never sees it.
 *
 * Used by this module's `accountInUseUsage` file, which applies it to every reading the meters, the rings and the
 * account rows draw.
 */
export function windowPastReset(usageWindow: ClaudeUsageWindow, readAtMs: number, nowMs: number): ClaudeUsageWindow {
  // Unknown is never zero: only a window that had a figure is carried to the 0% of the window that began at its reset.
  if (windowPercent(usageWindow) === null) return usageWindow;
  const resetMs = typeof usageWindow.resetsAt === 'string' ? resetInstant(usageWindow.resetsAt) : Number.NaN;
  const pastReset = usageWindow.rolled === true || (readAtMs < resetMs && resetMs <= nowMs);
  if (!pastReset) return usageWindow;

  // At least one step: a window the server marked rolled by its own clock can still be ahead on this one,
  // and its closed week's reset is never the next reset.
  const nextResetMs = repeatsWeekly(usageWindow.key) && Number.isFinite(resetMs)
    ? resetMs + Math.max(1, Math.floor((nowMs - resetMs) / WEEK_MS) + 1) * WEEK_MS
    : null;
  return {
    key: usageWindow.key,
    label: usageWindow.label,
    percent: 0,
    resetsAt: nextResetMs === null ? null : new Date(nextResetMs).toISOString(),
  };
}
