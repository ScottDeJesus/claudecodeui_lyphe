import { useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';

import { zeroScale } from '@/shared/ui/chartScale';

type DayChartSeries = {
  /** The series' name in the legend and on the pointed day's card ("With Code Mode"). */
  label: string;
  /** The series' figure over the whole window, in the caller's words, after its name in the legend ("174"). */
  total?: string;
  /** Its mark: `ink` the full one, `pale` its companion (a lighter column, a dashed line), `warn` a count of things gone wrong. */
  mark: 'ink' | 'pale' | 'warn';
};

type DayChartDay = {
  /** `YYYY-MM-DD`, oldest first. The last day is today's. */
  day: string;
  /** One value per series, in the scale's unit. Null is no reading that day: a line breaks there and a column is empty. */
  values: (number | null)[];
  /** The same values in the caller's words, one per series ("7", "48k", "4m 20s"); null is drawn as the em-dash. */
  figures: (string | null)[];
  /** One more line for the pointed day, under its figures ("58% of the day's 12 launches"). */
  note?: string;
};

type DayChartProps = {
  /** `columns` stacks the series from the baseline, the first one on it; `lines` draws each series as a line of its own. */
  form: 'columns' | 'lines';
  /** One series, or two. */
  series: DayChartSeries[];
  /** The days of the window, oldest first. */
  days: DayChartDay[];
  /** The plot's one spoken sentence ("Launches each day, with and without Code Mode, the last 30 days"). */
  label: string;
  /** A tick's words on the scale ("10", "40k", "5m", "75%"). */
  tickWords: (value: number) => string;
  /** The scale's top when the measure has one of its own (a rate's 1). Left off, the scale rounds up from the tallest value. */
  ceiling?: number;
  /** What the last day is called under its column and on its card ("Today"). */
  todayLabel: string;
};

/** The plot's height. Every column and every point is its share of it. */
const PLOT_PX = 184;
/** The page's own ground left between two parts of a column, so two inks never touch. */
const PART_GAP_PX = 2;
/** From this many days on, the columns stand a hairline apart, so 90 days still fit a phone. */
const DENSE_FROM = 45;
/** The fewest days that get a third date under the plot, at its middle. */
const MIDDLE_DATE_FROM = 14;

/** `2026-09-19` → `Sep 19`, built from the parts so the box's own zone never shifts the day. */
function dateLabel(day: string, weekday = false): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], weekday ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}

/**
 * Used by the analytics module's Code Mode section: its days (launches stacked with and without Code Mode, or each day's
 * median as two lines) and its failures each day.
 *
 * ONE MEASURE OVER NAMED DAYS, ON A SCALE YOU CAN READ: a ruled zero, round steps up the side with their words, and the
 * days' dates under the plot, the last one today's. `columns` stacks the series from the baseline, the first one on it,
 * with the page's ground between two parts; `lines` draws each series as a line of its own, broken where a day has no
 * reading. The full series wears the ink, its companion the pale ink (a dashed line, so the two survive greyscale), and a
 * count of things gone wrong the warn gold.
 *
 * THE LEGEND SAYS EACH SERIES' TOTAL, so the window's sums are read as numbers and never estimated from marks.
 *
 * A POINTED DAY SAYS ITSELF. A pointer over the plot draws a hairline down the day it is over and a card beside it with
 * the day's figures; a finger's tap does the same in a line over the plot, which holds today's figures until a day is
 * tapped. Both are paint for the eye: the plot is one image with one spoken sentence, and a caller that owes each day's
 * figures to a screen reader draws them in a table beside it (DayBars's rule).
 *
 * IT ARRIVES MOVING: columns rise from the zero one after another and lines draw from the left, still under
 * `prefers-reduced-motion`. A caller that wants the entrance again when its measure changes keys the chart by it.
 *
 * Paint: `verve/readings.css`.
 */
