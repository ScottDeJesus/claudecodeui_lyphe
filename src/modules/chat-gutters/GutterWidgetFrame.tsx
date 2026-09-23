import { ChevronDownIcon, Maximize2Icon, Minimize2Icon, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { GutterWidgetId } from '@/shared/types';
import { GUTTER_DRAG_TYPE } from '@/modules/chat-gutters/gutterDrag';
import { Badge, Card, ScrollArea } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';
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
 * THE FRAME KNOWS NOTHING OF RUNS, MEMORIES OR PAGES. It is handed a title, a count, an icon, a body,
 * and at most one node of the widget's own for its header — so a further widget costs the layout one
 * entry and this file no change at all. `flush` is
 * the one thing a body may ask of its own chrome: a body that IS a frame reaching its own edges — the
 * Embed widget's — gets the card's whole inside, with no padding and no scroll area, because a live
 * iframe scrolls itself and a padded one would sit in a box two insets smaller than the card.
 *
 * The count is drawn only when it is above zero — a badge reading zero is noise on a header that
 * already says what it is.
 *
 * THE HEADER IS THE TOGGLE, and it is also the drag handle. A press and release anywhere on it opens
 * or closes the body — the chevron is the sign of what a press will do, not the only place to press
 * it — and a press that travels drags the widget instead. The header is a real `<button>`, so Enter
 * and Space reach it and a screen reader is told `aria-expanded`.
 *
 * BESIDE IT STAND EVERY OTHER CONTROL, and never inside it. The frame's fullscreen switch and the
 * widget's own `headerAction` are each a second control and therefore a second button: a button
 * inside a button is invalid markup, and the press meant for one of them must not also fold the card
 * or begin a drag. So the row is a flex container — the toggle takes all the width it can, then
 * `headerAction`, then the switch — and both of the others are siblings of the toggle rather than
 * children of it, which is what makes the click and the drag above belong to the toggle alone. The
 * SLOT IS GENERIC: this file is handed a node and knows nothing about what it does, which is how a
 * widget's own act comes to live in its chrome without this file learning about runs, memories or
 * pages. The node supplies its OWN size and margin, as the switch does, because the frame hands it
 * the edge of a 44px row and nothing more. A widget that asks for neither draws the toggle and
 * nothing else, exactly as it was.
 *
 * FULLSCREEN IS A CLASS CHANGE ON THIS CARD, never a move. The body of a widget may be a live iframe
 * — the Embed widget's is — and React reparenting an iframe destroys and recreates the element, so a
 * switch that lifted the card into an overlay would reload the page inside it. The card becomes
 * `fixed inset-0` where it stands, the fold is forced open (a fullscreen card showing only its own
 * header is a screen of nothing), and the root claims Escape so a dialog behind it stands down. The
 * KEY itself belongs to the layout, which owns which widget is fullscreen; this card cannot turn its
 * own fullscreen off.
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
  open: placed,
  onToggle,
  onDragStart,
  onDragEnd,
  fullscreen = false,
  onToggleFullscreen,
  headerAction,
  flush = false,
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
  /** True while this card has the whole viewport. Owned by the layout, which owns the key that leaves it. */
  fullscreen?: boolean;
  /** Absent for a widget that offers no fullscreen switch; present, it draws one beside the toggle. */
  onToggleFullscreen?: () => void;
  /**
   * A widget's own control for this row, between the toggle and the switch. The frame draws it and
   * styles nothing of it: the node carries its own size, margin and label, and draws nothing at all
   * by returning `null` when it has nothing to offer.
   */
  headerAction?: ReactNode;
  /** True for a body that is itself a frame reaching its own edges: no padding, no scroll area. */
  flush?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // A fullscreen card is open, whatever its placement remembers. The PLACEMENT is untouched — nothing
  // is written here — so leaving fullscreen returns the widget to exactly the fold it was left in.
  const open = fullscreen || placed;
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
      data-fullscreen={fullscreen ? '' : undefined}
      {...(fullscreen ? OWNS_ESCAPE : null)}
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
        // A FLUSH body has no height of its own to grow the card with — it is a frame asking for 100%
        // of whatever it is given — so it takes the column's spare height (`flex-1`); without that it
        // sat at the floor with a page peeking through a slot (measured: 250px of card in a 1080px
        // column). The other widgets are content-sized and stay that way, which is why this rides on
        // `flush` rather than on `open`.
        //
        // AND IT KEEPS A FLOOR, a taller one than the others: growth and a floor do not conflict, and
        // taking the floor away (`min-h-0`) let a taller neighbour crush the card to 2px of border,
        // header and fullscreen switch clipped out of reach, with no control left to reopen it —
        // measured by Athena's review, memory 658 / embed 2 in a 700px column. 16rem is a header, the
        // address row and a readable slice of page; `45%` still yields on a short window, where a
        // fixed floor would push the widgets under it off the column.
        open && (flush ? 'min-h-[max(2.75rem,min(16rem,45%))] flex-1' : 'min-h-[max(2.75rem,min(9rem,45%))]'),
        !open && 'shrink-0',
        // Fullscreen replaces the card's whole sizing rather than adding to it, and `tailwind-merge`
        // is what makes that a replacement: `max-h-none` beats `max-h-full`, `min-h-0` beats the
        // open floor, `rounded-none` the card's radius. `z-[45]` is the transcript card's fullscreen
        // layer — over the workspace, UNDER the dialog layer, so a dialog opened from here comes up
        // in front (see `ShapeFrame`).
        // Stated here with the transcript card's for the same reason: in the home-screen app the
        // fullscreen header row and its switch must clear the status bar above and the notch band
        // at the side, and this layer is the screen (see `ShapeFrame`, and src/index.css).
        fullscreen && 'pwa-notch-safe fixed inset-0 z-[45] m-0 h-full max-h-none min-h-0 rounded-none border-0',
      )}
      // The closing clamp is a height for a card in a column; a fullscreen card is the screen.
      style={closing === null || fullscreen ? undefined : { maxHeight: `${closing}px` }}
    >
      {/* The ROW is the header; the toggle is the whole of it but for the controls beside it — the
          widget's own `headerAction` and the fullscreen switch — each of which has to be its own
          control and so cannot be inside that button. With neither to draw, the toggle takes the row
          entire and the markup is what it always was. */}
      <div
        className={cn(
          'flex h-11 w-full shrink-0 items-center bg-muted/40',
          open && 'border-b border-border',
        )}
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
          className="flex h-full min-w-0 flex-1 cursor-grab select-none items-center gap-2 pl-3 pr-2 text-left transition-colors hover:bg-muted/70"
        >
          <Icon className="h-4 w-4 shrink-0 text-accent-ink forced-colors:text-[CanvasText]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
          {count > 0 ? <Badge as="span" tone="info" data-testid="gutter-widget-count">{count}</Badge> : null}
          {/* One glyph for both states, turned rather than swapped: it says which way the next press
              will go. It is a sign, not a second control — the press belongs to the header. */}
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
        {headerAction}
        {onToggleFullscreen ? (
          <button
            type="button"
            data-testid="gutter-widget-fullscreen"
            onClick={onToggleFullscreen}
            aria-pressed={fullscreen}
            aria-label={t(fullscreen ? 'gutters.exitFullscreen' : 'gutters.fullscreen')}
            title={t(fullscreen ? 'gutters.exitFullscreen' : 'gutters.fullscreen')}
            className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {fullscreen ? (
              <Minimize2Icon aria-hidden="true" className="h-4 w-4 forced-colors:text-[CanvasText]" />
            ) : (
              <Maximize2Icon aria-hidden="true" className="h-4 w-4 forced-colors:text-[CanvasText]" />
            )}
          </button>
        ) : null}
      </div>

      {/* The grid's one row carries the motion; `min-h-0` is what lets the body shrink below its
          content once the card meets its cap, instead of overflowing it rather than scrolling. */}
      <div
        className={cn(
          'grid min-h-0 transition-[grid-template-rows] duration-200 ease-out',
          open && !rowHeld ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          // The fill waits for the motion to finish; taken at once, the card jumped to its full height
          // in a single frame and the animation had nothing left to show. A fullscreen card has no
          // motion to protect — it arrived at its size in one step — so it fills at once.
          ((open && !opening) || fullscreen) && 'flex-1',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {open || closing !== null ? (
            // A flush body owns its own inside: it is a frame that reaches the card's edges, and it
            // scrolls itself if it scrolls at all.
            flush ? (
              <div className="h-full min-h-0">{children}</div>
            ) : (
              <ScrollArea className="h-full">
                <div className="p-3">{children}</div>
              </ScrollArea>
            )
          ) : null}
        </div>
      </div>
    </Card>
  );
}
