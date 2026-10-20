import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import type { useSnapStrip } from '@/modules/dispatcher/hooks/useSnapStrip';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * THE ONE STRIP SHAPE — a nav row over a horizontal snap strip, one item per view. An arc deck's plans
 * and a round's questions are paged by this and nothing else, so a reader who has swiped one has
 * swiped the other and no snap, key or height rule exists twice. What it draws is the part a map
 * above it does not: the caller draws its own map (an arc's flow of plans, a round's flow of
 * questions) as the strip's SIBLING, calls `useSnapStrip` for the position it reads and presses
 * (`view.index`, `goTo`), and hands the same hook result here.
 *
 * THE NAV ROW IS THE STRIP'S, SO IT SITS ON THE STRIP: over the items it moves — the arrows at either
 * end, the caller's `N of M` line between them. It is drawn only when there is more than one item to
 * move to.
 *
 * THE STRIP MOVES THREE WAYS: a swipe or a trackpad (CSS scroll snap, no script), the arrows (one item
 * each, disabled at their end), and Left/Right — AND ONLY A KEYSTROKE MADE INSIDE THE STRIP COUNTS,
 * and not one made in a text control (`useSnapStrip`'s `onKeyDown`). A press while the strip is still
 * travelling towards an earlier ask is one item on FROM THAT ASK, not from wherever the animation had
 * got (`useSnapStrip`'s `intended`).
 *
 * Every item is exactly the strip's width (`SnapStripItem`), so ONE item is in view and the snap pages
 * one item per press: never the side-by-side peek, where a narrower item showed a sliver of its
 * neighbour and cut it at the strip's edge wherever it ran taller than the reader's. Each item is as
 * tall as its OWN content: the strip is a row of flex items and would wear the tallest item's height
 * under every shorter one, so its height is set instead to the item the reader is on (`useSnapStrip`
 * measures it) and the strip grows and shrinks as it is paged, swiped or keyed past.
 *
 * `handle` names the browser harness's handles — `data-<handle>-strip`, `-viewing`, `-prev`, `-next` —
 * so two strips on one screen (an arc's, and a round standing above it in the deck's asks slot) are
 * read apart: a probe that looks for the arc's strip inside a deck must never find the round's.
 *
 * Used by `DeckStrip`, as the body of every arc deck, and by `RoundAnswer`, as the pages of a round's
 * questions.
 */
export function SnapStrip({
  strip,
  handle,
  stripLabel,
  itemCount,
  previousLabel,
  nextLabel,
  viewingLabel,
  children,
}: {
  /** The strip's position and its three ways of moving, from the caller's own `useSnapStrip` — the caller keeps it because its map needs `view.index` and `goTo` too. */
  strip: ReturnType<typeof useSnapStrip>;
  /** The harness handle family: `arc` for an arc deck's strip, `ask` for a round's. */
  handle: 'arc' | 'ask';
  /** What a screen reader hears for the strip. */
  stripLabel: string;
  /** How many items the strip holds — whether there is anything to move to at all. */
  itemCount: number;
  /** The previous arrow's accessible name. */
  previousLabel: string;
  /** The next arrow's accessible name. */
  nextLabel: string;
  /** The line between the arrows: which item is in view, already counted (`Card 2 of 5`). */
  viewingLabel: string;
  /** The strip's items — one `SnapStripItem` each, in the caller's order, which is its map's order too. */
  children: ReactNode;
}) {
  const { stripRef, view, step, onScroll, onKeyDown, onReaderGesture, onReaderWheel, stripHeight } = strip;
  const movable = itemCount > 1;
  // The handles ride the nodes as bare attributes (`data-arc-strip=""`), spelt once from the family.
  const handleOf = (part: 'strip' | 'viewing' | 'prev' | 'next') => ({ [`data-${handle}-${part}`]: '' });

  return (
    <>
      {movable && (
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={previousLabel}
            disabled={view.atStart}
            onClick={() => step(-1)}
            {...handleOf('prev')}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="min-w-0 flex-1 text-center text-xs tabular-nums text-muted-foreground" {...handleOf('viewing')}>
            {viewingLabel}
          </p>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={nextLabel}
            disabled={view.atEnd}
            onClick={() => step(1)}
            {...handleOf('next')}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
      {/* `relative` makes the strip its items' offset parent, which centring reads. `tabIndex` lets
          the keyboard's Left/Right move it once focused. `overflow-y-hidden` beside `overflow-x-auto`:
          alone, `overflow-x: auto` computes `overflow-y` to `auto`, and anything absolutely placed
          below the row would turn the strip into a vertical scroller that eats the page's wheel.
          `overflow-y-hidden` keeps that wheel, but it does not stop the box being scrolled AS A BOX —
          a focus move still shifted it, cutting the top of the reader's own item. `useSnapStrip`
          pins the strip's vertical offset at 0 on every scroll, so neither can move it.

          `items-start` BESIDE A MEASURED HEIGHT IS THE WHOLE CURE for the empty space: the row
          stretches its items by default, so the tallest item of a strip used to write its height
          under every shorter one (measured on the docstore deck, 2026-09-25: 260px of nothing
          under a three-line card). With the items at their own heights and the strip at the
          reader's item's, the strip is exactly as tall as what it shows — and the items it is not
          showing keep their own heights, so paging to one grows the strip to it. The height is
          animated on the fold's own curve so the growth is seen rather than jumped. With one item
          per view, the item in view is the only item whole on screen, and it is always whole.

          `onReaderGesture` / `onReaderWheel` are the strip listening to the reader's own hands: a
          swipe, a drag or a trackpad's horizontal wheel drops an ask that is still travelling, so the
          next press is measured from what the reader scrolls to (see `useSnapStrip`). */}
      <ol
        ref={stripRef}
        tabIndex={0}
        aria-label={stripLabel}
        style={stripHeight === null ? undefined : { height: stripHeight }}
        className="scrollbar-hide relative flex min-w-0 snap-x snap-mandatory items-start gap-3 overflow-x-auto overflow-y-hidden rounded-lg transition-[height] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onWheel={onReaderWheel}
        onTouchStart={onReaderGesture}
        onPointerDown={onReaderGesture}
        {...handleOf('strip')}
      >
        {children}
      </ol>
    </>
  );
}

/**
 * One item's slot in the strip, its size set in ONE place so a strip cannot have items of two sizes:
 * EXACTLY the strip's width, so one whole item is in view at a time and the snap and the arrows page
 * one item per press. That is the whole of the sidebar-peek's cure (operator, 2026-09-26: "Do not
 * bring back the side-by-side peek that clipped a taller neighbour" — a narrower item showed a sliver
 * of the next card and cut it at the strip's edge wherever it ran taller than the reader's). The
 * item's own handles (`data-dispatch-plan-row`, `data-ask-question`) ride the same node through
 * `attributes`.
 *
 * Used by `DispatchArcDeck`, one per plan of the arc, and by `RoundAnswer`, one per question.
 */
export function SnapStripItem({ className, ...attributes }: HTMLAttributes<HTMLLIElement>) {
  return <li {...attributes} className={cn('w-full flex-none snap-center rounded-xl', className)} />;
}
