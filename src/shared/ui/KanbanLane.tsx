import { type DragEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';

import { cn } from '@/shared/utils';
import { ActionMenu, type ActionMenuItem } from '@/shared/ui/ActionMenu';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { KANBAN_CARD_DRAG_TYPE, KanbanCard, type KanbanCardModel } from '@/shared/ui/KanbanCard';
import { ScrollArea } from '@/shared/ui/ScrollArea';
import { Spinner } from '@/shared/ui/Spinner';

/**
 * One column of a board: a header that says what it holds and how much, a scrolling list of
 * cards, and the tail that fetches the next page.
 *
 * The lane takes DATA, not children. A lane that rendered whatever children it was handed could
 * not own the drop index without introspecting them, and the drop index is the one thing only
 * the lane knows: where between two cards a dragged card would land.
 *
 * `laneId` is OPAQUE. This file never compares it to anything — it rides through to the drop
 * callback and onto `data-lane-id` for a delegated handler to read. Every board policy is the
 * screen's: the `+` renders because `onAddCard` was passed, the lane dims because `muted` was
 * passed, and the overflow shows whatever `menuItems` holds. The moment this file tests an id
 * against a literal it stops being kit.
 */

type KanbanLaneProps = {
  /** OPAQUE to the kit. The panel's own lane key; the kit never compares it to a literal. */
  laneId: string;
  title: string;
  /** Server-side total. `null` while the first page is in flight — never 0 as a stand-in. */
  count: number | null;
  cards: KanbanCardModel[];
  selectedCardId?: string | null;
  /** Passed straight down to every card in this lane. The panel decides which lane is muted. */
  muted?: boolean;
  loading?: boolean; hasMore?: boolean; loadingMore?: boolean;
  onLoadMore: () => void;
  onOpenCard: (id: string) => void;
  /** The card lands in this lane at `index`; the board computes the fractional sort_order. */
  onDropCard: (cardId: string, laneId: string, index: number) => void;
  onMoveCard: (cardId: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void;
  /** OPTIONAL. Absent means this lane shows no `+` button and no empty-state add action. */
  onAddCard?: () => void;
  cardMenuItems: (card: KanbanCardModel) => ActionMenuItem[];
  menuItems: ActionMenuItem[];
};

/** The lane's fixed vocabulary — see the same block in KanbanCard for why it lives here. */
const WORDS = {
  addTo: (title: string) => `Add card to ${title}`,
  laneActions: (title: string) => `${title} lane actions`,
  addCard: 'Add card',
  loadMore: 'Load more',
  loadingMore: 'Loading more cards',
};

/** Rendered by the board's lane strip, one per lane the screen's policy composed. */
export function KanbanLane({
  laneId,
  title,
  count,
  cards,
  selectedCardId = null,
  muted = false,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onOpenCard,
  onDropCard,
  onMoveCard,
  onAddCard,
  cardMenuItems,
  menuItems,
}: KanbanLaneProps) {
  const titleId = useId();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** The lane's own element, so the drop maths can measure ITS cards and no other lane's. */
  const laneRef = useRef<HTMLElement | null>(null);

  /**
   * Three pieces of drag and focus state, and the three things the markup reads back out of them:
   * the insertion line drawn on a neighbour's edge, the accepting-lane wash, and which single card
   * holds the lane's Tab stop.
   *
   * `dropIndex` is the gap the pointer is nearest, `draggingCardId` is the card in flight (the
   * slot it left stays in place), and `focusIndex` is where the keyboard is. It is the last one
   * the lane has to keep, because only the lane knows how many cards it has.
   */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  /**
   * The insertion line is drawn on a NEIGHBOUR's edge, never as a phantom box: `dropIndex` of i
   * means "lands above cards[i]", and the one index past the end is the last card's bottom.
   */
  const edgeFor = (index: number): 'top' | 'bottom' | undefined => {
    if (dropIndex === null) return undefined;
    if (dropIndex === index) return 'top';
    if (dropIndex === cards.length && index === cards.length - 1) return 'bottom';
    return undefined;
  };

  // Clamped on BOTH sides, so a lane always has exactly one Tab stop: the upper bound covers a
  // lane whose pages shrank under the focused index, and the lower one covers a focus index that
  // is somehow negative — which would otherwise leave every card at tabIndex -1 and the lane
  // unreachable by keyboard entirely.
  const tabStopIndex = Math.min(Math.max(focusIndex, 0), Math.max(0, cards.length - 1));

  /** The cards this lane has actually rendered, in the order they are painted. Measuring the DOM
   *  rather than `cards` is deliberate: only the boxes know where a card sits after a scroll. */
  const renderedCards = (): HTMLElement[] =>
    Array.from(laneRef.current?.querySelectorAll<HTMLElement>('[data-card-id]') ?? []);

  // The card has already put its id on the dataTransfer by the time this runs — its own
  // `onDragStart` fires first, on the element the drag began on, and the event bubbles here.
  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    const origin = event.target instanceof Element ? event.target.closest('[data-card-id]') : null;
    const cardId = origin?.getAttribute('data-card-id');
    if (cardId) setDraggingCardId(cardId);
  };

  const handleDragEnd = (_event: DragEvent<HTMLElement>) => {
    setDraggingCardId(null);
    setDropIndex(null);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    // A drag that is not carrying a card is not this lane's drop. A text selection or a link
    // dragged in from another window carries `text/plain` of its own, and without this the lane
    // would wash itself as a target, draw an insertion line for a card that does not exist, and
    // hand the board a sentence as a card id on the drop.
    if (!event.dataTransfer?.types.includes(KANBAN_CARD_DRAG_TYPE)) return;

    // A `dragover` that does not preventDefault says "not a drop target", and the browser answers
    // with a no-entry cursor and no `drop` event at all — so accepting IS the preventDefault.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    // The index comes from the POINTER against each card's own rectangle, never from the event
    // target. The target under the pointer is a gap as often as it is a card — the lane's padding,
    // the 8px between two cards, the tail below the last one — and an index read off it would
    // snap a drop aimed between two cards onto one of them. Every card whose vertical midline is
    // above the pointer sits above it, so counting those IS the index; the list is already in
    // paint order, so the first card below the pointer ends the walk.
    let index = 0;
    for (const node of renderedCards()) {
      const box = node.getBoundingClientRect();
      if (event.clientY < box.top + box.height / 2) break;
      index += 1;
    }

    setDropIndex(index);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    // `dragleave` fires again for every child the pointer crosses on its way OUT of a card, so a
    // bare clear would blink the insertion line away while the pointer was still well inside the
    // lane. `relatedTarget` is where the pointer is going: still in this lane means it never left.
    const heading = event.relatedTarget;
    if (heading instanceof Node && event.currentTarget.contains(heading)) return;
    setDropIndex(null);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    // Read from the card's OWN type, never from `text/plain`: that one is set by every kind of
    // drag a window can carry, and its contents would be a sentence as readily as an id.
    const cardId = event.dataTransfer.getData(KANBAN_CARD_DRAG_TYPE);
    const index = dropIndex ?? cards.length;
    setDropIndex(null);
    setDraggingCardId(null);
    // Nothing under the card's type means this was never a card drag. The state clears either
    // way; nothing is moved.
    if (cardId) onDropCard(cardId, laneId, index);
  };

  const handleCardMove = (cardId: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => {
    const from = cards.findIndex((card) => card.id === cardId);

    // A move WITHIN this lane shifts the card by dy, and the roving stop travels with it. The
    // focus itself needs no help: cards are keyed by id, so React moves the same DOM node and the
    // browser keeps focus on it. A move ACROSS lanes takes the card out of this list entirely,
    // and where focus lands then is the board's decision — it is the only thing that can see both
    // lanes — so the index is left alone here.
    if (from >= 0 && dx === 0 && dy !== 0) {
      setFocusIndex(Math.min(Math.max(from + dy, 0), cards.length - 1));
    }

    onMoveCard(cardId, dx, dy);
  };

  /** The other half of the roving tab stop. A card handles only the keys that act on ITSELF;
   *  the keys that move FOCUS are the lane's, because only the lane knows how many cards it has. */
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // A modified arrow was the CARD's key — it moved the card, and the card consumed it. Anything
    // raised inside the lane's own `…` menu belongs to that menu.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[aria-haspopup="menu"], [role="menu"]')) return;

    // Measured from the card that actually holds focus, not from `focusIndex`: the two can part
    // company — a page appending under a focused card, a pointer focusing another — and a walk
    // that trusted the state would jump two cards from where the reader was standing.
    const origin = target instanceof Element ? target.closest<HTMLElement>('[data-card-id]') : null;
    const focused = origin ? cards.findIndex((card) => card.id === origin.dataset.cardId) : -1;
    const current = focused >= 0 ? focused : tabStopIndex;

    // The far end of the walk is 0 on an empty lane, never -1. `cards.length - 1` is negative
    // there, and a negative focus index is not "no card": it survives every later render, so the
    // first card to arrive in that lane is handed a tabIndex of -1 and the lane as a whole falls
    // out of the Tab order — one ArrowDown on an empty lane's `+` button is all it takes.
    const last = Math.max(0, cards.length - 1);

    let next: number;
    if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (event.key === 'ArrowDown') next = Math.min(last, current + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    // Nothing else is ours. Left and right in particular: crossing a lane boundary means knowing
    // which lane sits next, and this file knows only its own id as an opaque string. Those keys
    // are left to bubble, and the board — which owns the strip and every lane on it — answers.
    else return;

    event.preventDefault();
    setFocusIndex(next);
    renderedCards()[next]?.focus();
  };

  /**
   * The tail of the lane, and the only thing here that lives outside a render.
   *
   * `onLoadMore` and `hasMore` are read through a ref rather than listed as dependencies, because
   * the panel rebuilds `onLoadMore` on every render — a streamed frame, a toast, an unrelated
   * state change — and an effect that depended on it would disconnect and rebuild the observer
   * every time, once per lane. The ref carries the latest pair across without ever re-observing.
   */
  const latest = useRef({ onLoadMore, hasMore });
  useEffect(() => {
    latest.current = { onLoadMore, hasMore };
  });

  // The sentinel only exists once there is a page to append to, so this is the effect's real
  // dependency: it runs when the sentinel enters the tree and its cleanup disconnects the
  // observer when it leaves or the lane unmounts. A board open for an hour pages many times,
  // and one observer per page would be one leak per page.
  const sentinelActive = !loading && cards.length > 0;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined;

    // One request per intersection. The observer reports on every change of the sentinel's
    // visibility, and without this latch a lane resting at the bottom of the viewport would ask
    // for the next page on each callback. Scrolling the sentinel back out of view re-arms it.
    //
    // No `root`: the sentinel sits inside the body's scroller, and the observer already clips the
    // intersection by every scrolling ancestor — so "visible" means visible in the LANE, which is
    // the question being asked, and a lane scrolled out of the strip loads nothing.
    let requested = false;

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      if (!entry.isIntersecting) {
        requested = false;
        return;
      }
      if (requested || !latest.current.hasMore) return;
      requested = true;
      latest.current.onLoadMore();
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinelActive]);

  return (
    <section
      ref={laneRef}
      className={cn(
        'vv-lane flex h-full min-h-0 shrink-0 flex-col',
        muted && 'vv-lane--muted',
        dropIndex !== null && 'vv-lane--over',
        draggingCardId !== null && 'vv-lane--dragging',
      )}
      role="group"
      aria-labelledby={titleId}
      // L11: a lane whose first page is in flight shows skeletons that are aria-hidden, so
      // without this a screen reader hears an empty group rather than one that is still filling.
      aria-busy={loading || loadingMore || undefined}
      data-lane-id={laneId}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="vv-lane__head flex h-11 shrink-0 items-center gap-2 px-3">
        <h3 id={titleId} className="vv-lane__title truncate text-foreground">{title}</h3>
        {/* `—` and never `0`: a count nobody has yet is not a count of none. */}
        <span className="vv-tabular shrink-0 text-xs text-ink-faint">
          {loading || count === null ? '—' : count}
        </span>
        <span className="flex-1" />
        {onAddCard && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={WORDS.addTo(title)}
            onClick={onAddCard}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <ActionMenu
          label={WORDS.laneActions(title)}
          ariaLabel={WORDS.laneActions(title)}
          items={menuItems}
          icon={MoreHorizontal}
          iconOnly
          variant="ghost"
          size="icon"
          className="shrink-0"
          triggerClassName="vv-lane__menu-trigger h-7 w-7"
        />
      </header>

      <ScrollArea className="vv-lane__body min-h-0 flex-1">
        {loading && (
          <div className="flex flex-col gap-2 p-2" aria-hidden="true">
            <div className="vv-skeleton h-16" />
            <div className="vv-skeleton h-12" />
            <div className="vv-skeleton h-12" />
          </div>
        )}

        {!loading && cards.length === 0 && (
          <div className="vv-lane__empty p-2">
            <EmptyState actionLabel={onAddCard ? WORDS.addCard : undefined} onAction={onAddCard} />
          </div>
        )}

        {!loading && cards.length > 0 && (
          <>
            {/* The LANE owns the gap between cards; a card sets no margin of its own. */}
            <ul className="flex flex-col gap-2 p-2">
              {cards.map((card, index) => (
                <KanbanCard
                  key={card.id}
                  card={card}
                  selected={card.id === selectedCardId}
                  dragging={card.id === draggingCardId}
                  muted={muted}
                  dropEdge={edgeFor(index)}
                  tabStop={index === tabStopIndex}
                  onOpen={onOpenCard}
                  onMove={handleCardMove}
                  menuItems={cardMenuItems(card)}
                />
              ))}
            </ul>

            <div className="flex flex-col items-center gap-2 px-2 pb-2">
              {/* Observed by the effect above; it carries no behaviour of its own. */}
              <div ref={sentinelRef} className="vv-lane__sentinel h-2 w-full" aria-hidden="true" />
              {loadingMore && <Spinner size={20} label={WORDS.loadingMore} />}
              {/* The button is not a hover affordance: the sentinel is unreachable from a
                  keyboard, so this is how the rest of a lane is read without a pointer. */}
              {hasMore && (
                <Button variant="tonal" className="w-full" disabled={loadingMore} onClick={onLoadMore}>
                  {WORDS.loadMore}
                </Button>
              )}
            </div>
          </>
        )}
      </ScrollArea>
    </section>
  );
}
