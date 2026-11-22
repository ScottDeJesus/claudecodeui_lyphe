import type { CodeModeDay } from '@/shared/analytics-types';

/**
 * THE SECTION'S ARITHMETIC, and nothing else: no React, no reading, no word of its own. Every number the section
 * draws is the verb's (the server takes no median and neither does the screen); what is worked out here is only
 * shares and differences of those numbers, the plot's day list, and durations and token counts as words.
 *
 * A FIGURE AS WORDS IS A KEY AND ITS VALUES (`Worded`), never a finished string: a unit is a word, and every word the
 * area draws is a value under `analytics.codeMode.units`. A part says one through its own `t`.
 */

/** A figure as words: a key under `analytics.codeMode.units` and the values it takes. */
export type Worded = { key: string; values: Record<string, string | number> };

/** A Code Mode figure against the same figure without: the signed share as words, and whether it is the worse way round. */
export type Difference = { words: Worded; worse: boolean };

/** What the trend can draw. `failures` is the one measure that is not with against without. */
export type TrendMeasure = 'launches' | 'turns' | 'tokens' | 'seconds' | 'failures';

/**
 * One day of the plot. `figures` are the day's own two numbers, which the table and a bar's title say as words;
 * `values` are the same two in the plot's unit (`PLOT_UNIT`), whole, which the bars and the legend's totals are drawn from.
 */
export type TrendDay = { day: string; values: [number, number]; figures: [number, number] };

/** The window as the answer states it: `first_day`, `today` and `days`. */
export type TrendSpan = { firstDay: string | null; today: string; days: number };

const UNITS = 'analytics.codeMode.units.';

/** Under this percent a share is drawn to a tenth ("2.9%"); from it on, whole ("37%"). */
const TENTHS_BELOW_PERCENT = 10;

/** The smallest share drawn as itself: a part under it that is not nothing is said as "under 0.1%". */
const SMALLEST_DRAWN_PERCENT = 0.1;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1_440;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = 86_400_000;

/** A token count from 1,000 on is drawn in the first scale that keeps it under 1,000 of it. */
const TOKEN_SCALES: { key: string; size: number }[] = [
  { key: 'thousand', size: 1_000 },
  { key: 'million', size: 1_000_000 },
];
const LARGEST_TOKEN_SCALE = { key: 'billion', size: 1_000_000_000 };
const SCALED_BELOW = 1_000;

// The reader's own grouping and decimal mark: `undefined` is the browser's locale.
const WHOLE = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** How many of a measure's own unit one step of the plot stands for: tokens are drawn in thousands, time in minutes. */
export const PLOT_UNIT: Record<TrendMeasure, number> = { launches: 1, turns: 1, tokens: 1000, seconds: 60, failures: 1 };

/** A part's share of a whole as words ("2.9%"), or null when there is no whole to be a share of. */
export function shareWords(part: number, whole: number): Worded | null {
  if (whole <= 0) return null;
  const percent = drawnPercent(part / whole);
  if (percent === 0 && part > 0) return { key: UNITS + 'shareUnder', values: { value: ONE_DECIMAL.format(SMALLEST_DRAWN_PERCENT) } };
  return { key: UNITS + 'share', values: { value: percentWords(percent) } };
}

/** A part over its whole as a number from 0 to 1, for `pointsDifference` to compare two rates; null when there is no whole. */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/**
 * A Code Mode figure against the same figure without, as a signed share OF THE FIGURE WITHOUT ("−36%", "+8%").
 * Every figure it compares is the better for being lower (turns, tokens, time), so more is the worse way round. A rate is
 * `pointsDifference`'s.
 */
export function difference(withFigure: number | null, withoutFigure: number | null): Difference | null {
  if (withFigure === null || withoutFigure === null || withoutFigure === 0) return null;
  const share = Math.round(((withFigure - withoutFigure) / withoutFigure) * 100);
  if (share === 0) return { words: { key: UNITS + 'same', values: {} }, worse: false };
  return { words: { key: UNITS + (share > 0 ? 'more' : 'fewer'), values: { value: WHOLE.format(Math.abs(share)) } }, worse: share > 0 };
}

/**
 * A Code Mode rate against the same rate without, both from 0 to 1, as signed percentage POINTS ("+10 pts"): beside two
 * percentages a reader subtracts, and a share of a share gives them another number. A higher rate is the better one.
 */
export function pointsDifference(withRate: number | null, withoutRate: number | null): Difference | null {
  if (withRate === null || withoutRate === null) return null;
  // Tenths are rounded again: 9.6 − 3.2 must say 6.4, never 6.399999.
  const points = Math.round((drawnPercent(withRate) - drawnPercent(withoutRate)) * 10) / 10;
  if (points === 0) return { words: { key: UNITS + 'pointsSame', values: {} }, worse: false };
  const size = Math.abs(points);
  const value = Number.isInteger(size) ? WHOLE.format(size) : ONE_DECIMAL.format(size);
  return { words: { key: UNITS + (points > 0 ? 'pointsMore' : 'pointsFewer'), values: { value } }, worse: points < 0 };
}

