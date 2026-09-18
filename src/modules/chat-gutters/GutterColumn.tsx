import { useRef, type DragEvent, type ReactNode } from 'react';

import { isGutterDrag } from '@/modules/chat-gutters/gutterDrag';
import type { GutterSide, GutterWidgetId } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * One side of the chat: the widgets standing on it, in order, and the whole column as one place to
 * drop another.
 *
 * A SIDE IS A STACK, NOT A SET OF BERTHS. It draws however many widgets are on it — none, one, or
 * all of them — each as tall as what it holds, so a side with one widget shows one card and no empty
 * furniture.
 *
 * THE WHOLE SIDE IS THE TARGET, AND THE POINTER'S HEIGHT DECIDES THE PLACE. Anywhere on this column
 * is a drop; where it lands is read off the cards the pointer has already passed the middle of, so
 * releasing over the top half of a card puts the widget above it and over the bottom half puts it
 * below. Nothing has to be aimed at. The first shape of this drew thin strips between the cards and
 * asked the reader to hit one: a 10px line is a target you miss, and a drag that fails on a miss is
 * a drag that feels broken.
 *
 * WHAT IS DRAWN IS THE ANSWER, NOT THE TARGET. While a drag is in flight the column lifts a little
 * and shows ONE line where the widget would land. It is feedback, never a hit area — it is 2px of
 * accent inside the gap the stack already has, and it never moves the cards around it.
 *
 * AN EMPTY SIDE IS STILL A TARGET, for the same reason: the column keeps a minimum height while a
 * drag is in flight, so a side whose last widget was carried away can always take one back.
 *
 * Rendered twice by `ChatGutterLayout`, once per side.
 */
export function GutterColumn({
  side,
  widgets,
  dragging,
  hovered,
  onHoverDrop,
  onDropWidget,
  renderWidget,
}: {
  side: GutterSide;
  /** The widgets on this side, already in their drawn order. */
  widgets: readonly GutterWidgetId[];
  dragging: GutterWidgetId | null;
  /** The place the pointer is over, as `side` and the index it would insert at. */
  hovered: { side: GutterSide; index: number } | null;
  onHoverDrop: (place: { side: GutterSide; index: number } | null) => void;
  onDropWidget: (widget: GutterWidgetId, side: GutterSide, index: number) => void;
  renderWidget: (widget: GutterWidgetId) => ReactNode;
}) {
  const columnRef = useRef<HTMLElement | null>(null);
  const inFlight = dragging !== null;
  const showIndex = hovered?.side === side ? hovered.index : null;

  /**
   * The place a release here would take: one past every card whose middle the pointer has passed.
   * Read off the live boxes rather than a remembered layout, because the cards are content-sized and
   * the column can be scrolled.
   */
  const indexAt = (clientY: number): number => {
    const cards = columnRef.current?.querySelectorAll('[data-testid="gutter-widget"]') ?? [];
    let index = 0;
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (clientY > box.top + box.height / 2) index += 1;
    }
    return index;
  };

  /**
   * Only a widget of ours is offered a landing. A column that accepts anything accepts a file from
   * the desktop, and its drop would move whichever widget the layout last remembered — which is how a
   * dropped file could silently reorder the stack.
   */
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!inFlight || !isGutterDrag(event.dataTransfer)) return;
    // Without this the browser refuses the drop, whatever the handler below says.
    event.preventDefault();
    onHoverDrop({ side, index: indexAt(event.clientY) });
  };

  return (
    <aside
      ref={columnRef}
      data-testid={`chat-gutter-${side}`}
      data-side={side}
      data-drop-index={showIndex ?? undefined}
      // The side SCROLLS when its stack cannot fit. Every card keeps a floor so none is crushed, so
      // three open widgets in a short window are taller than the column — and clipping them loses both
      // the last widget's rows and the room a drop needs at the foot.
      className={cn(
        'flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain py-3 transition-colors',
        inFlight && 'rounded-xl bg-muted/25',
      )}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        // `dragleave` fires for every child the pointer crosses; only leaving the column clears it.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHoverDrop(null);
      }}
      onDrop={(event) => {
        if (dragging === null || !isGutterDrag(event.dataTransfer)) return;
        event.preventDefault();
        onDropWidget(dragging, side, indexAt(event.clientY));
      }}
    >
      {widgets.map((widget, index) => (
        <div key={widget} className="contents">
          <DropLine shown={inFlight && showIndex === index} />
          {renderWidget(widget)}
        </div>
      ))}
      <DropLine shown={inFlight && showIndex === widgets.length} />
      {/* A side with nothing on it still has to be reachable: while a drag is in flight it keeps a
          band of its own, so the pointer has somewhere to be. */}
      {inFlight && widgets.length === 0 ? <div className="min-h-24 flex-1" /> : null}
    </aside>
  );
}

/**
 * Where the widget would land, drawn in the gap the stack already leaves. `-my-2` takes back half of
 * that gap on each side, so the line appears in the space between two cards without moving either.
 */
function DropLine({ shown }: { shown: boolean }) {
  return (
    <div
      aria-hidden
      data-testid="gutter-drop-line"
      data-shown={shown ? 'true' : 'false'}
      className={cn(
        // `accent-ink`, not the accent fill: the fill measures 2.81:1 on the light theme's surface,
        // under the 3:1 a non-text indicator owes. Forced colours drop the fill outright, so the lit
        // line asks for the system's own Highlight there — otherwise the one piece of in-flight
        // feedback paints white on white and the drop is made blind.
        '-my-2 h-0.5 shrink-0 rounded-full transition-colors',
        shown ? 'bg-accent-ink forced-colors:bg-[Highlight]' : 'bg-transparent',
      )}
    />
  );
}
