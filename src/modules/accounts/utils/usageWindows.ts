import type { ClaudeUsageWindow } from '@/shared/types';

/** Amber from here up (D7). One number, written once, so no two readings of a window disagree about what "heavy" is. */
export const HEAVY_PERCENT = 80;

/**
 * The reading, rounded ONCE.
 *
 * The meter emits one decimal place (`server/modules/accounts/usage-windows.ts`, `round1`), so a
 * raw 79.6 used to print "80% used" over a calm green bar: the label rounded and the threshold
 * did not. Everything downstream — the figure, the tone, the bar, `aria-valuenow` — reads this
 * one integer, so the number the reader sees is the number the threshold judged.
 */
export function windowPercent(usageWindow: ClaudeUsageWindow): number | null {
  return usageWindow.percent === null ? null : Math.round(usageWindow.percent);
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
 * would put "was 88 % used" beside a countdown to a different moment. The live payload carries
 * `+00:00`; this is the rule for the day it stops.
 */
export function resetInstant(resetsAt: string): number {
  return new Date(HAS_ZONE.test(resetsAt) ? resetsAt : `${resetsAt}Z`).getTime();
}