export function DayChart({ form, series, days, label, tickWords, ceiling, todayLabel }: DayChartProps) {
  // The day a pointer is over, or a finger last tapped; null while none is. Only the hairline, the card and the line read it.
  const [pointed, setPointed] = useState<number | null>(null);

  const count = days.length;
  const last = count - 1;
  const peak =
    form === 'columns'
      ? Math.max(0, ...days.map((day) => day.values.reduce<number>((sum, value) => sum + (value ?? 0), 0)))
      : Math.max(0, ...days.flatMap((day) => day.values.map((value) => value ?? 0)));
  const { high: top, ticks } = zeroScale(peak, ceiling);
  const heightOf = (value: number) => (top > 0 ? (Math.max(0, value) / top) * PLOT_PX : 0);
  const leftOf = (at: number) => `${((at + 0.5) / Math.max(1, count)) * 100}%`;

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || count === 0) return;
    const at = Math.floor(((event.clientX - box.left) / box.width) * count);
    setPointed(Math.min(last, Math.max(0, at)));
  };

  const shown = pointed ?? last;
  const shownDay = count > 0 ? days[shown] : null;
  const dayName = (at: number) => (at === last ? todayLabel : dateLabel(days[at].day, true));

  /** A line's path in the plot's own units (a day is one wide), broken at a day with no reading. */
  const pathOf = (index: number) => {
    let path = '';
    let drawing = false;
    days.forEach((day, at) => {
      const value = day.values[index];
      if (value === null || value === undefined) {
        drawing = false;
        return;
      }
      path += `${drawing ? 'L' : 'M'}${(at + 0.5).toFixed(2)} ${(PLOT_PX - heightOf(value)).toFixed(2)} `;
      drawing = true;
    });
    return path.trim();
  };
  /** A reading with no neighbour on either side draws no line, so it is drawn as a dot. */
  const alone = (index: number, at: number) =>
    days[at].values[index] != null && days[at - 1]?.values[index] == null && days[at + 1]?.values[index] == null;

  return (
    <div className="vv-daychart flex min-w-0 flex-col" data-form={form} data-dense={count >= DENSE_FROM || undefined}>
      <div className="vv-daychart__legend flex min-w-0 flex-wrap items-baseline">
        {series.map((entry) => (
          <span key={entry.label} className="vv-daychart__series inline-flex items-baseline">
            <span className="vv-daychart__key" data-mark={entry.mark} aria-hidden="true" />
            {entry.label}
            {entry.total !== undefined && <span className="vv-daychart__total">{entry.total}</span>}
          </span>
        ))}
      </div>

      {shownDay !== null && (
        // A finger's reading of the plot: today's until a day is tapped. A pointer that hovers has its card instead.
        <p className="vv-daychart__readline" aria-hidden="true">
          <span className="vv-daychart__when">{dayName(shown)}</span>
          {series.map((entry, index) => (
            <span key={entry.label} className="vv-daychart__read inline-flex items-baseline">
              <span className="vv-daychart__key" data-mark={entry.mark} />
              {shownDay.figures[index] ?? '—'}
            </span>
          ))}
          {shownDay.note !== undefined && <span className="vv-daychart__read">{shownDay.note}</span>}
        </p>
      )}

      <div className="vv-daychart__frame flex min-w-0">
        <div className="vv-daychart__scale" style={{ height: PLOT_PX }} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="vv-daychart__tick" style={{ bottom: heightOf(tick) }}>
              {tickWords(tick)}
            </span>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="vv-daychart__plot"
            style={{ height: PLOT_PX }}
            role="img"
            aria-label={label}
            onPointerMove={(event) => event.pointerType === 'mouse' && pick(event)}
            onPointerDown={pick}
            onPointerLeave={(event) => event.pointerType === 'mouse' && setPointed(null)}
          >
            {ticks.map((tick) => (
              <span key={tick} className="vv-daychart__rule" data-zero={tick === 0 || undefined} style={{ bottom: heightOf(tick) }} aria-hidden="true" />
            ))}

            <div className="vv-daychart__days flex" aria-hidden="true">
              {days.map((day, at) => (
                <span
                  key={day.day}
                  className="vv-daychart__day flex min-w-0 flex-1 flex-col justify-end"
                  data-today={at === last || undefined}
                  data-pointed={pointed === at || undefined}
                  style={{ '--vv-daychart-at': at } as CSSProperties}
                >
                  {form === 'columns' && (
                    <span className="vv-daychart__stack flex flex-col-reverse">
                      {series.map((entry, index) => {
                        const value = day.values[index] ?? 0;
                        if (value <= 0) return null;
                        // The page's ground between two parts comes out of the upper one, so the stack's top stays on the scale.
                        const below = day.values.slice(0, index).some((other) => (other ?? 0) > 0);
                        const height = Math.max(1, heightOf(value) - (below ? PART_GAP_PX : 0));
                        return <span key={entry.label} className="vv-daychart__part" data-mark={entry.mark} style={{ height }} />;
                      })}
                    </span>
                  )}
                </span>
              ))}
            </div>

            {form === 'lines' && (
              <svg className="vv-daychart__lines" viewBox={`0 0 ${Math.max(1, count)} ${PLOT_PX}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                {series.map((entry, index) => (
                  <path key={entry.label} className="vv-daychart__line" data-mark={entry.mark} d={pathOf(index)} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
            )}
            {form === 'lines' &&
              series.flatMap((entry, index) =>
                days.map((day, at) =>
                  alone(index, at) || pointed === at ? (
                    <span
                      key={entry.label + day.day}
                      className="vv-daychart__dot"
                      data-mark={entry.mark}
                      style={{ left: leftOf(at), bottom: heightOf(day.values[index] ?? 0) }}
                      aria-hidden="true"
                    />
                  ) : null,
                ),
              )}

            {pointed !== null && shownDay !== null && (
              <>
                <span className="vv-daychart__hair" style={{ left: leftOf(pointed) }} aria-hidden="true" />
                <div className="vv-daychart__card" data-side={pointed > last / 2 ? 'before' : 'after'} style={{ left: leftOf(pointed) }} aria-hidden="true">
                  <span className="vv-daychart__when">{dayName(pointed)}</span>
                  {series.map((entry, index) => (
                    <span key={entry.label} className="vv-daychart__row flex items-center">
                      <span className="vv-daychart__key" data-mark={entry.mark} />
                      <span className="min-w-0 flex-1">{entry.label}</span>
                      <span className="vv-daychart__figure">{shownDay.figures[index] ?? '—'}</span>
                    </span>
                  ))}
                  {shownDay.note !== undefined && <span className="vv-daychart__note">{shownDay.note}</span>}
                </div>
              </>
            )}
          </div>

          {count > 0 && (
            <div className="vv-daychart__axis flex justify-between" aria-hidden="true">
              <span>{dateLabel(days[0].day)}</span>
              {count >= MIDDLE_DATE_FROM && <span>{dateLabel(days[Math.floor(last / 2)].day)}</span>}
              <span>{count > 1 ? todayLabel : null}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
