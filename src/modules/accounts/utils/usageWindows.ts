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
