import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeckStrip } from '@/modules/dispatcher/hooks/useDeckStrip';
import { useCardFold } from '@/shared/hooks/useCardFold';
import type { Tone } from '@/shared/types';
import { Badge, Button, CardFoldBody, CardFoldToggle, Collapsible } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * ONE dispatch arc, drawn as a gallery: a header that says which arc this is and how far it has
 * walked, and beneath it every card of the arc in ONE horizontal strip, in the arc's own order —
 * past, present, future reading left to right, which is the walk's own order.
 *
 * THE STRIP MOVES THREE WAYS: a swipe or a trackpad (CSS scroll snap, no script), the arrows at
 * either end of the nav row (one card each, disabled at their end), and Left/Right on the focused
 * strip. The focused card is centred on mount and again whenever `focusIndex` changes — the arc's
 * first plan that still has a walk in front of it (`deckFocusIndex`). One card: no arrows, nothing to
 * move to.
 *
 * Every card is one fixed width (18rem, never wider than the strip) and as tall as its OWN content:
 * the strip is a row of flex items and would wear the tallest card's height under every shorter one,
 * so its height is set instead to the card the reader is on (`useDeckStrip` measures it) and the deck
 * grows and shrinks as the strip is paged, swiped or keyed past. `DeckItem`'s `cardFillsStrip` is the
 * gutter home's width instead: every card exactly the strip's width, so one whole card is in view and
 * the arrows and the snap page one card at a time.
 *
 * A FOLD LEAVES THE HEADER ROW, AND NOTHING ELSE. What stays is the arc's name, its word and how far
 * it has walked — so a reader who folded three decks away still knows which of them is stalled, which
 * is complete and how far each has got. The STRIP goes, the two arrows go with it (they are the
 * strip's controls and there is nothing for them to move), and so does everything the lane put in
 * `bodyTop`: the model switch, Start, Stop, Resume — VERBS, the same layer a plan card's own controls
 * fold, so the implements cannot disagree about what "collapsed" means. Measured on an arc deck,
 * 2026-09-25: keeping Start and the model switch in the header made a folded unstarted deck 164px
 * against 86px for a started one — a "collapsed" row that had not collapsed.
 *
 * THE FOLD IS THE HOUSE'S OWN BODY SLOT, NEVER THE RAW CLIP (`CardFoldBody`, never
 * `CollapsibleContent`): a clip hides a body but leaves its controls in the tab order and in the
 * accessibility tree — on a folded lane card that is every verb of the arc, a keyboard press away and
 * never on screen, and a fold is remembered per card so it survives reloads.
 *
 * `data-arc-strip`, `data-arc-viewing` and `data-collapsed` are the browser harness's handles, on the
 * nodes that carry them rather than on the caller's own wrapper, so a reading is always taken from the
 * deck rather than from a lane's wrapper around it.
 *
 * Used by `DispatchArcDeck` — the only arc deck there is.
 */