/** Seconds as words: "48s", "6m 12s", "1h 4m". */
export function durationWords(seconds: number): Worded {
  const wholeSeconds = Math.round(seconds);
  if (wholeSeconds < SECONDS_PER_MINUTE) return { key: UNITS + 'seconds', values: { seconds: wholeSeconds } };
  if (wholeSeconds < SECONDS_PER_HOUR) {
    return { key: UNITS + 'minutes', values: { minutes: Math.floor(wholeSeconds / SECONDS_PER_MINUTE), seconds: wholeSeconds % SECONDS_PER_MINUTE } };
  }
  const wholeMinutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (wholeMinutes < MINUTES_PER_DAY) {
    return { key: UNITS + 'hours', values: { hours: Math.floor(wholeMinutes / MINUTES_PER_HOUR), minutes: wholeMinutes % MINUTES_PER_HOUR } };
  }
  const wholeHours = Math.round(seconds / SECONDS_PER_HOUR);
  return { key: UNITS + 'days', values: { days: WHOLE.format(Math.floor(wholeHours / HOURS_PER_DAY)), hours: wholeHours % HOURS_PER_DAY } };
}

/** A token count as words: "940", "182k", "1.2M". */
export function tokenWords(tokens: number): Worded {
  if (Math.round(tokens) < SCALED_BELOW) return { key: UNITS + 'count', values: { value: WHOLE.format(tokens) } };
  const scale = TOKEN_SCALES.find(({ size }) => Math.round(tokens / size) < SCALED_BELOW) ?? LARGEST_TOKEN_SCALE;
  return { key: UNITS + scale.key, values: { value: threeFigures(tokens / scale.size) } };
}

/** One of a day's two figures as words, by the measure drawn: a token count, a duration, or a plain count with the reader's grouping. */
export function measureWords(measure: TrendMeasure, figure: number): Worded {
  if (measure === 'tokens') return tokenWords(figure);
  if (measure === 'seconds') return durationWords(figure);
  return { key: UNITS + 'count', values: { value: WHOLE.format(figure) } };
}

/**
 * The plot's days for one kind (null is every kind) and one measure, oldest first. Launches are counted; turns, tokens
 * (in plus out) and seconds are the day's sums, so the legend's totals are the window's. `failures` reads the Code Mode
 * row alone: scripts thrown first, actions refused or failed second. Every other measure is with first, without second.
 */
export function dayList(series: CodeModeDay[], kind: string | null, measure: TrendMeasure, span: TrendSpan): TrendDay[] {
  const rowOf = new Map<string, CodeModeDay>();
  for (const row of series) {
    if (row.kind === kind) rowOf.set(rowKey(row.day, row.code_mode), row);
  }
  return plotDays(span).map((day) => {
    const withRow = rowOf.get(rowKey(day, true));
    const withoutRow = rowOf.get(rowKey(day, false));
    const figures: [number, number] =
      measure === 'failures'
        ? [withRow?.thrown ?? 0, (withRow?.refused ?? 0) + (withRow?.failed ?? 0)]
        : [dayFigure(withRow, measure), dayFigure(withoutRow, measure)];
    return { day, figures, values: [Math.round(figures[0] / PLOT_UNIT[measure]), Math.round(figures[1] / PLOT_UNIT[measure])] };
  });
}

/** How many days of the window the history covers, today and its first day both counted; null when it covers them all, or has not begun. */
export function daysCovered(span: TrendSpan): number | null {
  if (span.firstDay === null) return null;
  const covered = dayNumber(span.today) - dayNumber(span.firstDay) + 1;
  return covered < span.days ? covered : null;
}

/** What a count holds beyond the parts listed under it; never under zero. */
export function restOf(count: number, parts: { count: number }[]): number {
  return Math.max(0, count - parts.reduce((sum, part) => sum + part.count, 0));
}

/** A rate (0 to 1) as the percent the screen draws: to a tenth under 10%, whole from there on. */
function drawnPercent(rate: number): number {
  const tenths = Math.round(rate * 1000) / 10;
  return tenths < TENTHS_BELOW_PERCENT ? tenths : Math.round(rate * 100);
}

/** A drawn percent in the reader's digits, with its tenth while it is under 10. */
function percentWords(percent: number): string {
  return percent < TENTHS_BELOW_PERCENT ? ONE_DECIMAL.format(percent) : WHOLE.format(percent);
}

/** A scaled count in three figures at most: "9.4", "182". */
function threeFigures(scaled: number): string {
  const tenths = Math.round(scaled * 10) / 10;
  return tenths < 10 ? ONE_DECIMAL.format(tenths) : WHOLE.format(scaled);
}

/** One day's figure of one side, by the measure: launches are counted, the rest are the day's sums. */
function dayFigure(row: CodeModeDay | undefined, measure: Exclude<TrendMeasure, 'failures'>): number {
  if (row === undefined) return 0;
  switch (measure) {
    case 'launches':
      return row.launches;
    case 'turns':
      return row.turns_total;
    case 'tokens':
      return row.tokens_in_total + row.tokens_out_total;
    case 'seconds':
      return row.seconds_total;
    default: {
      const unhandled: never = measure;
      return unhandled;
    }
  }
}

function rowKey(day: string, codeMode: boolean): string {
  return day + (codeMode ? '|with' : '|without');
}

/** Every day the plot draws, oldest first: from the later of the window's start and the history's first day, to today. */
function plotDays(span: TrendSpan): string[] {
  const today = dayNumber(span.today);
  const windowStart = today - span.days + 1;
  const start = span.firstDay === null ? windowStart : Math.max(windowStart, dayNumber(span.firstDay));
  const days: string[] = [];
  for (let day = start; day <= today; day += 1) days.push(new Date(day * MS_PER_DAY).toISOString().slice(0, 10));
  return days;
}

/**
 * A YYYY-MM-DD as a count of calendar days. Read as UTC midnight, where no clock ever changes, so two dates are always
 * a whole number of days apart.
 */
function dayNumber(day: string): number {
  return Math.round(Date.parse(day + 'T00:00:00Z') / MS_PER_DAY);
}
