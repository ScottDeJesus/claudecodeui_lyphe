import type { DescentUsageWindow } from '@/shared/types';

/** Amber from here up (D7). One number, written once, so no two readings of a window disagree about what "heavy" is. */
export const HEAVY_PERCENT = 80;

/**
 * The reading, rounded ONCE.
 *
 * Descent emits one decimal place (`usage_windows.py:81,123` — `round(float(pct), 1)`), so a
 * raw 79.6 used to print "80% used" over a calm green bar: the label rounded and the threshold
 * did not. Everything downstream — the figure, the tone, the bar, `aria-valuenow` — reads this
 * one integer, so the number the reader sees is the number the threshold judged.
 */
export function windowPercent(usageWindow: DescentUsageWindow): number | null {
  return usageWindow.percent === null ? null : Math.round(usageWindow.percent);
}

/**
 * Warn is a FLOOR, never a ceiling. `severity` is present only when the vendor flagged that
 * window, so its presence alone forces amber: a flagged window can read a comfortable 12 %
 * and still mean an account lock.
 */
export function windowTone(usageWindow: DescentUsageWindow, percent: number | null): 'accent' | 'warn' {
  if (usageWindow.severity) return 'warn';
  return percent !== null && percent >= HEAVY_PERCENT ? 'warn' : 'accent';
}

/**
 * How long until a window turns over, in the largest unit that still says something true:
 * days past a day, hours past an hour, minutes below that.
 *
 * The glance row has room for one short string per bar, and a fixed "5h"/"7d" spends it on the
 * window's LENGTH — a fact that never changes and that the bar beside it already implies. What
 * a person wants at a glance is how long they have.
 *
 * Floors throughout, so a label never claims more time than there is: 23h50m reads "23h", not
 * "1d", and 59m50s reads "59m" rather than the "60m" a ceiling would print. The one exception
 * is the last minute, which reads "1m" rather than "0m" until it is actually spent. `null` when
 * Descent reports no reset time — the caller keeps its static label rather than drawing a blank.
 */
export function formatWindowCountdown(resetsAt: string | null, now: number = Date.now()): string | null {
  if (!resetsAt) return null;

  const at = new Date(resetsAt).getTime();
  if (Number.isNaN(at)) return null;

  const msLeft = at - now;
  if (msLeft <= 0) return 'now';

  const days = Math.floor(msLeft / 86_400_000);
  if (days >= 1) return `${days}d`;

  const hours = Math.floor(msLeft / 3_600_000);
  if (hours >= 1) return `${hours}h`;

  return `${Math.max(1, Math.floor(msLeft / 60_000))}m`;
}
