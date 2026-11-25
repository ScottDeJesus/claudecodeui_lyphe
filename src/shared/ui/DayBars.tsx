import type { Tone } from '@/shared/types';

type DayBarsSeries = {
  /** The series' name in the legend ("Opened"). */
  label: string;
  /** The ink its bars and its legend mark wear, through the `[data-tone]` swap. Left off, the accent. */
  tone?: Tone;
  /** The series' figure over the whole window, in the caller's words ("$9.45"). Left off, the sum of its values with the locale's grouping. */
  total?: string;
};

type DayBarsDay = {
  /** `YYYY-MM-DD`. The row's key, and what the axis under the plot names. */
  day: string;
  /** One value per series, in the order of `series`. */
  values: number[];
  /** The day's whole reading, in the caller's words ("Nov 19 · 3 opened · 1 fixed"): the column's title. */
  title: string;
};

type DayBarsProps = {
  /** The days of the window, oldest first. The last one is today's, and a short rule under its column marks it. */
  days: DayBarsDay[];
  /** One series, or two. */
  series: [DayBarsSeries] | [DayBarsSeries, DayBarsSeries];
  /** The plot's one spoken sentence ("Cards opened and fixed per day, the last 30 days"). */
  label: string;
  /** The words for the plot's scale, given its tallest bar ("Tallest bar: 7 in a day"). Every bar is its share of that. */
  peakLabel: (peak: number) => string;
};

/** The height of one series' side of the plot: the whole plot for one series, a half of it each for two. */
const ONE_SERIES_PX = 96;
const TWO_SERIES_PX = 64;
/** From this many days on, the columns stand a hairline apart instead of 4 px, so 90 days still fit a phone. */
const DENSE_FROM = 45;
/** The fewest days that get a third date under the plot, at its middle. */
const MIDDLE_DATE_FROM = 14;

/** `2026-09-19` → `Sep 19`, built from the parts so the box's own zone never shifts the day. */
function dateLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Used by the kanban module's bug dashboard (cards opened and fixed per day) and the API tab's Gemini view (estimated
 * spend per UTC day): two series over the window.
 *
 * Lifted from the two plots the API view draws for itself (`DeepseekDayBars`, `JevDayBars`), which stay as they are:
 * bars from a ruled zero baseline, the tallest bar the whole plot and its figure said beside the legend, a zero day a
 * one-pixel stub so a quiet day never reads as a missing one, and each day carrying its whole reading as its title.
 * Those two fade every day but today; here every bar is at full strength (a faded one falls under 3:1 on the light
 * ground) and today is marked by a short rule under its column, never by anything behind its bars.
 *
 * A SECOND SERIES GROWS DOWN FROM THE SAME BASELINE. The first series stands above the rule and the second hangs below
 * it, both on one scale. Side by side, two bars a day are under 2 px each at 90 days on a phone; mirrored, a day is one
 * column at any width, and which series a bar belongs to is its SIDE of the rule as well as its ink (the legend marks
 * them ▲ and ▼), so the two survive greyscale. What is above the rule against what is below it is the plot's answer.
 *
 * THE LEGEND SAYS EACH SERIES' TOTAL, so the picture's two sums are read as numbers and never estimated from bars. A
 * measure the locale's grouping does not say (money) gives each total in its own words, through the series' `total`.
 *
 * A TITLE IS A POINTER'S. The plot is one image with one spoken sentence; a caller that owes each day's figures to a
 * finger or a screen reader draws them in a table beside it, as the dashboard does.
 *
 * Paint: `verve/readings.css`.
 */
export function DayBars({ days, series, label, peakLabel }: DayBarsProps) {
  const mirrored = series.length === 2;
  const sidePx = mirrored ? TWO_SERIES_PX : ONE_SERIES_PX;
  const peak = Math.max(0, ...days.flatMap((day) => day.values));
  const totals = series.map((_, index) => days.reduce((sum, day) => sum + (day.values[index] ?? 0), 0));
  const last = days.length - 1;
  const middle = Math.floor(last / 2);

  return (
    <div className="vv-daybars flex min-w-0 flex-col" data-dense={days.length >= DENSE_FROM || undefined}>
      <div className="vv-daybars__legend flex min-w-0 flex-wrap items-baseline justify-between">
        <span className="vv-daybars__names flex min-w-0 flex-wrap items-baseline">
          {series.map((entry, index) => (
            <span key={entry.label} className="vv-daybars__series inline-flex items-baseline" data-tone={entry.tone}>
              {/* The side of the rule the series is drawn on, as a mark: its second channel beside its ink. */}
              <span className="vv-daybars__mark" aria-hidden="true">{mirrored ? (index === 0 ? '▲' : '▼') : '■'}</span>
              {entry.label}
              <span className="vv-daybars__total">{entry.total ?? totals[index].toLocaleString()}</span>
            </span>
          ))}
        </span>
        <span className="vv-daybars__peak">{peakLabel(peak)}</span>
      </div>

      <div className="vv-daybars__plot flex min-w-0" role="img" aria-label={label}>
        {days.map((day, at) => (
          <span key={day.day} className="vv-daybars__day flex min-w-0 flex-1 flex-col" title={day.title} data-today={at === last || undefined}>
            {series.map((entry, index) => {
              const value = day.values[index] ?? 0;
              const height = peak > 0 && value > 0 ? Math.max(1, Math.round((value / peak) * sidePx)) : 1;
              return (
                <span key={entry.label} className="vv-daybars__side flex" data-side={index === 0 ? 'up' : 'down'} style={{ height: sidePx }}>
                  <span className="vv-daybars__bar w-full" data-tone={entry.tone} style={{ height }} />
                </span>
              );
            })}
          </span>
        ))}
        {/* The zero both series grow from, ruled across the whole plot and over the gaps between its columns. */}
        <span className="vv-daybars__zero" style={{ top: sidePx }} aria-hidden="true" />
      </div>

      {days.length > 0 && (
        <div className="vv-daybars__axis flex justify-between" aria-hidden="true">
          <span>{dateLabel(days[0].day)}</span>
          {days.length >= MIDDLE_DATE_FROM && <span>{dateLabel(days[middle].day)}</span>}
          <span>{dateLabel(days[last].day)}</span>
        </div>
      )}
    </div>
  );
}
