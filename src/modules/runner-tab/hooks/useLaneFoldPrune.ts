import { useMemo } from 'react';

import { dispatchArcFoldKey, planFoldKey, useCardFoldPrune } from '@/shared/hooks/useCardFold';
import type { DispatcherArc, DispatcherPlan } from '@/shared/types';

/**
 * Keeps the remembered card folds to the cards this lane still carries — the one place the two kinds
 * of foldable key are assembled, so the Runner tab and the chat gutter's Runner widget prune by ONE
 * rule and can never disagree about which folds are still worth keeping.
 *
 * THE LISTS ARE HANDED IN, NOT RE-READ. Both homes already hold all three of them (`useDispatcherPlans`),
 * and a hook that read the bus again to answer a question its caller could answer would add a
 * subscription per home and a second chance for the two to see different frames.
 *
 * THE HIDDEN PLANS COUNT AS CARRIED, because a hide is reversible where a dismissal was not: a card
 * the operator hid comes back with `Show`, and it should come back folded exactly as he left it. So a
 * plan's fold is kept while it is drawn OR hidden, and an arc's while the arc is drawn OR a hidden plan
 * names it (an arc whose every card is hidden draws no deck, but `Show all` brings the deck back).
 * Only a plan the lane itself has dropped loses its fold. The hide store keys on the lane's whole
 * carry (`carriedNames`) for the same reason from its own side.
 *
 * The effect behind this fires whenever a frame replaces the arrays, which is every poll — and
 * `pruneCardFolds` writes nothing when nothing was dropped, so a quiet lane costs no preference
 * write. See `src/shared/hooks/useCardFold.ts` for what a prune may and may not drop.
 *
 * Used by `RunnerPanel` and `RunnerWidgetBody`, the lane's two homes.
 */
export function useLaneFoldPrune(
  plans: readonly DispatcherPlan[],
  hidden: readonly DispatcherPlan[],
  dispatchArcs: readonly DispatcherArc[],
): void {
  const live = useMemo(() => [
    ...plans.map((plan) => planFoldKey(plan.name)),
    ...hidden.map((plan) => planFoldKey(plan.name)),
    ...dispatchArcs.map((arc) => dispatchArcFoldKey(arc.name)),
    ...hidden.flatMap((plan) => (plan.arc === null ? [] : [dispatchArcFoldKey(plan.arc)])),
  ], [plans, hidden, dispatchArcs]);

  useCardFoldPrune(live);
}
