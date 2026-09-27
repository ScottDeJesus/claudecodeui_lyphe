import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { DeckItemContext } from '@/modules/dispatcher/context/DeckItemContext';
import { DeckStrip } from '@/modules/dispatcher/DeckStrip';
import { useRiseOnce } from '@/modules/dispatcher/hooks/useFirstSight';
import { StatusFlow } from '@/modules/dispatcher/StatusFlow';
import { LANE_WALL_GRID } from '@/shared/constants';
import { useCardFold } from '@/shared/hooks/useCardFold';
import type { LaneFlow } from '@/shared/types';
import { CardFoldBody, Collapsible } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * ONE dispatch arc, drawn in the lane card's ONE anatomy — the plan card's too: the head
 * (`LaneCardHead`, handed in whole as `head`), the action bar directly under it (`bodyTop`), the arc's
 * flow of plans (`StatusFlow`, one node a plan), and then every card of the arc, in the arc's own
 * order — past, present, future, which is the walk's own order.
 *
 * TWO LAYOUTS, ONE PER HOME (`layout`):
 * - `grid`, the Runner tab's: the cards sit in the wall's auto-fill grid (`LANE_WALL_GRID`),
 *   row-major, every card whole and at its own height. The tab has the width, and the glance face
 *   makes the cards short and alike, so the whole arc is read at once rather than paged through.
 * - `strip`, the chat gutter's: one card per view, paged (`DeckStrip`, whose own rules are there).
 *
 * THE FLOW IS THE ARC AT A GLANCE AND THE WAY INTO IT. In a grid, pressing a node brings that plan's
 * card into view (`block: 'nearest'`, so a card already on screen does not move) and rings it once
 * (`ring-once`, cleared on its own `animationend`), so the eye finds where the press landed; the node
 * stays selected as the last card jumped to. In a strip the flow pages the strip instead.
 *
 * THE HEAD SAYS EVERYTHING BUT THE PLANS: the arc's door and word, its armed hour, how many of its
 * plans are complete (`done/total`), its goal and planner, its books as pills, and the corner — `⋯`,
 * Hide and the fold.
 *
 * A FOLD KEEPS THE HEAD AND TAKES THE BODY (MAN-5412). What stays is every row of the head, so a
 * reader who folded three decks away still knows which is stalled, which is complete, how far each has
 * got and what each has cost. The body goes: the action bar (the model switch, Start, Pause, Schedule
 * start — VERBS, the same layer a plan card's own bar folds, so the two cannot disagree about what
 * "collapsed" means), the flow and the cards. Measured on an arc deck, 2026-09-25: keeping Start
 * and the model switch above the fold made a folded unstarted deck 164px against 86px for a started
 * one — a "collapsed" row that had not collapsed.
 *
 * THE FOLD IS THE HOUSE'S OWN BODY SLOT, NEVER THE RAW CLIP (`CardFoldBody`, never
 * `CollapsibleContent`): a clip hides a body but leaves its controls in the tab order and in the
 * accessibility tree — on a folded lane card that is every verb of the arc, a keyboard press away and
 * never on screen, and a fold is remembered per card so it survives reloads.
 *
 * IT RISES ONCE: `motion-safe:animate-shape-rise` on the first mount this page session draws
 * `foldKey`, claimed by the copy whose rise actually PLAYS and gone from the root when it ends
 * (`useRiseOnce`) — never again on a remount, a poll, the Chat tab shown again over a gutter it had
 * hidden, or the other home's copy of a deck that arrived while both were mounted.
 *
 * `data-arc-header`, `data-arc-grid`, `data-deck-layout` and `data-collapsed` are the browser
 * harness's handles (the strip's are `DeckStrip`'s), on the nodes that carry them rather than on the
 * caller's own wrapper, so a reading is always taken from the deck rather than from a lane's wrapper.
 *
 * Used by `DispatchArcDeck` — the only arc deck there is.
 */
