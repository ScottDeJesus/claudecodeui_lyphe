import type { CSSProperties, ReactNode } from 'react';

import type { InstrumentMeasure } from '@/shared/types';
import { cn } from '@/shared/utils';

type InstrumentCoreProps = {
  /** The body's side, in px: the drawing in `children` fills it. */
  size: number;
  /** The body's name for assistive tech, and its press: what the instrument is ("The board", "The fleet"). */
  label: string;
  onPress?: () => void;
  /** The one measure worn round the body, or null for none. */
  measure?: InstrumentMeasure | null;
  /** A press on the measure: the instrument's numbers or its history. */
  onMeasure?: () => void;
  /** A picture only: no press of its own and nothing for assistive tech (the caller's own press round it says what it is). */
  decorative?: boolean;
  /** Marks for the body's press, for the check scripts and the Openings that hang from it. */
  marks?: Record<`data-${string}`, string>;
  /** The body as drawn: the core instrument at `size`, or its still stand-in. */
  children: ReactNode;
};

/** The air between the body and its measure, and the measure's width, in px. */
const GAP = 7;
const STROKE = 2.5;
/** How far past the measure's line a press still takes hold of it, in px, outward: about the width of a fingertip's edge. */
const CATCH = 9;

/**
 * THE CORE IN AN INSTRUMENT'S MIDDLE: the body, which is its press (`onPress`), and round it one measure as a flat ring filled clockwise
 * from twelve with a bead at its head, its own press (`onMeasure`). The measure is grey while its reading is ordinary, yellow past
 * `warn` and red from `danger`, and is named on a plate while it is pointed at or focused ("Fixed · 12 of 30"). The two presses lie one
 * inside the other, as a chat's core and its rings do: the body, then the ring's band.
 *
 * Used by the kanban module's `BugInstrument` (the board's core and how much of it is fixed) and the cerberus module's
 * `CerberusInstrument` (Cerberus's core and the share of the fleet's checks passing), each standing it in its hoop's middle.
 */
export function InstrumentCore({ size, label, onPress, measure = null, onMeasure, decorative = false, marks, children }: InstrumentCoreProps) {
  const ring = size / 2 + GAP + STROKE / 2;
  const outer = Math.ceil(ring + STROKE / 2 + CATCH);
  const side = outer * 2;
  const value = measure === null ? 0 : Math.min(1, Math.max(0, measure.value));
  const level = measure === null ? 'quiet' : value >= (measure.danger ?? 1) ? 'danger' : value >= (measure.warn ?? 0.8) ? 'warn' : 'quiet';
  const length = 2 * Math.PI * ring;
  const words = measure === null ? '' : [measure.label, measure.detail].filter(Boolean).join(' · ');
  const body: CSSProperties = { width: size, height: size };

  return (
    <div className="ast-instrument-core" style={{ width: side, height: side }} data-level={level}>
      {measure !== null && (
        <svg className="ast-instrument-core__ring" width={side} height={side} viewBox={`0 0 ${side} ${side}`} aria-hidden="true">
          <circle className="ast-instrument-core__track" cx={outer} cy={outer} r={ring} />
          {/* Filled from twelve: the stroke starts at three o'clock, so the circle is turned back a quarter. */}
          <circle
            className="ast-instrument-core__lit"
            cx={outer}
            cy={outer}
            r={ring}
            transform={`rotate(-90 ${outer} ${outer})`}
            style={{ strokeDasharray: `${value * length} ${length}` }}
          />
          {value > 0 && (
            <g className="ast-instrument-core__head" style={{ transform: `rotate(${value * 360}deg)`, transformOrigin: `${outer}px ${outer}px` }}>
              <circle cx={outer} cy={outer - ring} r={STROKE * 1.2} />
            </g>
          )}
        </svg>
      )}
      {measure !== null && !decorative && (
        <button
          type="button"
          className="ast-instrument-core__measure"
          aria-label={words}
          title={words}
          onClick={() => onMeasure?.()}
        >
          <span className="ast-instrument-core__plate" aria-hidden="true" style={{ bottom: `calc(100% - ${CATCH - 2}px)` }}>{words}</span>
        </button>
      )}
      {decorative ? (
        <span className="ast-instrument-core__body" style={body} aria-hidden="true">{children}</span>
      ) : (
        <button
          type="button"
          {...marks}
          className={cn('ast-instrument-core__body', onPress === undefined && 'pointer-events-none')}
          style={body}
          aria-label={label}
          title={label}
          onClick={() => onPress?.()}
        >
          {children}
        </button>
      )}
    </div>
  );
}
