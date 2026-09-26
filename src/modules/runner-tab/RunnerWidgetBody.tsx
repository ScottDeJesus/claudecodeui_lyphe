import { ActivityIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  byArc,
  DispatchArcDecks,
  LoosePlannerBadges,
  planDismissal,
  PlanCard,
  SessionPin,
  useDispatcherPlans,
} from '@/modules/dispatcher';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import type { DispatcherPlan } from '@/shared/types';
import { EmptyState } from '@/shared/ui';

/**
 * The dispatcher's plans as the desktop chat gutter draws them: the open chat's plans first, the rest
 * of the lane behind them, every plan card with its phases shown.
 *
 * THE SECOND HOME, BESIDE THE TRANSCRIPT AND NEVER OVER IT. The Runner tab is the card's other home,
 * and it draws the same cards in the same order; here they are company for a conversation that is
 * still the point, so the column is the gutter's own flush width rather than the tab's measured
 * centred one.
 *
 * A PLAN CARD'S PHASE LIST IS NEVER FOLDED BY DEFAULT, HERE OR ANYWHERE (operator, 2026-09-25:
 * "cards on the plan runner tab should always show phases like the normal runner cards"). `PlanCard`
 * takes no `defaultOpen` and `PlanFace` opens its phase list itself, so the two homes cannot disagree
 * about what a plan card shows; a plan's phases are the whole of what it has to say. The card's own
 * FOLD is a different layer and is the operator's to press, in either home (`CardFoldToggle`).
 *
 * THE FOLDS ARE THE TAB'S FOLDS, AND THIS BODY PRUNES THE SAME MEMORY. `useLaneFoldPrune` hands the
 * fold store exactly what this widget draws, so a card folded here is folded on the tab and the folds
 * of cards that have left the lane go with them — one memory, two homes.
 *
 * THE PLANS ARRIVE NESTED BY ARC — the one split both homes read (`byArc`, the tab's own rule): every
 * arc of the lane is one DECK holding the plans of that arc in the arc's own strip, wearing this
 * chat's pin on the plans it opened, and the plans no arc holds follow in the same lift the arc's own
 * deck gets — the open chat's first, the rest behind. A dismissal here passes the lane's carried
 * names, the tab's rule (`RunnerPanel`).
 *
 * THE PIN IS ON THE ROW, WHEREVER THE NESTING PUT IT. A plan of this chat inside an arc deck wears
 * `SessionPin` on ITS row (`data-dispatch-plan-row`) exactly as a plan of no arc wears it on the
 * `runner-widget-plan` row below, so "this chat opened that plan" reads the same at either depth.
 *
 * IT READS THE BUS AND DRAWS NO FRAME. `useDispatcherPlans` hands it the retained picture, so it
 * paints on its first render and owns no state of its own; the chrome, the slots and the scrolling
 * belong to `src/modules/chat-gutters`.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), as the Runner widget's body.
 */
export function RunnerWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { plans, arcs, loosePlanners, carriedNames } = useDispatcherPlans();
  // The lane split once, by the one rule both homes read: the arcs holding the plans of them in the
  // arcs' own order, and the plans no arc holds. Inside an arc the order is the ARC's — it is a
  // sequence of plans that depend on each other, and the open chat's "mine first" lift below belongs
  // to the list the operator's own plans sit in, not to a walk the store laid out.
  const split = useMemo(() => byArc(plans, arcs), [plans, arcs]);
  const loosePlans = useMemo(() => {
    const isMine = (plan: DispatcherPlan) => sessionId !== null && plan.session_app_id === sessionId;
    return [...split.rest.filter(isMine), ...split.rest.filter((plan) => !isMine(plan))];
  }, [split, sessionId]);
  useLaneFoldPrune(plans, arcs);

  // The empty state speaks of the LANE, not of this list: a plan an arc deck draws is on this very
  // screen, and saying "nothing" over it would be the widget's one lie. And so does a planner outing
  // with no card at all — a soul out on an arc the store has no row for yet is on this lane even
  // though nothing here can draw it a deck.
  if (plans.length === 0 && arcs.length === 0 && loosePlanners.length === 0) {
    return <EmptyState icon={ActivityIcon} title={t('runner.empty')} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* The outings with no deck to be drawn in, above the decks — the tab's own arrangement
          (`LoosePlannerBadges`). It draws nothing when there are none. */}
      <LoosePlannerBadges planners={loosePlanners} home="gutter" />
      {/* The arcs, above the plans no arc holds — the tab's own arrangement, in this home's flush
          width (`home="gutter"`): header, fold, arrows, and the plans of the arc in its own strip. A
          card all of whose plans have been dismissed could not be here at all (`useDispatcherPlans`
          drops the arc). */}
      <DispatchArcDecks groups={split.groups} home="gutter" pinnedSessionId={sessionId} carriedNames={carriedNames} />
      {loosePlans.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-3">
          {loosePlans.map((plan) => {
            const isMine = sessionId !== null && plan.session_app_id === sessionId;
            return (
              <li key={plan.name} data-testid="runner-widget-plan" data-plan-name={plan.name}
                data-pinned={String(isMine)} className="flex min-w-0 flex-col gap-1">
                {isMine && <SessionPin />}
                <PlanCard plan={plan} onDismiss={planDismissal(plan, carriedNames)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