export function DeckFrame({
  rootAttributes,
  status,
  head,
  foldKey,
  flow,
  bodyTop = null,
  layout,
  stripLabel,
  focusIndex,
  cardCount,
  children,
}: {
  /** The caller's own handles on the deck's root — `data-dispatch-arc` and `data-arc-name`. Written here rather than by the caller so `data-collapsed` and the cards below it cannot end up on two different nodes. */
  rootAttributes: Record<string, string>;
  /** The arc's status, as the store's own snapshot spells it — read back by a probe off the root. */
  status: string;
  /** The deck's head: a `LaneCardHead`, drawn inside the fold's `Collapsible` and outside its body, so a fold keeps it. */
  head: ReactNode;
  /** The card's key in the shared fold store (`darc:<name>`), so one home folds what the other folds — and the key its one rise is remembered by. */
  foldKey: string;
  /** The arc's plans as a track, one node per card and in the cards' order; a node's `key` is its item's `itemKey`. */
  flow: LaneFlow;
  /** The arc's `ActionBar`: the body's first row, so the fold takes it with the cards. */
  bodyTop?: ReactNode;
  /** `grid` in the Runner tab (the wall), `strip` in the chat gutter (one card per view). */
  layout: 'grid' | 'strip';
  /** What a screen reader hears for the list of cards, in either layout. */
  stripLabel: string;
  /** The card the strip opens on, and returns to when the arc moves. A grid shows every card and needs none. */
  focusIndex: number;
  /** How many cards the deck holds — the strip's arrows' own count. */
  cardCount: number;
  /** The deck's items — one `DeckItem` per card, in the arc's own order. */
  children: ReactNode;
}) {
  const { collapsed, toggle } = useCardFold(foldKey);
  const rise = useRiseOnce(foldKey);
  const gridRef = useRef<HTMLOListElement>(null);
  // The card the reader last jumped to from the flow — the grid's selected node, kept after its ring
  // ends so the flow still says which card was asked for. A strip's selection is its view instead.
  const [jumped, setJumped] = useState<string | null>(null);
  // The card whose one ring is playing, set by a jump and cleared on that ring's own `animationend`.
  const [ringing, setRinging] = useState<string | null>(null);

  const endRing = useCallback((key: string) => setRinging((current) => (current === key ? null : current)), []);
  const items = useMemo(() => ({ layout, ringing: layout === 'grid' ? ringing : null, endRing }), [layout, ringing, endRing]);

  /** A grid node's press: the card into view, nearest edge, and rung once. */
  const jump = (key: string) => {
    const item = gridRef.current?.querySelector<HTMLElement>(`[data-deck-item="${CSS.escape(key)}"]`);
    if (!item) return;
    setJumped(key);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    item.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    // The keyboard lands where the eye does: a node pressed far down the arc scrolls the flow away,
    // and a reader left focused up there would have to Tab through every card before this one.
    item.focus({ preventScroll: true });
    // A reader who asked for less motion gets the jump and no ring: the class would be inert under
    // `motion-safe:`, and one left set with no `animationend` to clear it would play later.
    if (still) return;
    // A second press while that card's ring still plays starts it over rather than leaving it to
    // finish: the class is already on, so re-adding it would restart nothing.
    if (ringing === key) {
      for (const animation of item.getAnimations()) animation.currentTime = 0;
    } else {
      setRinging(key);
    }
  };

  return (
    <section
      {...rootAttributes}
      data-arc-status={status}
      data-deck-layout={layout}
      data-collapsed={String(collapsed)}
      className={cn('flex w-full min-w-0 flex-col rounded-lg border border-border bg-muted/40 px-3 pt-3', rise.className)}
      onAnimationStart={rise.onAnimationStart}
      onAnimationEnd={rise.onAnimationEnd}
    >
      <Collapsible open={!collapsed} onOpenChange={toggle} className="flex w-full min-w-0 flex-col">
        {/* The head's own bottom padding is the gap under it: outside the fold's clip, so it is the
            gap to the body while the deck is open and the deck's own bottom padding once it folds —
            which is why the root carries none at the bottom. */}
        <header data-arc-header className="min-w-0 pb-3">{head}</header>

        {/* THE CLIP SPANS THE DECK'S PADDING (`-mx-3`, given back as the body's `px-3`, so the content
            box is unchanged): `CardFoldBody` clips its body with `overflow-hidden`, and a grid flush
            against that clip cut a jumped-to card's halo (`ring-once`, a 9px `box-shadow`) flat on
            every outer side — the left of column one, the right of the last column, both sides of
            every card on a phone. The bottom's room is the body's `pb-3`, INSIDE the clip, never a
            negative margin: a folded deck keeps the head's padding under it. */}
        <CardFoldBody className="-mx-3">
          {/* The body's spacing lives on this wrapper, never on `CardFoldBody`: that slot is a GRID
              whose row goes 1fr → 0fr, so a `flex`/`gap` passed to it would be overridden by its own
              `grid` and the gap between these rows would silently go. `data-arc-deck-body` is where a
              probe reads the fold: while the card is closed this subtree is `inert` and
              `aria-hidden`. */}
          <div data-arc-deck-body className="flex min-w-0 flex-col gap-3 px-3 pb-3">
            {bodyTop}
            <DeckItemContext.Provider value={items}>
              {layout === 'strip' ? (
                <DeckStrip flow={flow} stripLabel={stripLabel} focusIndex={focusIndex} cardCount={cardCount}>
                  {children}
                </DeckStrip>
              ) : (
                <>
                  <StatusFlow
                    nodes={flow.nodes}
                    doneCount={flow.doneCount}
                    selected={jumped}
                    onSelect={jump}
                    ariaLabel={flow.ariaLabel}
                  />
                  <ol ref={gridRef} data-arc-grid aria-label={stripLabel} className={cn('min-w-0', LANE_WALL_GRID)}>
                    {children}
                  </ol>
                </>
              )}
            </DeckItemContext.Provider>
          </div>
        </CardFoldBody>
      </Collapsible>
    </section>
  );
}

