import { useMemo } from 'react';

import {
  dispatchArcFoldKey,
  planFoldKey,
  runnerArcFoldKey,
  runFoldKey,
  useCardFoldPrune,
} from '@/shared/hooks/useCardFold';
import type { ArcSnapshot, DispatcherArc, DispatcherPlan, RunnerRunSnapshot } from '@/shared/types';

/**
 * Keeps the remembered card folds to the cards this lane still carries — the one place the four
 * kinds of foldable key are assembled, so the Runner tab and the chat gutter's Runner widget prune
 * by ONE rule and can never disagree about which folds are still worth keeping.
 *
 * THE LISTS ARE HANDED IN, NOT RE-READ. Both homes already hold every one of them (`useRunnerRuns`,
 * `useDispatcherPlans`, `useArcs`), and a hook that read the bus again to answer a question its
 * caller could answer would add three subscriptions per home and a second chance for the two to see
 * different frames.
 *
 * The lists are the DRAWN ones — a run and a plan the operator has dismissed, an arc whose last plan
 * went with them — not the lane's full carry (`carriedIds` / `carriedNames`). A dismissal is the
 * operator saying they have seen a card, so its fold has nothing left to remember; the dismissal
 * stores still key on the whole carried lane for their own reasons, and those reasons are theirs.
 *
 * The effect behind this fires whenever a frame replaces the arrays, which is every poll — and
 * `pruneCardFolds` writes nothing when nothing was dropped, so a quiet lane costs no preference
 * write. See `src/shared/hooks/useCardFold.ts` for what a prune may and may not drop.
 *
 * Used by `RunnerPanel` and `RunnerWidgetBody`, the lane's two homes.
 */
export function useLaneFoldPrune(
  runs: readonly RunnerRunSnapshot[],
  plans: readonly DispatcherPlan[],
  arcs: readonly ArcSnapshot[],
  dispatchArcs: readonly DispatcherArc[],
): void {
  const live = useMemo(() => [
    ...runs.map((run) => runFoldKey(run.run_id)),
    ...plans.map((plan) => planFoldKey(plan.name)),
    ...arcs.map((arc) => runnerArcFoldKey(arc.arc)),
    ...dispatchArcs.map((arc) => dispatchArcFoldKey(arc.name)),
  ], [runs, plans, arcs, dispatchArcs]);

  useCardFoldPrune(live);
}
