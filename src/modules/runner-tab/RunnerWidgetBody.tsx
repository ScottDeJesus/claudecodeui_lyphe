import { ActivityIcon } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  byArc,
  DispatchArcDecks,
  doneDismiss,
  HiddenPlans,
  landFocusInHome,
  LoosePlannerBadges,
  moveCard,
  PlanCard,
  PlannerLanesReadout,
  planPutAway,
  SessionPin,
  useCardRanks,
  useDispatcherPlans,
} from '@/modules/dispatcher';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import { LANE_CARD_GAP } from '@/shared/constants';
import type { DispatcherPlan, LaneCard } from '@/shared/types';
import { Button, EmptyState } from '@/shared/ui';
import { useSortable } from '@/shared/ui/sortable/useSortable';
import { cn } from '@/shared/utils';

/** A card's name — the plan's or the arc's, which never collide: the key the card is ranked, saved and carried by. */
function cardName(card: LaneCard): string {
  return rankedOf(card).name;
}

/** The card as the order sees it: its name and creation, which a plan and an arc both carry. */
function rankedOf(card: LaneCard) {
  return card.kind === 'arc' ? card.group.arc : card.plan;
}

/** A card's identity across polls — `darc:` beside `plan:`, so an arc and a plan never share one. */
function itemKey(card: LaneCard): string {
  return card.kind === 'arc' ? `darc:${card.group.arc.name}` : `plan:${card.plan.name}`;
}

/** Whether the open chat is the one that opened `plan`. */
function openedBy(plan: DispatcherPlan, sessionId: string | null): boolean {
  return sessionId !== null && plan.session_app_id === sessionId;
}

/**
 * The dispatcher's lane as the desktop chat gutter draws it: ONE vertical list of every top-level item
 * the lane carries — each arc as its deck, each plan of no arc as its card — in the operator's order.
 *
 * THE SECOND HOME, BESIDE THE TRANSCRIPT AND NEVER OVER IT. The Roadmap tab's In flight face is the card's other home and
 * lays the loose cards out as a wall; here the column is the gutter's own width, one card wide, so the
 * same items stand one under another at the tab's own spacing — two cards `LANE_CARD_GAP` apart, a deck
 * 24px from its neighbours — and the widget frame's body scrolls them (`src/modules/chat-gutters`).
 * Every item is drawn whole and at once (operator, 2026-09-28: "please remove the arrows and show a
 * list of plans instead").
 *
 * THE ITEMS ARE THE TAB'S SPLIT AND THE TAB'S ORDER (`byArc`'s `cards`): decks and plans interleaved
 * where the operator put them, and nowhere else — a plan that asks keeps its place, and so does the
 * plan the open chat opened, which wears this chat's `SessionPin` where it stands. Which chat is open
 * moves no card, and a chat switch moves no scroll. An arc is the SAME deck the tab draws
 * (`DispatchArcDecks`' `home="gutter"`), its plans still swiped one card per view in its own strip; a
 * plan of no arc is its `PlanCard`.
 *
 * THE COLUMN IS ONE SORTABLE LIST: any item, deck or plan, is carried by a free press and put down
 * between any two others, and the drop writes one rank (`moveCard`) that the tab reads as well.
 *
 * THE FOLDS ARE THE TAB'S FOLDS, AND THIS BODY PRUNES THE SAME MEMORY. `useLaneFoldPrune` hands the
 * fold store what this widget draws AND what it has hidden, so a card folded here is folded on the tab,
 * a card shown again keeps its fold, and the folds of cards that have left the lane go with them — one
 * memory, two homes.
 *
 * `Dismiss done · N` heads the list (every drawn plan that is done, off the board in one write — the
 * tab header's own button) and `Hidden · N` closes it as the way back from any Hide. `data-runner-widget`
 * is the root's handle — this home's boundary, which a card's corner press looks inside for the next
 * place to put the keyboard (`LaneCardHead`), exactly as it looks inside `data-runner-panel`.
 * `data-widget-item` (valued by the item's key), `runner-widget-plan`, `data-plan-name` and
 * `data-pinned` are the browser harness's handles.
 *
 * IT READS THE BUS, HOLDS NO STATE OF ITS OWN BUT A CARRY'S PREVIEW AND DRAWS NO FRAME.
 * `useDispatcherPlans` hands it the retained picture, so it paints on its first render; the chrome,
 * the slots and the scrolling belong to `src/modules/chat-gutters`.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), as the Runs widget's body.
 */
