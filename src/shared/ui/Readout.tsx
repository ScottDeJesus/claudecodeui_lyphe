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
  /** `lg` is the panel's one large number; `md`, the default, is every number that stands beside it. */
  size?: 'md' | 'lg';
  /** What an unknown reading is called aloud ("not known"). The em-dash is a drawing and has no spoken name of its own. */
  unknownLabel: string;
};

/**
 * Used by the kanban module's bug dashboard for its numbers: the open count, the count at each priority, the oldest
 * open high card's age and the time a fix takes.
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
 * Paint: `verve/readings.css`.
 */
export function Readout({ label, value, unit, tone, note, size = 'md', unknownLabel }: ReadoutProps) {
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
      {note !== undefined && <span className="vv-readout__note">{note}</span>}
    </div>
  );
}
