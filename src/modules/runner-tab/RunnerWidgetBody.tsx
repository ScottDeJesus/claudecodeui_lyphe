import { ActivityIcon } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  anyOwesWord,
  byArc,
  DispatchArcDecks,
  doneDismiss,
  HiddenPlans,
  landFocusInHome,
  LoosePlannerBadges,
  PlanCard,
  PlannerLanesReadout,
  owesWord,
  planPutAway,
  SessionPin,
  useDispatcherPlans,
} from '@/modules/dispatcher';
import type { DispatcherArcGroup, DispatcherArcSplit } from '@/modules/dispatcher';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import { LANE_CARD_GAP } from '@/shared/constants';
import type { DispatcherPlan } from '@/shared/types';
import { Button, EmptyState } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** One item of the widget's list: a whole arc deck, or one plan no arc holds. */
type WidgetItem = { kind: 'arc'; group: DispatcherArcGroup } | { kind: 'plan'; plan: DispatcherPlan };

/** An item's identity across polls — `darc:` beside `plan:`, so an arc and a plan never share one. */
function itemKey(item: WidgetItem): string {
  return item.kind === 'arc' ? `darc:${item.group.arc.name}` : `plan:${item.plan.name}`;
}

/** Whether the open chat is the one that opened `plan`. */
function openedBy(plan: DispatcherPlan, sessionId: string | null): boolean {
  return sessionId !== null && plan.session_app_id === sessionId;
}

/** The nearest ancestor of `element` that scrolls vertically: the widget frame's viewport. */
function scrollViewportOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node !== null; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * The lane as the widget's list: the items that owe a word first, then the open chat's, then the
 * rest. The base order is the tab's own — the arcs in the lane's order, then the plans of no arc in
 * `byArc`'s urgency order — and each of the three parts keeps it.
 *
 * AN OWED WORD LEADS, ABOVE THE CHAT'S OWN (`owesWord`): a prompt waiting on the operator is the one
 * thing in this column he has to answer, so it comes up in the home he is looking at while the chat
 * is open — which is the whole point of drawing the lane beside the transcript at all. An arc item is
 * asking when ANY plan of its group is: the deck is the item, and its prompt stands on the deck.
 *
 * THE CHAT'S OWN COME NEXT: the items holding a plan this chat opened, keeping that order among
 * themselves, so the card a person was just working in is under the asks and above the rest. An arc
 * holds the chat's plan when ANY plan of it does — the deck is the item, and it pins that plan's row
 * inside (`SessionPin`), while the arc's own walk order inside the deck is left alone.
 */
function widgetItemsOf(split: DispatcherArcSplit, sessionId: string | null): WidgetItem[] {
  const asking = (item: WidgetItem) => (item.kind === 'arc'
    ? anyOwesWord(item.group.plans)
    : owesWord(item.plan));
  const holdsMine = (item: WidgetItem) => (item.kind === 'arc'
    ? item.group.plans.some((plan) => openedBy(plan, sessionId))
    : openedBy(item.plan, sessionId));
  const items: WidgetItem[] = [
    ...split.groups.map((group): WidgetItem => ({ kind: 'arc', group })),
    ...split.rest.map((plan): WidgetItem => ({ kind: 'plan', plan })),
  ];
  return [
    ...items.filter(asking),
    ...items.filter((item) => !asking(item) && holdsMine(item)),
    ...items.filter((item) => !asking(item) && !holdsMine(item)),
  ];
}

/**
 * The dispatcher's lane as the desktop chat gutter draws it: ONE vertical list of every top-level item
 * the lane carries — each arc as its deck, each plan of no arc as its card — the open chat's first.
 *
 * THE SECOND HOME, BESIDE THE TRANSCRIPT AND NEVER OVER IT. The Runner tab is the card's other home and
 * lays the loose cards out as a wall; here the column is the gutter's own width, one card wide, so the
 * same items stand one under another at the tab's own spacing — two cards `LANE_CARD_GAP` apart, a deck
 * 24px from its neighbours — and the widget frame's body scrolls them (`src/modules/chat-gutters`).
 * Every item is drawn whole and at once (operator, 2026-09-28: "please remove the arrows and show a
 * list of plans instead"). A chat switch returns that scroll to the top, where the new chat's own
 * items stand.
 *
 * THE ITEMS ARE THE TAB'S SPLIT, LIFTED FOR THIS CHAT (`widgetItemsOf`): the asks first, then the open
 * chat's own, then the rest. An arc is the SAME deck the tab draws (`DispatchArcDecks`'
 * `home="gutter"`), its plans still swiped one card per view in its own strip; a plan of no arc is its
 * `PlanCard`, wearing this chat's `SessionPin` when the chat opened it.
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
 * IT READS THE BUS, HOLDS NO STATE AND DRAWS NO FRAME. `useDispatcherPlans` hands it the retained
 * picture, so it paints on its first render; the chrome, the slots and the scrolling belong to
 * `src/modules/chat-gutters`.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), as the Runner widget's body.
 */
export function RunnerWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { plans, hidden, arcs, loosePlanners, carriedNames } = useDispatcherPlans();
  // The lane split once, by the one rule both homes read, then ordered for this chat.
  const split = useMemo(() => byArc(plans, arcs), [plans, arcs]);
  const items = useMemo(() => widgetItemsOf(split, sessionId), [split, sessionId]);
  useLaneFoldPrune(plans, hidden, arcs);
  const done = doneDismiss(plans, carriedNames);
  // The widget's root: where `Dismiss done · N` hands the keyboard on once the button has left with its
  // count. One element in both branches below, so a press that emptied the lane still finds it.
  const widgetRef = useRef<HTMLDivElement>(null);

  // A chat switch re-renders this body in place — the route changes, the widget stays mounted — so the
  // frame's scroller would keep the last chat's offset and could open the new chat with another chat's
  // item filling the widget. The list starts with the open chat's own items, so the top is where a
  // newly opened chat is read from. A layout effect, so the old offset is never painted.
  useLayoutEffect(() => {
    const viewport = scrollViewportOf(widgetRef.current);
    if (viewport !== null) viewport.scrollTop = 0;
  }, [sessionId]);

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
            <ul className={cn('flex min-w-0 flex-col', LANE_CARD_GAP)}>
              {items.map((item, index) => {
                // A deck stands 24px from its neighbours, as the tab's decks do (`DispatchArcDecks`'
                // `gap-6`), so where an arc begins and ends is read from the spacing: the list's card
                // gap (16px) plus `mt-2`. The list stays flat and keyed by item, so a poll that re-sorts
                // it moves cards rather than remounting them.
                const besideDeck = index > 0 && (item.kind === 'arc' || items[index - 1]?.kind === 'arc');
                return (
                  <li key={itemKey(item)} data-widget-item={itemKey(item)} className={cn('min-w-0', besideDeck && 'mt-2')}>
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
