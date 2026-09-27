import type { HTMLAttributes, ReactNode } from 'react';

import { DeckStrip } from '@/modules/dispatcher/DeckStrip';
import { useRiseOnce } from '@/modules/dispatcher/hooks/useFirstSight';
import { useCardFold } from '@/shared/hooks/useCardFold';
import type { LaneFlow } from '@/shared/types';
import { CardFoldBody, Collapsible } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * ONE dispatch arc, drawn in the lane card's ONE anatomy — the plan card's too: the head
 * (`LaneCardHead`, handed in whole as `head`), the action bar directly under it (`bodyTop`), the arc's
 * flow of plans (`StatusFlow`, one node a plan) and then the cards of the arc, in the arc's own order
 * — past, present, future, which is the walk's own order.
 *
 * THE CARDS ARE A STRIP, IN BOTH HOMES (`DeckStrip`, whose own rules are there): one card per view,
 * moved by its arrows, by a swipe or a trackpad through CSS scroll snap, by Left/Right on the focused
 * strip, and by a press on any node of the flow. AN ARC'S PLANS ARE SWIPED, NOT WALLED, in the Runner
 * tab as in the chat gutter — operator, 2026-09-26: "Can you please bring back the swipable plan
 * cards if it's under an arc, a new plan changed it and I think it's poor design" — and only the
 * plans NO arc holds keep the tab's wall (`RunnerPanel`).
 *
 * THE FLOW IS THE ARC AT A GLANCE AND THE WAY INTO IT: one node a plan, the node of the card in view
 * selected, and a press pages the strip straight to that card (`goTo`), a smooth centring scroll,
 * however far along the arc it is.
 *
 * THE HEAD SAYS EVERYTHING BUT THE PLANS: the arc's door and word, its armed hour, how many of its
 * plans are complete (`done/total`), its goal and planner, its books as pills, and the corner — `⋯`,
 * Hide and the fold.
 *
 * A FOLD KEEPS THE HEAD AND TAKES THE BODY (MAN-5412). What stays is every row of the head, so a
 * reader who folded three decks away still knows which is stalled, which is complete, how far each has
 * got and what each has cost. The body goes: the action bar (the model switch, Start, Pause, Schedule
 * start — VERBS, the same layer a plan card's own bar folds, so the two cannot disagree about what
 * "collapsed" means), the flow and the strip. Measured on an arc deck, 2026-09-25: keeping Start
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
 * `data-arc-header` and `data-collapsed` are the browser harness's handles (the strip's are
 * `DeckStrip`'s), on the nodes that carry them rather than on the caller's own wrapper, so a reading is
 * always taken from the deck rather than from a lane's wrapper.
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
  /** The arc's plans as a track, one node per card and in the cards' order; a node's `key` names the plan its card holds. */
  flow: LaneFlow;
  /** The arc's `ActionBar`: the body's first row, so the fold takes it with the cards. */
  bodyTop?: ReactNode;
  /** What a screen reader hears for the strip of cards. */
  stripLabel: string;
  /** The card the strip opens on, and returns to when the arc moves. */
  focusIndex: number;
  /** How many cards the strip holds — the arrows' own count. */
  cardCount: number;
  /** The deck's items — one `DeckItem` per card, in the arc's own order. */
  children: ReactNode;
}) {
  const { collapsed, toggle } = useCardFold(foldKey);
  const rise = useRiseOnce(foldKey);

  return (
    <section
      {...rootAttributes}
      data-arc-status={status}
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
        <CardFoldBody>
          {/* The body's spacing lives on this wrapper, never on `CardFoldBody`: that slot is a GRID
              whose row goes 1fr → 0fr, so a `flex`/`gap` passed to it would be overridden by its own
              `grid` and the gap between these rows would silently go. `data-arc-deck-body` is where a
              probe reads the fold: while the card is closed this subtree is `inert` and
              `aria-hidden`. */}
          <div data-arc-deck-body className="flex min-w-0 flex-col gap-3 pb-3">
            {bodyTop}
            <DeckStrip flow={flow} stripLabel={stripLabel} focusIndex={focusIndex} cardCount={cardCount}>
              {children}
            </DeckStrip>
          </div>
        </CardFoldBody>
      </Collapsible>
    </section>
  );
}

/**
 * One card's slot in the deck, its size set in ONE place so a deck cannot have items of two sizes:
 * EXACTLY the strip's width, so one whole card is in view at a time and the snap and the arrows page
 * one card per press. That is the whole of the sidebar-peek's cure (operator, 2026-09-26: "Do not
 * bring back the side-by-side peek that clipped a taller neighbour" — a narrower item showed a sliver
 * of the next card and cut it at the strip's edge wherever it ran taller than the reader's). The
 * item's own handles (`data-dispatch-plan-row`, `data-arc-layer`) ride the same node through
 * `attributes`.
 *
 * Used by `DispatchArcDeck`, one per plan of the arc.
 */
export function DeckItem({ className, ...attributes }: HTMLAttributes<HTMLLIElement>) {
  return <li {...attributes} className={cn('w-full flex-none snap-center rounded-xl', className)} />;
}