export function DeckFrame({
  rootAttributes,
  status,
  title,
  badge,
  foldKey,
  subtitle = null,
  titleTail = null,
  note,
  bodyTop = null,
  stripLabel,
  focusIndex,
  cardCount,
  children,
}: {
  /** The caller's own handles on the deck's root — `data-dispatch-arc` and `data-arc-name`. Written here rather than by the caller so `data-collapsed` and the strip below it cannot end up on two different nodes. */
  rootAttributes: Record<string, string>;
  /** The arc's status, as the store's own snapshot spells it — read back by a probe off the root. */
  status: string;
  /** The deck's own name, as the lane spells it: the dispatcher's `<name>.arc`. */
  title: ReactNode;
  /** The word this arc wears and the tone it takes, from the lane's own table. */
  badge: { key: string; tone: Tone };
  /** The card's key in the shared fold store (`darc:<name>`), so one home folds what the other folds. */
  foldKey: string;
  /** The lane's own lines under the title row — the planner badge and the goal the arc's designer wrote. */
  subtitle?: ReactNode;
  /** Drawn beside the title, past the badge: the arc's spend figure. */
  titleTail?: ReactNode;
  /** The line between the arrows — how far the arc has walked. The "card N of M" of the strip is added here, when there is a strip to move. */
  note: ReactNode;
  /** The arc's verbs and model switch: the body's first row, so the fold takes them with the strip. */
  bodyTop?: ReactNode;
  /** What a screen reader hears for the strip. */
  stripLabel: string;
  /** The card the strip opens on, and returns to when the arc moves. */
  focusIndex: number;
  /** How many cards the strip holds — the arrows' own count. */
  cardCount: number;
  /** The strip's items — one `DeckItem` per card, in the arc's own order. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { collapsed, toggle } = useCardFold(foldKey);
  const { stripRef, view, step, onScroll, onKeyDown, stripHeight } = useDeckStrip(Math.max(focusIndex, 0), cardCount);
  const movable = cardCount > 1;

  return (
    <section
      {...rootAttributes}
      data-arc-status={status}
      data-collapsed={String(collapsed)}
      className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <Collapsible open={!collapsed} onOpenChange={toggle} className="flex w-full min-w-0 flex-col gap-3">
        <header data-arc-header className="flex min-w-0 flex-col gap-1">
          {/* The row a reader keeps whatever he has folded away: WHICH arc this is.

              THE ROW WRAPS AND THE TITLE HAS A FLOOR, AND BOTH ARE NEEDED — each alone still crushes
              the name. The lane's tail (the dispatcher's spend line), the status badge and the fold
              toggle are all things that must not give, so the title is the only item left that CAN:
              it carries `flex-1`, and `min-w-0` released it even from its own content, so a 101px
              name in a 332px row beside a 245px spend line and a badge simply collapsed — one letter
              per line in a zero-width box (measured 12 lines), with the row's last 23px (the fold's
              own control) spilled past the card's right edge. That is the phone screenshot
              (2026-09-25, `/tmp/chains/arc-header-phone.jpg`). `min-w-fit` is the floor that ends it:
              never narrower than its own longest word, so the title reads on one line, or wraps BY
              WORD — and it is the title's own floor, not a shrink, that then hands the spend line a
              line of its own on a narrow screen. `flex-wrap` is the other half: a floor without a
              wrap would push the badge and the toggle off the card instead of under it.

              THE FLOOR HAS ONE BOUND, MEASURED RATHER THAN ASSUMED: `fit-content` is
              `min(max-content, max(min-content, available))` — capped by the room the row can give —
              and `break-words` (`overflow-wrap: break-word`) does NOT lower a word's intrinsic
              min-content. So a title that is ONE token with no space and no hyphen anywhere in it,
              wider than the row, neither wraps nor shrinks: the name leaves the card (measured at
              390px with a 74-character token — one 622px line in a 332px row, 278px past the deck's
              right edge, the page itself not scrolling because its ancestors clip it). No name the
              corpus holds reaches that: its longest unbroken segment is 19 characters against a 242px
              narrowest row. It is still strictly better than HEAD there, which crushed the same token
              into a 25px column of 37 stacked letters — and the row's own `scrollWidth` against its
              `clientWidth` is the reading that catches it, which `.verify/probe-arc-header-fit.mjs`
              checks (its payloads are the lane's live arcs, so that edge is not among them).

              THE FLOOR IS CONTENT-DRIVEN AND NOT A BREAKPOINT: these decks are drawn in the tab (a
              `max-w-2xl` column) and in the chat gutter (~380px even on a 1440px screen), so `sm:`
              would put one home's deck on the other home's branch. */}
          <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
            <h4 className="min-w-fit flex-1 break-words text-sm font-medium leading-snug">{title}</h4>
            {titleTail}
            <Badge tone={badge.tone} className="shrink-0">{t(badge.key)}</Badge>
            <CardFoldToggle />
          </div>          {subtitle}
          <div className="flex min-w-0 items-center gap-2">
            {movable && !collapsed && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t('runner.arcPrevious')}
                disabled={view.atStart}
                onClick={() => step(-1)}
                data-arc-prev
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
            )}
            <p className="min-w-0 flex-1 text-center text-xs text-muted-foreground" data-arc-viewing>
              {movable && !collapsed && `${t('runner.arcViewing', { n: view.index + 1, total: cardCount })} · `}
              {note}
            </p>
            {movable && !collapsed && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t('runner.arcNextCard')}
                disabled={view.atEnd}
                onClick={() => step(1)}
                data-arc-next
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </header>

        <CardFoldBody>
          {/* The body's spacing lives on this wrapper, never on `CardFoldBody`: that slot is a GRID
              whose row goes 1fr → 0fr, so a `flex`/`gap` passed to it would be overridden by its own
              `grid` and the gap between these rows would silently go. `data-arc-deck-body` is where a
              probe reads the fold: while the card is closed this subtree is `inert` and
              `aria-hidden`. */}
          <div data-arc-deck-body className="flex min-w-0 flex-col gap-3">
            {bodyTop}
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
                animated on the fold's own curve so the growth is seen rather than jumped.

                THE PRICE, MEASURED AND DELIBERATE: a card that is taller than the reader's and fully in
                view beside it is cut at the strip's edge (2026-09-25: on the dispatch arc at 1440, a
                1680px neighbour of a 1002px reader showed 288px of its own width and was cut by 678px).
                The alternative — the strip wearing the tallest card IN VIEW — was rejected: it puts that
                same 678px of nothing back under the card being read, which is the empty space this whole
                change exists to remove. Only the shown card is ever whole, and a card is whole the moment
                it is paged to. A second card's width on a wide screen, or a fade at the cut, would cure
                it and both are design calls for the operator. */}
            <ol
              ref={stripRef}
              data-arc-strip
              tabIndex={0}
              aria-label={stripLabel}
              style={stripHeight === null ? undefined : { height: stripHeight }}
              className="scrollbar-hide relative flex min-w-0 snap-x snap-mandatory items-start gap-3 overflow-x-auto overflow-y-hidden rounded-lg transition-[height] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onScroll={onScroll}
              onKeyDown={onKeyDown}
            >
              {children}
            </ol>
          </div>
        </CardFoldBody>
      </Collapsible>
    </section>
  );
}

/**
 * One card's slot in the strip: the width every card takes, in ONE place, so a deck cannot have
 * items of two widths. The item's own handles (`data-dispatch-plan-row`, `data-arc-layer`) ride the
 * same node through `attributes`.
 */
export function DeckItem({ cardFillsStrip = false, className, ...attributes }: { cardFillsStrip?: boolean } & HTMLAttributes<HTMLLIElement>) {
  return (
    <li
      {...attributes}
      className={cn('flex-none snap-center', cardFillsStrip ? 'w-full' : 'w-72 max-w-full', className)}
    />
  );
}
