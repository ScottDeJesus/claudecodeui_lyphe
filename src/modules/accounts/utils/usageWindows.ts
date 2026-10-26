import type { ClaudeUsageWindow, Tone } from '@/shared/types';

/** The two windows this app has its own name for, in the words the meters print and the usage rings' hover repeats. */
export const WINDOW_NAMES = { five_hour: 'Current 5-hour window', seven_day: 'This week' } as const;

/** The window keys the rings draw: each one's tone band is its own. */
type RingWindowKey = keyof typeof WINDOW_NAMES;

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
 * A `rolled` window keeps its real percent and says "was" — its window has already ended, and
 * draining the bar would draw a full tank nobody measured.
 *
 * No `▲` is written here: the Meter's own warn rule prepends it, and a second one would
 * double the mark.
 */
export function windowValue(percent: number | null, rolled: boolean): string {
  if (percent === null) return '—';
  const figure = `${percent}% used`;
  return rolled ? `was ${figure}` : figure;
}

/** Red from here, on both rings: the figures where the account is approaching its last usage. */
const RING_DANGER_PERCENT = 90;

/**
 * Yellow from here, per window. The week is the one the operator watches for how bad it is (75); the 5-hour window
 * refills within hours, so its yellow comes a little later (80). Written here and nowhere else.
 */
const RING_WARN_PERCENT: Record<RingWindowKey, number> = { five_hour: 80, seven_day: 75 };

/**
 * The Verve tone a usage ring's container carries as `data-tone`: green below the window's yellow, yellow from it, red
 * from `RING_DANGER_PERCENT`. A figure ON a boundary takes the higher colour (75 on the week is yellow, 90 is red).
 * Judged on the ROUNDED figure `windowPercent` gives, the one the tooltip prints, so a ring never says 75% beside green.
 * `null` is no reading and no tone — the ring draws its track alone. The bar meters keep `windowTone`'s own two states.
 */
export function ringTone(windowKey: RingWindowKey, percent: number | null): Tone | null {
  if (percent === null) return null;
  if (percent >= RING_DANGER_PERCENT) return 'danger';
  return percent >= RING_WARN_PERCENT[windowKey] ? 'warn' : 'positive';
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
