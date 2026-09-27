import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeckStrip } from '@/modules/dispatcher/hooks/useDeckStrip';
import { StatusFlow } from '@/modules/dispatcher/StatusFlow';
import type { LaneFlow } from '@/shared/types';
import { Button } from '@/shared/ui';

/**
 * An arc deck's plans as ONE horizontal strip, one card per view — AN ARC'S LAYOUT IN BOTH HOMES, the
 * Runner tab as much as the chat gutter's widget, so a reader who has paged one has paged the other
 * (operator, 2026-09-26: the swipable plan cards came back under an arc). The tab has the width for a
 * wall, and an arc's plans do not use it: they are a set of things that walk in order, and one whole
 * card at a time is how a reader reads one. Top to bottom: the arc's flow of plans, the nav row, and
 * the strip.
 *
 * THE FLOW IS THE STRIP'S MAP. Every plan of the arc is a node on it, and the node of the card in
 * view is the selected one; pressing any node pages the strip straight to that card (`goTo`), a
 * smooth centring scroll, however far along the arc it is.
 *
 * THE NAV ROW IS THE STRIP'S, SO IT SITS ON THE STRIP: over the cards it moves — the arrows at either
 * end, `Card N of M` between them. It is drawn only when there is more than one card to move to.
 *
 * THE STRIP MOVES THREE WAYS beside the flow: a swipe or a trackpad (CSS scroll snap, no script), the
 * arrows (one card each, disabled at their end), and Left/Right — AND ONLY A KEYSTROKE MADE INSIDE THE
 * STRIP COUNTS, because a card can open a dialog that portals out of it while staying a child of it in
 * the React tree, and React bubbles a keydown along that tree. A press while the strip is still
 * travelling towards an earlier ask is one card on FROM THAT ASK, not from wherever the animation had
 * got (`useDeckStrip`'s `intended`). The focused card is centred on mount and again whenever
 * `focusIndex` changes — the arc's first plan that still has a walk in front of it (`deckFocusIndex`).
 *
 * Every card is exactly the strip's width (`DeckItem`), so ONE card is in view and the snap pages one
 * card per press: never the side-by-side peek, where a narrower card showed a sliver of its neighbour
 * and cut it at the strip's edge wherever it ran taller than the reader's. Each card is as tall as its
 * OWN content: the strip is a row of flex items and would wear the tallest card's height under every
 * shorter one, so its height is set instead to the card the reader is on (`useDeckStrip` measures it)
 * and the deck grows and shrinks as the strip is paged, swiped or keyed past.
 *
 * `data-arc-strip`, `data-arc-viewing`, `data-arc-prev` and `data-arc-next` are the browser harness's
 * handles.
 *
 * Used by `DeckFrame`, as the body of every arc deck: the Runner tab's and the chat gutter widget's.
 */
export function DeckStrip({
  flow,
  stripLabel,
  focusIndex,
  cardCount,
  children,
}: {
  /** The arc's plans as a track: the map the strip is paged by. */
  flow: LaneFlow;
  /** What a screen reader hears for the strip. */
  stripLabel: string;
  /** The card the strip opens on, and returns to when the arc moves. */
  focusIndex: number;
  /** How many cards the strip holds — the arrows' own count. */
  cardCount: number;
  /** The strip's items — one `DeckItem` per card, in the arc's own order, which is the flow's order too. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { stripRef, view, step, goTo, onScroll, onKeyDown, onReaderGesture, onReaderWheel, stripHeight } = useDeckStrip(Math.max(focusIndex, 0), cardCount);
  const movable = cardCount > 1;

  return (
    <>
      <StatusFlow
        nodes={flow.nodes}
        doneCount={flow.doneCount}
        selected={flow.nodes[view.index]?.key ?? null}
        onSelect={(key) => goTo(flow.nodes.findIndex((node) => node.key === key))}
        ariaLabel={flow.ariaLabel}
      />
      {movable && (
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={t('dispatcher.pager.previousPlan')}
            disabled={view.atStart}
            onClick={() => step(-1)}
            data-arc-prev
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="min-w-0 flex-1 text-center text-xs tabular-nums text-muted-foreground" data-arc-viewing>
            {t('dispatcher.pager.plan', { n: view.index + 1, total: cardCount })}
          </p>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={t('dispatcher.pager.nextPlan')}
            disabled={view.atEnd}
            onClick={() => step(1)}
            data-arc-next
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
      {/* `relative` makes the strip its cards' offset parent, which centring reads. `tabIndex` lets
          the keyboard's Left/Right move it once focused. `overflow-y-hidden` beside `overflow-x-auto`:
          alone, `overflow-x: auto` computes `overflow-y` to `auto`, and anything absolutely placed
          below the row would turn the strip into a vertical scroller that eats the page's wheel.
          `overflow-y-hidden` keeps that wheel, but it does not stop the box being scrolled AS A BOX —
          a focus move still shifted it, cutting the top of the reader's own card. `useDeckStrip`
          pins the strip's vertical offset at 0 on every scroll, so neither can move it.

          `items-start` BESIDE A MEASURED HEIGHT IS THE WHOLE CURE for the empty space: the row
          stretches its items by default, so the tallest card of an arc used to write its height
          under every shorter one (measured on the docstore deck, 2026-09-25: 260px of nothing
          under a three-line card). With the cards at their own heights and the strip at the
          reader's card's, the deck is exactly as tall as what it shows — and the cards it is not
          showing keep their own heights, so paging to one grows the deck to it. The height is
          animated on the fold's own curve so the growth is seen rather than jumped. With one card
          per view, the card in view is the only card whole on screen, and it is always whole.

          `onReaderGesture` / `onReaderWheel` are the strip listening to the reader's own hands: a
          swipe, a drag or a trackpad's horizontal wheel drops an ask that is still travelling, so the
          next press is measured from what the reader scrolls to (see `useDeckStrip`). */}
      <ol
        ref={stripRef}
        data-arc-strip
        tabIndex={0}
        aria-label={stripLabel}
        style={stripHeight === null ? undefined : { height: stripHeight }}
        className="scrollbar-hide relative flex min-w-0 snap-x snap-mandatory items-start gap-3 overflow-x-auto overflow-y-hidden rounded-lg transition-[height] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onWheel={onReaderWheel}
        onTouchStart={onReaderGesture}
        onPointerDown={onReaderGesture}
      >
        {children}
      </ol>
    </>
  );
}
