import type { ReactNode } from 'react';

import type { Tone } from '@/shared/types';

type ReadoutProps = {
  /** What the figure counts, in the reader's own words ("Open", "Oldest high"). Drawn small above the figure. */
  label: string;
  /** The reading. A number is drawn with the locale's grouping; a string is drawn as written ("4.5"). `null`, or none given, is NO reading. */
  value?: number | string | null;
  /** The figure's unit, small beside it ("days", "h"). Not drawn beside an unknown reading. */
  unit?: string;
  /**
   * How the reading stands. A tone other than `neutral` colours the figure and puts the tone's own glyph before it, so
   * the state survives greyscale. Left off, the figure is plain ink: most figures are, which is what lets one stand out.
   */
  tone?: Tone;
  /** One line under the figure saying what it is measured against ("of 23 open", "9 in 10 within 31 h"). */
  note?: ReactNode;
  /**
   * How the figure moved against what it is compared to ("36% fewer"), said first on the note's line in its tone's ink with
   * the tone's glyph: `positive` the better way, `warn` the worse. Left off, the note's line is the note alone.
   */
  change?: { words: string; tone?: Tone };
  /**
   * The figure's days, drawn small under the note: the first series in the full ink, a second in the pale ink, dashed. A
   * day with no reading is null and breaks its line. It is paint: the figure and its note are what is said.
   */
  trend?: (number | null)[][];
  /** `lg` is the panel's one large number; `md`, the default, is every number that stands beside it. */
  size?: 'md' | 'lg';
  /** What an unknown reading is called aloud ("not known"). The em-dash is a drawing and has no spoken name of its own. */
  unknownLabel: string;
};

/**
 * Used by the kanban module's bug dashboard for its numbers: the open count, the count at each priority, the oldest
 * open high card's age and the time a fix takes; by the analytics module's Code Mode glance for the median launch's
 * launches, turns, tokens and time against the same without Code Mode, and its scripts.
 *
 * ONE FIGURE AND ITS NAME, built to Astrolabe's Readout and ReadoutRow: the label is the telemetry caption (mono,
 * upper-case, tracked, in the faint ink), the figure is mono and tabular in the strongest ink, its unit small beside it
 * on the same baseline, and one line under it for what the number is compared to. `lg` is Astrolabe's Readout, the one
 * large number of a panel; `md` is the weight of a ReadoutRow's values, for the numbers that stand beside it.
 *
 * UNKNOWN IS NEVER ZERO. A reading nobody has is an em-dash in the faint ink, with no unit and no tone, and it is
 * spoken as `unknownLabel`. A `0` is a reading, and is drawn as one. The dash is faint ink rather than Astrolabe's
 * `opacity-dim`, which would take it under 4.5:1 on the app's light ground.
 *
 * TONE IS NEVER COLOUR ALONE: a toned figure wears the tone's glyph (the `[data-tone]` swap's own, tokens.css), and
 * `neutral` draws exactly what no tone does.
 *
 * A CHANGE AND A TREND, when a caller has them (the analytics module's Code Mode glance): the change leads the note's line
 * in its tone's ink and glyph, and the trend is the figure's days as a line under it, the full ink over the pale.
 *
 * Paint: `verve/readings.css`.
 */
export function Readout({ label, value, unit, tone, note, change, trend, size = 'md', unknownLabel }: ReadoutProps) {
  const unknown = value === null || value === undefined;
  const toned = !unknown && tone !== undefined && tone !== 'neutral';

  return (
    <div
      className="vv-readout flex min-w-0 flex-col"
      data-size={size}
      data-tone={toned ? tone : undefined}
      data-unknown={unknown || undefined}
    >
      <span className="vv-readout__label">{label}</span>
      <span className="vv-readout__main inline-flex min-w-0 items-baseline">
        {unknown ? (
          <>
            <span className="vv-readout__value" aria-hidden="true">—</span>
            <span className="sr-only">{unknownLabel}</span>
          </>
        ) : (
          <>
            <span className="vv-readout__value">{typeof value === 'number' ? value.toLocaleString() : value}</span>
            {unit !== undefined && <span className="vv-readout__unit">{unit}</span>}
          </>
        )}
      </span>
      {(note !== undefined || change !== undefined) && (
        <span className="vv-readout__note">
          {change !== undefined && (
            <span className="vv-readout__change" data-tone={change.tone !== undefined && change.tone !== 'neutral' ? change.tone : undefined} data-then={note !== undefined || undefined}>
              {change.words}
            </span>
          )}
          {note}
        </span>
      )}
      {trend !== undefined && trend.length > 0 && <ReadoutTrend series={trend} />}
    </div>
  );
}

/** The trend's height; its width is the readout's. */
const TREND_PX = 30;

/** A readout's days as lines, the first series full and the second pale: drawn by Readout above, and by nothing else. */
function ReadoutTrend({ series }: { series: (number | null)[][] }) {
  const values = series.flat().filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(1, ...series.map((one) => one.length - 1));
  // A flat window is drawn across the middle, not along the floor.
  const yOf = (value: number) => (high === low ? TREND_PX / 2 : TREND_PX - 3 - ((value - low) / (high - low)) * (TREND_PX - 6));
  const pathOf = (one: (number | null)[]) => {
    let path = '';
    let drawing = false;
    one.forEach((value, at) => {
      if (value === null) {
        drawing = false;
        return;
      }
      path += `${drawing ? 'L' : 'M'}${at} ${yOf(value).toFixed(2)} `;
      drawing = true;
    });
    return path.trim();
  };
  return (
    <svg className="vv-readout__trend" viewBox={`0 0 ${span} ${TREND_PX}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {series
        .map((one, index) => ({ one, index }))
        .reverse()
        .map(({ one, index }) => (
          <path key={index} className="vv-readout__trend-line" data-mark={index === 0 ? 'ink' : 'pale'} d={pathOf(one)} vectorEffect="non-scaling-stroke" />
        ))}
    </svg>
  );
}
