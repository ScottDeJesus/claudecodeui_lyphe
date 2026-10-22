import { useEffect, useRef, useState } from 'react';

import { otherOverlayHoldsEscape } from '@/shared/ui/overlayEscape';
import { usePointerDrag } from '@/shared/ui/usePointerDrag';
import type { PointerDragPoint } from '@/shared/ui/usePointerDrag';

/** A box in 0..1 of the image: `[x0, y0, x1, y1]`, x0 < x1 and y0 < y1. */
export type DrawnBox = [number, number, number, number];

type RegionDrawLayerProps = {
  onDrawn: (box: DrawnBox) => void;
  onCancel: () => void;
};

/** The point a client position falls on, in 0..1 of the layer and held inside it; null for a layer with no size. */
function toUnitPoint(layer: HTMLElement, clientX: number, clientY: number): [number, number] | null {
  const rect = layer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [clamp((clientX - rect.left) / rect.width), clamp((clientY - rect.top) / rect.height)];
}

/**
 * The box between where a drag was pressed and where it is, in 0..1 of the layer. The press is
 * `point - delta`, which is how `usePointerDrag` reports it, so no anchor has to be remembered between moves.
 */
function boxOfDrag(layer: HTMLElement, point: PointerDragPoint): DrawnBox | null {
  const from = toUnitPoint(layer, point.x - point.dx, point.y - point.dy);
  const to = toUnitPoint(layer, point.x, point.y);
  if (from === null || to === null) return null;
  return [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(from[0], to[0]), Math.max(from[1], to[1])];
}

/**
 * Used by `RegionImage` (so by the affected-areas module's Missed one) to let the operator drag a box on the
 * photo. Not exported by the barrel: nothing draws a box except over a `RegionImage`.
 *
 * The layer covers the image above its outlines and badges, so a press on one of them draws instead of
 * selecting. The drag is the kit's `usePointerDrag` (kind `draw`), which is what keeps a drag alive over
 * whatever is under the pointer and sets `vv-dragging` for its length; the layer is `touch-action: none` from
 * the first touch (`.vv-region-draw`), so one finger draws the box where it would otherwise scroll the page — a
 * box is one gesture on a phone, where a polygon would be many taps. The box shows live as a rect in the
 * image's own 0..1 space, and is reported once, on release, as `onDrawn([x0, y0, x1, y1])`.
 *
 * Escape calls `onCancel`, unless a dialog or a menu in front holds the key (`otherOverlayHoldsEscape`), and it ENDS
 * the drag in progress: the box vanishes at once and the release that follows reports nothing, whether or not the
 * caller then leaves drawing mode — a caller that only clears a box and keeps drawing must not also be handed it.
 * A drag the browser takes away (`pointercancel`), a press that never moved and a drag with no width or no height
 * report nothing; every other box is reported, however small or thin, because the floor on a box's area is the
 * caller's (the engine's, mirrored as `MIN_REGION_AREA`).
 */
export function RegionDrawLayer({ onDrawn, onCancel }: RegionDrawLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  // The box under the pointer while it is dragged, redrawn on every move. It is state because the rect on screen
  // IS this value; it is null at rest and cleared on every release, so no box outlives its gesture.
  const [liveBox, setLiveBox] = useState<DrawnBox | null>(null);
  // Whether a drag is in progress, and whether Escape has called it off. Refs, not state: nothing is drawn from
  // them, they are read by the pointer's and the key's handlers, which must see the drag as it is NOW. Escape
  // flips `calledOff` only while a drag runs, so an Escape at rest never swallows the next drag.
  const dragging = useRef(false);
  const calledOff = useRef(false);

  const { onPointerDown } = usePointerDrag({
    kind: 'draw',
    onStart: () => {
      dragging.current = true;
      calledOff.current = false;
    },
    onMove: (point) => {
      if (calledOff.current) return;
      if (layerRef.current) setLiveBox(boxOfDrag(layerRef.current, point));
    },
    onEnd: (point) => {
      const wasCalledOff = calledOff.current;
      dragging.current = false;
      calledOff.current = false;
      setLiveBox(null);
      if (wasCalledOff || point.cancelled || !point.moved || !layerRef.current) return;
      const box = boxOfDrag(layerRef.current, point);
      // A drag along one axis encloses nothing: a zero width or a zero height is no box. Any other box is reported, however
      // thin — a tide line is long and a few pixels tall — and the caller holds the area floor.
      if (box === null || box[2] <= box[0] || box[3] <= box[1]) return;
      onDrawn(box);
    },
  });

  useEffect(() => {
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || otherOverlayHoldsEscape(document)) return;
      event.preventDefault();
      if (dragging.current) {
        calledOff.current = true;
        setLiveBox(null);
      }
      onCancel();
    }
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [onCancel]);

  return (
    <div ref={layerRef} className="vv-region-draw absolute inset-0" data-tone="positive" onPointerDown={onPointerDown}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {liveBox && (
          <rect
            x={liveBox[0]}
            y={liveBox[1]}
            width={liveBox[2] - liveBox[0]}
            height={liveBox[3] - liveBox[1]}
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
            className="vv-region vv-region--drawing"
          />
        )}
      </svg>
    </div>
  );
}
