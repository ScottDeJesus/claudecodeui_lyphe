import type { CodeModeDay } from '@/shared/analytics-types';

/**
 * THE SECTION'S ARITHMETIC, and nothing else: no React, no reading, no word of its own. Every number the section
 * draws is the verb's (the server takes no median and neither does the screen); what is worked out here is only
 * shares and differences of those numbers, the plot's day list, and durations and token counts as words.
 *
 * A FIGURE AS WORDS IS A KEY AND ITS VALUES (`Worded`), never a finished string: a unit is a word, and every word the
 * area draws is a value under `analytics.codeMode.units`. A part says one through its own `t`.
 *
 * THE SCAFFOLD HOLDS STAND-INS. Each body below is the least that lets the section draw against its fake answer, and
 * carries a `FILL:` line saying what the real one owes. The names, parameters and return shapes are the seam the four
 * parts are composed against: the fill replaces bodies and nothing else.
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

/** How many of a measure's own unit one step of the plot stands for: tokens are drawn in thousands, time in minutes. */
export const PLOT_UNIT: Record<TrendMeasure, number> = { launches: 1, turns: 1, tokens: 1000, seconds: 60, failures: 1 };

/** A part's share of a whole as words ("2.9%"), or null when there is no whole to be a share of. */
export function shareWords(part: number, whole: number): Worded | null {
  // FILL: shareWords — one decimal under 10%, none from there on; a part that rounds to nothing while it is not nothing says so; null when the whole is 0.
  if (whole <= 0) return null;
  const percent = (part / whole) * 100;
  return { key: UNITS + 'share', values: { value: percent > 0 && percent < 10 ? percent.toFixed(1) : Math.round(percent) } };
}

/** A part over its whole as a number from 0 to 1, for `pointsDifference` to compare two rates; null when there is no whole. */
export function ratio(part: number, whole: number): number | null {
  // FILL: ratio
  return whole > 0 ? part / whole : null;
}

/**
 * A Code Mode figure against the same figure without, as a signed share OF THE FIGURE WITHOUT ("−36%", "+8%").
 * Every figure it compares is the better for being lower (turns, tokens, time), so more is the worse way round. A rate is
 * `pointsDifference`'s.
 */
export function difference(withFigure: number | null, withoutFigure: number | null): Difference | null {
  // FILL: difference — null when either side is missing or the figure without is 0; a difference that rounds to 0% is never worse.
  if (withFigure === null || withoutFigure === null || withoutFigure === 0) return null;
  const share = Math.round(((withFigure - withoutFigure) / withoutFigure) * 100);
  const key = UNITS + ['fewer', 'same', 'more'][Math.sign(share) + 1];
  return { words: { key, values: { value: Math.abs(share) } }, worse: share > 0 };
}

/**
 * A Code Mode rate against the same rate without, both from 0 to 1, as signed percentage POINTS ("+10 pts"): beside two
 * percentages a reader subtracts, and a share of a share gives them another number. A higher rate is the better one.
 */
export function pointsDifference(withRate: number | null, withoutRate: number | null): Difference | null {
  // FILL: pointsDifference — null when either side is missing; the points are the two shares AS DRAWN (shareWords' rounding) subtracted, so the three numbers on a line always agree; 0 pts is never worse.
  if (withRate === null || withoutRate === null) return null;
  const points = Math.round(withRate * 100) - Math.round(withoutRate * 100);
  const key = UNITS + ['pointsFewer', 'pointsSame', 'pointsMore'][Math.sign(points) + 1];
  return { words: { key, values: { value: Math.abs(points) } }, worse: points < 0 };
}

/** Seconds as words: "48s", "6m 12s", "1h 4m". */
export function durationWords(seconds: number): Worded {
  // FILL: durationWords — two units at most, the larger one whole; a day and more says days and hours (a key of its own under units).
  if (seconds < 60) return { key: UNITS + 'seconds', values: { seconds: Math.round(seconds) } };
  if (seconds < 3600) return { key: UNITS + 'minutes', values: { minutes: Math.floor(seconds / 60), seconds: Math.round(seconds % 60) } };
  return { key: UNITS + 'hours', values: { hours: Math.floor(seconds / 3600), minutes: Math.round((seconds % 3600) / 60) } };
}

/** A token count as words: "940", "182k", "1.2M". */
export function tokenWords(tokens: number): Worded {
  // FILL: tokenWords — three figures at most ("9.4k", "182k", "1.2M"), the reader's decimal mark.
  if (tokens < 1000) return { key: UNITS + 'count', values: { value: Math.round(tokens) } };
  if (tokens < 1_000_000) return { key: UNITS + 'thousand', values: { value: Math.round(tokens / 1000) } };
  return { key: UNITS + 'million', values: { value: (tokens / 1_000_000).toFixed(1) } };
}

/** One of a day's two figures as words, by the measure drawn: a token count, a duration, or a plain count with the reader's grouping. */
export function measureWords(measure: TrendMeasure, figure: number): Worded {
  // FILL: measureWords
  if (measure === 'tokens') return tokenWords(figure);
  if (measure === 'seconds') return durationWords(figure);
  return { key: UNITS + 'count', values: { value: figure.toLocaleString() } };
}

/**
 * The plot's days for one kind (null is every kind) and one measure, oldest first. Launches are counted; turns, tokens
 * (in plus out) and seconds are the day's sums, so the legend's totals are the window's. `failures` reads the Code Mode
 * row alone: scripts thrown first, actions refused or failed second. Every other measure is with first, without second.
 */
export function dayList(series: CodeModeDay[], kind: string | null, measure: TrendMeasure, span: TrendSpan): TrendDay[] {
  // FILL: dayList — every day from the later of the window's start (today − days + 1) and firstDay to today, a day with no row as zeros; the stand-in lists only the days that have a row.
  const rows = series.filter((row) => row.kind === kind && row.day <= span.today);
  const figureOf = (row: CodeModeDay | undefined): number => {
    if (row === undefined) return 0;
    if (measure === 'turns') return row.turns_total;
    if (measure === 'tokens') return row.tokens_in_total + row.tokens_out_total;
    if (measure === 'seconds') return row.seconds_total;
    return row.launches;
  };
  return Array.from(new Set(rows.map((row) => row.day)))
    .sort()
    .map((day) => {
      const withRow = rows.find((row) => row.day === day && row.code_mode);
      const withoutRow = rows.find((row) => row.day === day && !row.code_mode);
      const figures: [number, number] =
        measure === 'failures' ? [withRow?.thrown ?? 0, (withRow?.refused ?? 0) + (withRow?.failed ?? 0)] : [figureOf(withRow), figureOf(withoutRow)];
      return { day, figures, values: [Math.round(figures[0] / PLOT_UNIT[measure]), Math.round(figures[1] / PLOT_UNIT[measure])] };
    });
}

/** How many days of the window the history covers, today and its first day both counted; null when it covers them all, or has not begun. */
export function daysCovered(span: TrendSpan): number | null {
  // FILL: daysCovered — by the calendar, never by 24-hour steps (a clock change must not lose a day).
  if (span.firstDay === null) return null;
  const covered = Math.round((Date.parse(span.today) - Date.parse(span.firstDay)) / 86_400_000) + 1;
  return covered < span.days ? covered : null;
}

/** What a count holds beyond the parts listed under it; never under zero. */
export function restOf(count: number, parts: { count: number }[]): number {
  // FILL: restOf
  return Math.max(0, count - parts.reduce((sum, part) => sum + part.count, 0));
}
