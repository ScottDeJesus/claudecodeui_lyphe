import { ChevronDownIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { GutterWidgetId } from '@/shared/types';
import { GUTTER_DRAG_TYPE } from '@/modules/chat-gutters/gutterDrag';
import { Badge, Card, ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * One widget's chrome: the card it always is, the header it always wears, and the body that opens
 * under it.
 *
 * ONE COMPONENT, TWO STATES — never two components. Collapsed and open are the SAME card and the
 * same header row: the same height, inset, type and icon, in the same place. Only the body below it
 * comes and goes, and the chevron turns to say so. It used to be a ghost button when collapsed and a
 * card header when open, which drew two different objects — different heights, different type, a
 * title that shifted as it opened — so the widget appeared to jump rather than to unfold.
 *
 * VERVE, SPARINGLY. The card is `.vv-card`; the icon wears the accent's ink, which is the house's
 * one green-on-text (`text-accent-ink`, tokens.css), and it marks the widget without colouring the
 * row. The header carries a wash of the muted surface — barely a tint, 1.05:1, and dropped outright
 * under forced colours — so what actually divides it from the body is the hairline under it.
 *
 * THE FRAME KNOWS NOTHING OF RUNS OR MEMORIES. It is handed a title, a count, an icon and a body,
 * so a third widget costs the layout one entry and this file no change at all. The count is drawn
 * only when it is above zero — a badge reading zero is noise on a header that already says what it is.
 *
 * THE WHOLE HEADER IS THE TOGGLE, and it is also the drag handle. A press and release anywhere on it
 * opens or closes the body — the chevron is the sign of what a press will do, not the only place to
 * press it — and a press that travels drags the widget instead. The header is a real `<button>`, so
 * Enter and Space reach it and a screen reader is told `aria-expanded`.
 *
 * THE BODY ANIMATES BOTH WAYS, in the house's collapse motion — a grid whose single row goes between
 * `0fr` and `1fr` over 200ms with the content clipped while it moves. It is spelt here rather than
 * taken from `shared/ui/Collapsible.tsx` because that primitive owns its own open state and its own
 * markup, and this body is a flex child that must also grow and scroll; what is shared is the motion,
 * and the two must be changed together. The body is MOUNTED while it opens and unmounted a beat after
 * it closes, so a widget that is shut does no work and a closing widget still has something to animate. The widget id rides `dataTransfer` so the places it may land in can tell
 * what is in flight, and `effectAllowed = 'move'` says the widget changes place rather than being
 * copied into a second one.
 *
 * Used by `src/modules/chat-gutters/ChatGutterLayout.tsx`, once per widget.
 */
/** How long the body takes to open or close; the body is unmounted after it, not before. */
const BODY_MOTION_MS = 200;

export function GutterWidgetFrame({
  widget,
  title,
  count,
  icon: Icon,
  open,
  onToggle,
  onDragStart,
  onDragEnd,
  children,
}: {
  widget: GutterWidgetId;
  title: string;
  count: number;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  onDragStart: (widget: GutterWidgetId) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // The body outlives `open` by the length of the animation, so a close is something to watch rather
  // than a disappearance — and a widget left closed mounts nothing at all. The tail is started by the
  // press that closes it, never by an effect watching `open`: an effect that sets state on a prop
  // change is a second render for something the event already knew.
  const [closing, setClosing] = useState<number | null>(null);
  // The body fills its card once it is open, and a flex fill has nothing to animate — so for the
  // length of the motion it is sized by the grid row instead, which is the thing that moves.
  const [opening, setOpening] = useState(false);
  // True for exactly the frame the body mounts in. The row's clock starts at the press, but a row of
  // `1fr` around an empty item has nothing to move — so a tall body spent most of its ease invisible
  // and then appeared at 87% of its height. Held for one frame, the curve starts with content in it.
  const [rowHeld, setRowHeld] = useState(false);
  const rowFrame = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    if (rowFrame.current !== null) cancelAnimationFrame(rowFrame.current);
  }, []);

  const toggle = () => {
    if (!open) {
      if (openTimer.current !== null) clearTimeout(openTimer.current);
      setOpening(true);
      openTimer.current = setTimeout(() => setOpening(false), BODY_MOTION_MS);
      setRowHeld(true);
      if (rowFrame.current !== null) cancelAnimationFrame(rowFrame.current);
      rowFrame.current = requestAnimationFrame(() => {
        rowFrame.current = null;
        setRowHeld(false);
      });
    }
    if (open) {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      // The height it has RIGHT NOW is the ceiling for the whole close. Without it the card is, for
      // the frames before the body's row reaches zero, an unclipped stack of its own content: a tall
      // run list painted twice the window and threw everything under it down the page.
      setClosing(cardRef.current?.getBoundingClientRect().height ?? null);
      closeTimer.current = setTimeout(() => setClosing(null), BODY_MOTION_MS);
    }
    onToggle();
  };

  const startDrag = (event: DragEvent<HTMLElement>) => {
    // The app's own type is what a column checks before it accepts a drop; `text/plain` rides along
    // so a drag that leaves the app carries something a plain target can read.
    event.dataTransfer.setData(GUTTER_DRAG_TYPE, widget);
    event.dataTransfer.setData('text/plain', widget);
    event.dataTransfer.effectAllowed = 'move';
    onDragStart(widget);
  };

  return (
    <Card
      ref={cardRef}
      data-testid="gutter-widget"
      data-widget={widget}
      data-open={open ? 'true' : 'false'}
      className={cn(
        // The floor eases in with the body: applied outright, it snapped the card open to 9rem before
        // the body had moved at all, which is the jump the animation exists to replace.
        // `max-h-full` in BOTH states, and never shorter than its own header: the card is a flex item
        // its column may shrink, and an opening card — whose floor is still on its way up — was being
        // squeezed to 28px, under the 44px header, before it grew.
        'flex max-h-full min-h-11 flex-col overflow-hidden transition-[min-height] duration-200 ease-out',
        // Open: as tall as what it holds, up to the room its side has; past that the body scrolls
        // below the header, which stays put. The floor is a header and a row or two, so a widget
        // holding one line is not crushed to a sliver by a taller neighbour, and it yields on a
        // short window (`45%`), where a fixed floor would push the card below it off the screen.
        // Collapsed: the header's own height, and no share of the column at all.
        // Both states name a min-height in px: a transition from `auto` does not animate, which is why
        // the closed card says a height rather than leaving it unset. The open floor never falls below
        // the header itself — on a column with more widgets than room, the opening card was the only
        // thing that could shrink and dipped to 28px, under its own 44px header, before growing.
        open ? 'min-h-[max(2.75rem,min(9rem,45%))]' : 'shrink-0',
      )}
      style={closing === null ? undefined : { maxHeight: `${closing}px` }}
    >
      <button
        type="button"
        data-testid="gutter-widget-header"
        draggable
        onDragStart={startDrag}
        onDragEnd={onDragEnd}
        onClick={toggle}
        aria-expanded={open}
        // No `aria-label`: the name comes from the row itself — the widget's title and its count —
        // and `aria-expanded` says which way a press will go. Labelling it "Collapse" made all three
        // headers read as the same control with no widget in the name.
        title={t('gutters.dragHint')}
        className={cn(
          'flex h-11 w-full shrink-0 cursor-grab select-none items-center gap-2 bg-muted/40 pl-3 pr-2 text-left transition-colors hover:bg-muted/70',
          open && 'border-b border-border',
        )}
      >
        <Icon className="h-4 w-4 shrink-0 text-accent-ink forced-colors:text-[CanvasText]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        {count > 0 ? <Badge as="span" tone="info">{count}</Badge> : null}
        {/* One glyph for both states, turned rather than swapped: it says which way the next press
            will go. It is a sign, not a second control — the press belongs to the whole header. */}
        <ChevronDownIcon
          aria-hidden="true"
          data-testid="gutter-widget-chevron"
          className={cn(
            // Forced colours keep an author colour on an SVG, so the sign needs the system ink too —
            // the same rule the widget's own icon wears.
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out forced-colors:text-[CanvasText]',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>

      {/* The grid's one row carries the motion; `min-h-0` is what lets the body shrink below its
          content once the card meets its cap, instead of overflowing it rather than scrolling. */}
      <div
        className={cn(
          'grid min-h-0 transition-[grid-template-rows] duration-200 ease-out',
          open && !rowHeld ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          // The fill waits for the motion to finish; taken at once, the card jumped to its full height
          // in a single frame and the animation had nothing left to show.
          open && !opening && 'flex-1',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {open || closing !== null ? (
            <ScrollArea className="h-full">
              <div className="p-3">{children}</div>
            </ScrollArea>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
