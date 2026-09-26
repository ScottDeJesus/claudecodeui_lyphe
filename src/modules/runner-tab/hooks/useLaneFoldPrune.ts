import { useMemo } from 'react';

import { dispatchArcFoldKey, planFoldKey, useCardFoldPrune } from '@/shared/hooks/useCardFold';
import type { DispatcherArc, DispatcherPlan } from '@/shared/types';

/**
 * Keeps the remembered card folds to the cards this lane still carries — the one place the two kinds
 * of foldable key are assembled, so the Runner tab and the chat gutter's Runner widget prune by ONE
 * rule and can never disagree about which folds are still worth keeping.
 *
 * THE LISTS ARE HANDED IN, NOT RE-READ. Both homes already hold both of them (`useDispatcherPlans`),
 * and a hook that read the bus again to answer a question its caller could answer would add a
 * subscription per home and a second chance for the two to see different frames.
 *
 * The lists are the DRAWN ones — a plan the operator has dismissed, an arc whose last plan went with
 * them — not the lane's full carry (`carriedNames`). A dismissal is the operator saying they have
 * seen a card, so its fold has nothing left to remember; the dismissal store still keys on the whole
 * carried lane for its own reason, and that reason is its own.
 *
 * The effect behind this fires whenever a frame replaces the arrays, which is every poll — and
 * `pruneCardFolds` writes nothing when nothing was dropped, so a quiet lane costs no preference
 * write. See `src/shared/hooks/useCardFold.ts` for what a prune may and may not drop.
 *
 * Used by `RunnerPanel` and `RunnerWidgetBody`, the lane's two homes.
 */
export function useLaneFoldPrune(
  plans: readonly DispatcherPlan[],
  dispatchArcs: readonly DispatcherArc[],
): void {
  const live = useMemo(() => [
    ...plans.map((plan) => planFoldKey(plan.name)),
    ...dispatchArcs.map((arc) => dispatchArcFoldKey(arc.name)),
  ], [plans, dispatchArcs]);

  useCardFoldPrune(live);
}
