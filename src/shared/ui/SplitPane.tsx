import { type KeyboardEvent, type PointerEvent, type ReactNode, useId, useRef } from 'react';

import { usePointerDrag } from '@/shared/ui/usePointerDrag';
import { cn } from '@/shared/utils';

export const SPLIT_MIN_RATIO = 0.15;
export const SPLIT_MAX_RATIO = 0.85;

/** What a non-numeric ratio draws as. */
const EVEN_SPLIT = 0.5;

/** How far one arrow key moves the seam. */
const RATIO_STEP = 0.02;

/**
 * The clamp the hub measured (`Math.min(0.85, Math.max(0.15, …))`), applied wherever a ratio is
 * WRITTEN as well as where it is drawn. A clamp that only runs on render would let the seam's own
 * drag drive `aria-valuenow` to 100 and a pane to a width the reader can neither see nor undo.
 */
function clampRatio(next: number): number {
  return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, next));
}

type SplitPaneProps = {
  ratio: number;                        // the LEFT pane's share; clamped to [MIN, MAX] on render
  onRatioChange: (next: number) => void;
  left: ReactNode;
  right: ReactNode | null;              // null -> the left pane fills and no divider renders
  dividerLabel: string;                 // aria-label on the separator
};

/**
 * Two panes side by side with a draggable seam between them, or one pane filling the row.
 *
 * `ratio` is the LEFT pane's share of the row, and it lands as that pane's flex-basis; the right
 * pane takes the rest. Both panes are `min-width: 0`, so a wide child — an iframe, a long line —
 * can never push the seam past where the ratio put it. The ratio is clamped to
 * [SPLIT_MIN_RATIO, SPLIT_MAX_RATIO] on render as well as wherever it is written, so whatever the
 * caller hands in — a stored value included — draws two panes the reader can find and grab.
 *
 * The seam is a window-splitter separator: focusable, announcing its position as a percentage of
 * the row, and moved by the Left and Right arrows in steps of 0.02 as well as by dragging. It is
 * its own narrow gutter, drawn as a 1px line, and it sits BESIDE the panes rather than over them
 * (`surfaces.css`): a grab area laid over a pane would steal the clicks of whatever that app draws
 * flush against its edge.
 *
 * The left pane is the same element whether or not `right` is present, so opening or closing the
 * second pane never remounts what the first one is showing.
 */
export function SplitPane({ ratio, onRatioChange, left, right, dividerLabel }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftPaneId = useId();

  /**
   * The ratio a pointer at `clientX` asks for. Measured against the container's own box, never the event
   * target's: the seam is a narrow gutter BESIDE the two panes, so a ratio taken against the gutter would
   * move the seam by a few percent of itself.
   */
  function ratioAt(clientX: number): number | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return clampRatio((clientX - rect.left) / rect.width);
  }

  const drag = usePointerDrag({
    kind: 'split',
    onMove: ({ x }) => {
      const next = ratioAt(x);
      if (next !== null) onRatioChange(next);
    },
    // The release gets the last word on the ratio: the final move does not always land on the release
    // point, and a seam that stops a few pixels short of where the reader let go reads as a sticky
    // divider. Without it, `onEnd` would be a stub — the one shape this hook refuses.
    onEnd: ({ x }) => {
      const next = ratioAt(x);
      if (next !== null) onRatioChange(next);
    },
  });

  // A ratio that is not a number — a stored record of the wrong shape — would write
  // `flex-basis: NaN%` and an `aria-valuenow` of NaN, so it draws as an even split instead.
  const finite = Number.isFinite(ratio) ? ratio : EVEN_SPLIT;
  const shown = clampRatio(finite);
  // Every value React renders as nothing counts as "no second pane", not only null: `ReactNode`
  // already admits undefined, booleans and '', so the prop type cannot stop a caller's
  // `right={dual && rightPane}` from arriving as `false` — and that must draw one filling pane,
  // never a divider beside an empty one.
  const split = right !== null && right !== undefined && typeof right !== 'boolean' && right !== '';

  function handleDividerPointerDown(event: PointerEvent<HTMLDivElement>) {
    drag.onPointerDown(event);
  }

  function handleDividerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowLeft' ? -RATIO_STEP : event.key === 'ArrowRight' ? RATIO_STEP : 0;
    if (step === 0) return;
    // The arrows would otherwise scroll the pane's own content out from under a reader who is aiming
    // the seam, which is the one thing this key is for.
    event.preventDefault();
    onRatioChange(clampRatio(shown + step));
  }

  return (
    <div ref={containerRef} className="vv-split flex h-full w-full min-w-0">
      <div
        id={leftPaneId}
        className={cn(
          'vv-split__pane relative h-full min-w-0 overflow-hidden',
          split ? 'shrink-0 grow-0' : 'flex-1',
        )}
        style={split ? { flexBasis: `${shown * 100}%` } : undefined}
      >
        {left}
      </div>
      {split && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(shown * 100)}
            aria-valuemin={Math.round(SPLIT_MIN_RATIO * 100)}
            aria-valuemax={Math.round(SPLIT_MAX_RATIO * 100)}
            aria-controls={leftPaneId}
            aria-label={dividerLabel}
            tabIndex={0}
            onPointerDown={handleDividerPointerDown}
            onKeyDown={handleDividerKeyDown}
            className="vv-split__divider shrink-0"
          />
          <div className="vv-split__pane relative h-full min-w-0 flex-1 overflow-hidden">{right}</div>
        </>
      )}
    </div>
  );
}
