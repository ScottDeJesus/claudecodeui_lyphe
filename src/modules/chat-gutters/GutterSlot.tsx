import type { ReactNode } from 'react';

import type { GutterSlotId, GutterWidgetId } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * One corner of a gutter: the widget drawn in it, and the target a widget is dragged onto.
 *
 * A SLOT IS ADDRESSED BY WHAT IT HOLDS, never by what it is. The layout resolves `slot` to a
 * widget and passes the widget down, so this file never reads the placements and a third widget
 * would need nothing here. The same `data-slot` / `data-widget` pair is what a probe reads to tell
 * a swap from a move.
 *
 * ONE OPEN WIDGET FILLS THE COLUMN, TWO SHARE IT. The gutter hands out its HEIGHT the way the grid
 * hands out width: an open widget's slot grows (`flex-1`), so a widget alone on its side takes the
 * whole column beside the transcript instead of stopping at half of it over an unused corner. A
 * collapsed tab keeps its own height, and an OPEN widget beside one takes everything left over.
 * Two open widgets on a side each take half, which is what `flex-1` on both of them means. The one
 * thing an open widget does NOT take is an empty corner's landing pad below it — see next.
 *
 * AN EMPTY SLOT IS A LANDING PAD, one tab tall — the height a widget collapsed there would take —
 * and it keeps that height whether or not anything is in flight. A corner with no pixels of its own
 * is a corner the pointer can never enter, so it could neither open nor accept a drop; the pad is
 * what a drag enters, and it is the price of the corner being reachable at all. What it costs is
 * the band it occupies: a lone open widget above it stops one pad and one gap short of the column's
 * foot.
 *
 * ONLY THE CORNER UNDER THE POINTER OPENS. While a drag is in flight, the empty slot the pointer is
 * over grows to `flex-1` and the dashed outline is drawn on it. The rest keep their height, so the
 * open widget being carried — and every widget on the far side of the chat — holds its own height
 * for the whole drag instead of being halved by a pointer that never came near it.
 *
 * THE OUTLINE IS THE INVITATION, and the widget's own corner is not a target, so the dashed border
 * never promises a drop that would change nothing. The bottom two slots hang their content from the
 * bottom edge, so a collapsed tab sits where the eye already is, and a growing slot grows upward
 * from the corner the pointer is in rather than out from under it.
 *
 * Used by `ChatGutterLayout`, once per slot per side.
 */
export function GutterSlot(props: {
  slot: GutterSlotId;
  widget: GutterWidgetId | null;
  open: boolean;
  hovered: boolean;
  dragging: GutterWidgetId | null;
  onHoverSlot: (slot: GutterSlotId | null) => void;
  onDropWidget: (widget: GutterWidgetId, slot: GutterSlotId) => void;
  renderWidget: (widget: GutterWidgetId) => ReactNode;
}) {
  const { slot, widget, open, hovered, dragging, renderWidget } = props;
  const isBottom = slot === 'bottom-left' || slot === 'bottom-right';
  const isTarget = dragging !== null && dragging !== widget;

  // Height: an open widget's corner grows; an empty one grows only while a drop is over IT.
  const grows = widget === null ? dragging !== null && hovered : open;

  return (
    <div
      data-testid="gutter-slot"
      data-slot={slot}
      data-widget={widget ?? ''}
      className={cn(
        'flex min-h-0 flex-col',
        grows ? 'flex-1' : 'flex-none',
        widget === null && 'min-h-10',
        isBottom ? 'justify-end' : 'justify-start',
        isTarget && 'rounded-lg border-2 border-dashed border-border',
      )}
      onDragOver={(e) => {
        if (dragging === null) return;
        e.preventDefault();
        props.onHoverSlot(slot);
      }}
      onDragLeave={(e) => {
        // `dragleave` also fires on every child the pointer crosses on its way out, so only a
        // departure from this slot's own box closes the corner: the pointer is still inside while
        // what it moved onto is one of this slot's own descendants.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.onHoverSlot(null);
      }}
      onDrop={(e) => { e.preventDefault(); if (dragging !== null) props.onDropWidget(dragging, slot); }}
    >
      {widget === null ? null : renderWidget(widget)}
    </div>
  );
}
