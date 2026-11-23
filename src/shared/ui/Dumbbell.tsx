import type { CSSProperties } from 'react';

import type { CompanionMaterial, Tone } from '@/shared/types';
import { fitScale, zeroScale } from '@/shared/ui/chartScale';

type DumbbellRow = {
  /** The row's key among its siblings. */
  key: string;
  /** Its name at the start of the row ("Build", "opus"). */
  label: string;
  /** Drawn in the mono face: a name the house prints as it is, such as a model's id. */
  mono?: boolean;
  /** The model whose colour the row wears (the chats' coding), with a dot of it before the name; left off, the ink. */
  material?: CompanionMaterial;
  /** The row the rest of the page is showing: its name in the strong weight. */
  strong?: boolean;
  /** The full mark's value on the scale, and its companion's (the hollow one); null where the row has no such figure. */
  value: number | null;
  against: number | null;
  /** The full mark's value in words, drawn over it. */
  figure: string;
  /** The companion's value in words: said aloud and on the row's title, never drawn. */
  againstFigure?: string;
  /** How the two differ, at the row's end: in the positive ink with its ✓ the better way, the warn ink with its ▲ the worse. */
  change?: { words: string; tone?: Tone };
};

type DumbbellProps = {
  /** The rows, in the order they are drawn. */
  rows: DumbbellRow[];
  /** The scale's words for a step ("10", "40k", "5m", "80%"). */
  tickWords: (value: number) => string;
  /** `zero` (the default) starts the scale at nothing; `fit` starts it a round step under the lowest mark: a dot is a position, not a length. */
  from?: 'zero' | 'fit';
  /** The scale's top when the measure has one of its own (a share's 1). */
  ceiling?: number;
  /** The two marks' names for the legend and the rows' spoken words: the full one, then the hollow one. */
  legend: [string, string];
  /** The chart's one spoken name. */
  label: string;
};

/** A figure over its dot is centred on it, unless that would put it past an end of the track. */
function anchorOf(at: number): 'start' | 'middle' | 'end' {
  if (at < 8) return 'start';
  if (at > 92) return 'end';
  return 'middle';
}

/**
 * Used by the analytics module's Code Mode comparison: by kind, the median launch with Code Mode against without; by model,
 * the share that ended ok each way.
 *
 * ONE ROW A THING, TWO MARKS ON ONE SCALE: the full dot is the figure that matters (with Code Mode), the hollow ring its
 * companion (without), and the bar between them is how far apart they are, so the eye reads the change as a length and
 * its direction as a side. The rows share the scale, ruled at round steps named under the last row. A row wears its model's
 * chart colour when it has one (the chats' coding: a dot of it before the name too), and the ink when it does not; the
 * row the page is showing has its name in the strong weight.
 *
 * THE FULL FIGURE IS DRAWN, the companion's is said: a row's words for a screen reader carry both, and a pointer's title
 * on the track does. The change stands at the row's end in its tone's ink with the tone's glyph, so it reads in greyscale.
 *
 * A ROW WITH ONE MARK (nothing to compare it with) draws that mark alone.
 *
 * On arrival each full dot travels out from its ring to its place and the bar grows behind it, still under
 * `prefers-reduced-motion`.
 *
 * Paint: `verve/readings.css`.
 */
export function Dumbbell({ rows, tickWords, from = 'zero', ceiling, legend, label }: DumbbellProps) {
  const values = rows.flatMap((row) => [row.value, row.against]).filter((value): value is number => value !== null);
  const scale =
    from === 'fit' && values.length > 0 ? fitScale(Math.min(...values), Math.max(...values), ceiling) : zeroScale(Math.max(0, ...values), ceiling);
  const span = scale.high - scale.low;
  const at = (value: number) => (span > 0 ? Math.min(100, Math.max(0, ((value - scale.low) / span) * 100)) : 0);
  const last = rows.length;

  return (
    <div className="vv-dumbbell flex min-w-0 flex-col" role="group" aria-label={label}>
      <div className="vv-dumbbell__legend flex flex-wrap items-center" aria-hidden="true">
        <span className="vv-dumbbell__key inline-flex items-center">
          <span className="vv-dumbbell__swatch" data-full />
          {legend[0]}
        </span>
        <span className="vv-dumbbell__key inline-flex items-center">
          <span className="vv-dumbbell__swatch" />
          {legend[1]}
        </span>
      </div>

      <div className="vv-dumbbell__grid grid" style={{ gridTemplateRows: `repeat(${last}, var(--vv-dumbbell-row)) auto` }}>
        <div className="vv-dumbbell__scale" style={{ gridColumn: 2, gridRow: `1 / ${last + 1}` }} aria-hidden="true">
          {scale.ticks.map((tick) => (
            <span key={tick} className="vv-dumbbell__rule" style={{ left: `${at(tick)}%` }} />
          ))}
        </div>

        {rows.map((row, index) => {
          const gridRow = index + 1;
          const both = row.value !== null && row.against !== null;
          const valueAt = row.value === null ? null : at(row.value);
          const againstAt = row.against === null ? null : at(row.against);
          const spoken = [
            row.value === null ? null : `${row.figure} ${legend[0]}`,
            row.against === null || row.againstFigure === undefined ? null : `${row.againstFigure} ${legend[1]}`,
          ]
            .filter((part) => part !== null)
            .join(', ');
          return (
            <div key={row.key} className="contents">
              <span className="vv-dumbbell__name flex min-w-0 items-center" data-strong={row.strong || undefined} data-mono={row.mono || undefined} style={{ gridColumn: 1, gridRow }}>
                {row.material !== undefined && <span className="vv-dumbbell__dot-key" data-material={row.material} aria-hidden="true" />}
                <span className="vv-dumbbell__label">{row.label}</span>
              </span>
              <span
                className="vv-dumbbell__track"
                data-material={row.material}
                title={spoken}
                style={{ gridColumn: 2, gridRow, '--vv-dumbbell-from': `${againstAt ?? valueAt ?? 0}%` } as CSSProperties}
              >
                {both && valueAt !== null && againstAt !== null && (
                  <span
                    className="vv-dumbbell__bar"
                    data-grows={valueAt >= againstAt ? 'right' : 'left'}
                    style={{ left: `${Math.min(valueAt, againstAt)}%`, width: `${Math.abs(valueAt - againstAt)}%` }}
                    aria-hidden="true"
                  />
                )}
                {againstAt !== null && <span className="vv-dumbbell__ring" style={{ left: `${againstAt}%` }} aria-hidden="true" />}
                {valueAt !== null && (
                  <>
                    <span className="vv-dumbbell__dot" style={{ left: `${valueAt}%` }} aria-hidden="true" />
                    <span className="vv-dumbbell__figure" data-anchor={anchorOf(valueAt)} style={{ left: `${valueAt}%` }} aria-hidden="true">
                      {row.figure}
                    </span>
                  </>
                )}
                <span className="sr-only">{spoken}</span>
              </span>
              <span
                className="vv-dumbbell__change"
                data-tone={row.change?.tone !== undefined && row.change.tone !== 'neutral' ? row.change.tone : undefined}
                style={{ gridColumn: 3, gridRow }}
              >
                {row.change?.words}
              </span>
            </div>
          );
        })}

        <div className="vv-dumbbell__ticks" style={{ gridColumn: 2, gridRow: last + 1 }} aria-hidden="true">
          {scale.ticks.map((tick) => (
            <span key={tick} className="vv-dumbbell__tick" data-anchor={anchorOf(at(tick))} style={{ left: `${at(tick)}%` }}>
              {tickWords(tick)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