/**
 * One card's slot in the deck, its size set in ONE place so a deck cannot have items of two sizes:
 * in a grid it is its cell, in a strip exactly the strip's width, so one whole card is in view and
 * the arrows and the snap page one card at a time. The item's own handles (`data-dispatch-plan-row`,
 * `data-arc-layer`) ride the same node through `attributes`; `itemKey` is the flow node's key that
 * reaches it (`data-deck-item`).
 *
 * THE RING IS THE ITEM'S OWN: `motion-safe:animate-ring-once` while the frame names it `ringing`,
 * rounded to the card's own corner so the halo follows the card, and gone on its own `animationend`
 * — filtered to this node and to `vv-ring`, so a live node breathing inside the card never ends it.
 * `scroll-my-4` keeps a card jumped to off the pane's very edge, with room for the halo. In a grid the
 * item is `tabIndex={-1}`: not a Tab stop, but where a jump puts the keyboard (`DeckFrame`'s `jump`).
 *
 * Used by `DispatchArcDeck`, one per plan of the arc.
 */
export function DeckItem({ itemKey, className, ...attributes }: { itemKey: string } & HTMLAttributes<HTMLLIElement>) {
  const { layout, ringing, endRing } = useContext(DeckItemContext);
  return (
    <li
      {...attributes}
      data-deck-item={itemKey}
      tabIndex={layout === 'grid' ? -1 : undefined}
      className={cn(
        layout === 'strip' ? 'w-full flex-none snap-center' : 'min-w-0 scroll-my-4',
        'rounded-xl',
        ringing === itemKey && 'motion-safe:animate-ring-once',
        className,
      )}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === 'vv-ring') endRing(itemKey);
      }}
    />
  );
}