export function RunnerWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { plans, hidden, arcs, loosePlanners, carriedNames } = useDispatcherPlans();
  // The lane split once, by the one rule both homes read, in the operator's order.
  const ranks = useCardRanks();
  const split = useMemo(() => byArc(plans, arcs, ranks), [plans, arcs, ranks]);
  const cards = split.cards;
  const cardsByName = useMemo(() => new Map(cards.map((card) => [cardName(card), card])), [cards]);
  const keys = useMemo(() => cards.map(cardName), [cards]);
  const { order, attachList, itemProps } = useSortable({
    keys,
    // The carried item's neighbours in the dropped order are cards of either kind: both are ranked.
    onReorder: (carried, order) => moveCard(carried, order, cards.map(rankedOf), carriedNames),
  });
  const items = order.flatMap((name) => cardsByName.get(name) ?? []);
  useLaneFoldPrune(plans, hidden, arcs);
  const done = doneDismiss(plans, carriedNames);
  // The widget's root: where `Dismiss done · N` hands the keyboard on once the button has left with its
  // count. One element in both branches below, so a press that emptied the lane still finds it.
  const widgetRef = useRef<HTMLDivElement>(null);

  // `Dismiss done · N` takes itself away (nothing done is left to dismiss), so a keyboard reader who
  // pressed it would land on `<body>`. On the next frame, once the write has re-rendered the widget,
  // focus goes where `landFocusInHome` finds — the tab header's own hand-off (`RunnerPanel`).
  const dismissDone = (dismiss: () => void) => {
    dismiss();
    requestAnimationFrame(() => {
      if (widgetRef.current !== null) landFocusInHome(widgetRef.current);
    });
  };

  // The empty state speaks of the LANE: a planner outing with no card at all is on this lane too — a
  // soul out on an arc the store has no row for yet — even though nothing here can draw it an item.
  // Over hidden plans the words say "hidden", never "nothing is running": a hidden plan may still walk.
  const nothingDrawn = plans.length === 0 && arcs.length === 0 && loosePlanners.length === 0;

  return (
    // `tabIndex={-1}`: the last place a press that emptied the board hands the keyboard (`landFocusInHome`).
    <div ref={widgetRef} tabIndex={-1} data-runner-widget className="flex min-w-0 flex-col gap-4 outline-none">
      {/* How full the planner lane is — the tab header's own readout. Not drawn when the frame states
          no dial (an older dispatcher). */}
      <PlannerLanesReadout />
      {nothingDrawn ? (
        <EmptyState icon={ActivityIcon} title={t(hidden.length > 0 ? 'dispatcher.hidden.allHidden' : 'runner.empty')} />
      ) : (
        <>
          {/* The outings with no deck to be drawn in, above the list — the tab's own arrangement
              (`LoosePlannerBadges`). It draws nothing when there are none. */}
          <LoosePlannerBadges planners={loosePlanners} />
          {/* Not drawn when nothing is done; no dialog: it deletes nothing, and the dispatcher keeps every plan. */}
          {done && (
            <Button variant="secondary" size="sm" className="h-8 self-end" onClick={() => dismissDone(done.dismiss)} data-dismiss-done>
              {t('dispatcher.dismissDone', { count: done.count })}
            </Button>
          )}
          {items.length > 0 && (
            <ul ref={attachList} className={cn('flex min-w-0 flex-col', LANE_CARD_GAP)}>
              {items.map((item, index) => {
                // A deck stands 24px from its neighbours, as the tab's decks do (`DispatchArcDecks`'
                // `gap-6`), so where an arc begins and ends is read from the spacing: the list's card
                // gap (16px) plus `mt-2`. The list stays flat and keyed by item, so a reorder moves
                // cards rather than remounting them.
                const besideDeck = index > 0 && (item.kind === 'arc' || items[index - 1]?.kind === 'arc');
                return (
                  <li key={itemKey(item)} data-widget-item={itemKey(item)} className={cn('min-w-0', besideDeck && 'mt-2')} {...itemProps(cardName(item))}>
                    {item.kind === 'arc' ? (
                      <DispatchArcDecks groups={[item.group]} home="gutter" pinnedSessionId={sessionId} carriedNames={carriedNames} />
                    ) : (
                      <PlanItem plan={item.plan} mine={openedBy(item.plan, sessionId)} carriedNames={carriedNames} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {/* The way back from any Hide — under the EmptyState too, because a lane whose every unfinished
          plan is hidden must still offer it. */}
      <HiddenPlans hidden={hidden} carriedNames={carriedNames} />
    </div>
  );
}

/**
 * A plan of no arc as the widget draws it: its card, wearing this chat's pin when the chat opened it —
 * the same pin a plan inside an arc deck wears on its own row, so "this chat opened that plan" reads
 * the same at either depth.
 */
function PlanItem({ plan, mine, carriedNames }: { plan: DispatcherPlan; mine: boolean; carriedNames: string[] }) {
  return (
    <div data-testid="runner-widget-plan" data-plan-name={plan.name} data-pinned={String(mine)} className="flex min-w-0 flex-col gap-1">
      {mine && <SessionPin />}
      <PlanCard plan={plan} onPutAway={planPutAway(plan, carriedNames)} />
    </div>
  );
}
