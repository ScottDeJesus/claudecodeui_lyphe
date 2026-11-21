import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { AstrolabePoint, AstrolabeTrackStep } from '@/shared/types';
import { cn } from '@/shared/utils';

type TrackProps = {
  /** The steps, in their order. */
  steps: AstrolabeTrackStep[];
  /** What the course is, for assistive tech: "Course". */
  label: string;
  /** How a step is said to assistive tech: its number, its name and its state, in words. */
  stepLabel: (step: AstrolabeTrackStep, index: number, count: number) => string;
  /** The step kept named on the plate when nothing is pointed at; absent, none. */
  value?: string;
  /** A step pressed, with the point it stands at on the page: it opens, or acts. */
  onOpen?: (step: AstrolabeTrackStep, point: AstrolabePoint) => void;
  className?: string;
};

/**
 * THE DESIGN SYSTEM'S TRACK: one thing's course as a line you read along, its steps, how far it has got and what it is doing, in
 * one object. It is lit to where it has got in the quiet ink (finished work is settled, not loud); the step being worked crawls
 * accent dashes behind a bead; a failed step stops in the danger dot; a step waiting on you holds an open accent ring. No words
 * until you point: each step names itself on a plate with its number, and a press on one opens it (`onOpen`).
 *
 * Used by the kanban module's bug Opening, for a bug's course through the board's lanes, whose steps move it.
 */
export function Track({ steps, label, stepLabel, value, onOpen, className }: TrackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The step under the pointer or the focus, named on the plate; -1 for none.
  const [pointed, setPointed] = useState(-1);
  const n = Math.max(1, steps.length);
  const first = steps.findIndex((step) => step.state !== 'done');
  const doneCount = first < 0 ? n : first;
  const liveState = first < 0 ? null : steps[first].state;
  const kept = value === undefined ? -1 : steps.findIndex((step) => step.id === value);
  const shown = pointed >= 0 ? pointed : kept;
  const at = (index: number) => `${(100 * index) / n}%`;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`${label}: ${doneCount} / ${n}`}
      data-state={liveState ?? 'done'}
      className={cn('ast-track', className)}
      style={{ '--ast-track-n': n } as CSSProperties}
      onPointerLeave={() => setPointed(-1)}
    >
      <span className="ast-track-line" aria-hidden="true">
        <span className="ast-track-lit" style={{ width: at(doneCount) }} />
        {liveState === 'live' && <span className="ast-track-crawl" style={{ left: at(doneCount), width: `${100 / n}%` }} />}
        {liveState === 'failed' && <span className="ast-track-fail" style={{ left: at(doneCount), width: `${100 / n}%` }} />}
      </span>
      {first >= 0 && liveState !== 'next' && <span className="ast-track-head" aria-hidden="true" data-state={liveState ?? undefined} style={{ left: at(doneCount) }} />}
      {steps.map((step, index) => (
        <button
          key={step.id}
          type="button"
          className="ast-track-step"
          data-state={step.state}
          data-step={step.id}
          data-on={index === shown ? 'true' : 'false'}
          style={{ left: at(index), width: `${100 / n}%` }}
          aria-label={stepLabel(step, index, n)}
          onPointerEnter={() => setPointed(index)}
          onFocus={() => setPointed(index)}
          onBlur={() => setPointed(-1)}
          onClick={() => {
            const box = rootRef.current?.getBoundingClientRect();
            if (!box || !onOpen) return;
            onOpen(step, { x: box.left + box.width * ((index + 0.5) / n), y: box.top + box.height / 2 });
          }}
        />
      ))}
      {shown >= 0 && steps[shown] && (
        <span
          className="ast-track-plate"
          aria-hidden="true"
          data-edge={shown < n * 0.2 ? 'start' : shown > n * 0.8 ? 'end' : 'mid'}
          style={{ left: `${(100 * (shown + 0.5)) / n}%` }}
        >
          <span className="ast-track-num">{String(shown + 1).padStart(2, '0')}</span> {steps[shown].label}
        </span>
      )}
    </div>
  );
}
