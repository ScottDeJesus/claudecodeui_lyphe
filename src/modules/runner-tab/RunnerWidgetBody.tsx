import { ActivityIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { byArc, DispatchArcDecks, planDismissal, PlanCard, useDispatcherPlans } from '@/modules/dispatcher';
import { ArcGallery, byUrgencyThenNewest, dismissRun, RunCard, SessionPin, useArcRunIds, useArcs, useRunnerRuns } from '@/modules/plan-runner';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import type { DispatcherPlan, RunnerRunSnapshot } from '@/shared/types';
import { EmptyState } from '@/shared/ui';

/**
 * The plan-runner runs as the desktop chat gutter draws them: the open chat's plans and runs first, the
 * rest of the lane behind them, each RUN a folded line and each PLAN card with its phases shown.
 *
 * THE SECOND HOME, BESIDE THE TRANSCRIPT AND NEVER OVER IT. The Runner tab is the card's other
 * home, and it opens every card because a person who navigated there has asked for the runs. Here
 * the runs are company for a conversation that is still the point, so each RUN is a folded line —
 * a title, a state, a meter — that costs the gutter one row until it is opened. `defaultOpen` is
 * `RunCard`'s one variance, and this is the slot the folded value exists for.
 *
 * A PLAN CARD'S PHASE LIST IS NEVER FOLDED BY DEFAULT, HERE OR ANYWHERE (operator, 2026-09-25:
 * "dispatch v1 cards on the plan runner tab should always show phases like the normal runner
 * cards"). `PlanCard` takes no `defaultOpen` and `PlanFace` opens its phase list itself, so the two
 * homes cannot disagree about what a plan card shows; a plan's phases are the whole of what it has
 * to say, where a run card carries a meter, a pipeline strip and lanes beside its own. The card's
 * own FOLD is a different layer and is the operator's to press, in either home (`CardFoldToggle`).
 *
 * THE FOLDS ARE THE TAB'S FOLDS, AND THIS BODY PRUNES THE SAME MEMORY. `useLaneFoldPrune` hands the
 * fold store exactly what this widget draws, so a card folded here is folded on the tab and the
 * folds of cards that have left the lane go with them — one memory, two homes.
 *
 * THIS CHAT'S RUNS LEAD, AND THE SORT INSIDE EACH GROUP IS THE LANE'S. `byUrgencyThenNewest` is
 * moved, not rewritten, from the tab's own panel, so the two homes can never disagree about which
 * run is urgent. A stable filter then lifts the runs whose `launched_by_session` equals the open
 * chat to the front — `null` on either side is not a match, since "no session launched it" is not
 * "this session launched it". The prop arrives already resolved to an APP session id by the server,
 * so a plain equality is the whole test. The plans no arc holds are lifted by the same rule, for the
 * same reason.
 *
 * THE ARC DECK COMES FIRST, AS IT DOES ON THE TAB. `ArcGallery`'s gutter home — flush, one whole
 * card per view — sits above the runs, so an arc whose next card has no run yet is on screen beside
 * the transcript exactly as it is on the tab. The EmptyState shows only when there is neither a run
 * NOR an arc, the tab's own rule.
 *
 * A RUN AN ARC CARD OWNS IS NOT LISTED HERE — the card draws it, whole, and the same plan twice was
 * the operator's complaint (2026-09-24). `useArcRunIds` is the one rule for which those are, read
 * by the tab's panel too; what it filters is the LIST alone, so the count and the empty state still
 * speak of runs that are on screen, inside a deck. The pin travels to the deck for the same reason:
 * a run this chat launched that is drawn in an arc card wears its pin THERE, on the card.
 *
 * THE v3 PLANS RIDE ABOVE THE RUNS, with their phases open, and they arrive NESTED BY ARC — the one
 * split both homes read (`byArc`, the tab's own rule): every arc of the lane is one DECK holding the
 * plans of that arc in the arc's own strip, wearing this chat's pin on the plans it opened, and the
 * plans no arc holds follow in the same lift the runs get — the open chat's first, the rest behind. A
 * dismissal here passes its own lane's carried ids, the tab's rule (`RunnerPanel`).
 *
 * THE PIN IS ON THE ROW, WHEREVER THE NESTING PUT IT. A plan of this chat inside an arc deck wears
 * `SessionPin` on ITS row (`data-dispatch-plan-row`) exactly as a plan of no arc wears it on the
 * `runner-widget-plan` row below, so "this chat opened that plan" reads the same at either depth.
 *
 * IT READS THE BUS AND DRAWS NO FRAME. `useRunnerRuns` and `useArcs` hand it the retained lanes, so
 * it paints on its first render and owns no state of its own; the chrome, the slots and the
 * scrolling belong to `src/modules/chat-gutters`.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), as the Runner widget's body.
 */
export function RunnerWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { runs, carriedIds } = useRunnerRuns();
  const { plans, arcs: dispatchArcs, carriedNames } = useDispatcherPlans();
  // The lane split once, by the one rule both homes read: the arcs holding the plans of them in the
  // arcs' own order, and the plans no arc holds. Inside an arc the order is the ARC's — it is a
  // sequence of plans that depend on each other, and the open chat's "mine first" lift below belongs
  // to the list the operator's own plans sit in, not to a walk the store laid out.
  const split = useMemo(() => byArc(plans, dispatchArcs), [plans, dispatchArcs]);
  const loosePlans = useMemo(() => {
    const isMine = (plan: DispatcherPlan) => sessionId !== null && plan.session_app_id === sessionId;
    return [...split.rest.filter(isMine), ...split.rest.filter((plan) => !isMine(plan))];
  }, [split, sessionId]);
  const { arcs } = useArcs();
  const arcRunIds = useArcRunIds();
  useLaneFoldPrune(runs, plans, arcs, dispatchArcs);

  // The lane, sorted once and split once. Both groups keep the urgency order a single stable
  // filter preserves, so "mine" is a lift rather than a second ordering to keep in step. The
  // runs an arc card draws are dropped BEFORE the split: a card owns one run whichever chat
  // launched it, and the deck is where that run is drawn.
  const { listed, mine, rest } = useMemo(() => {
    const ordered = [...runs].filter((run) => !arcRunIds.has(run.run_id)).sort(byUrgencyThenNewest);
    const isMine = (run: RunnerRunSnapshot) => sessionId !== null && run.launched_by_session === sessionId;
    return { listed: ordered, mine: ordered.filter(isMine), rest: ordered.filter((run) => !isMine(run)) };
  }, [runs, sessionId, arcRunIds]);

  // The empty state speaks of the LANE, not of this list: a run an arc card draws is on this very
  // screen, and saying "nothing" over it would be the widget's one lie. A DISPATCH arc counts with
  // the runner's, for that same reason: it is a row of this widget even when every card under it has
  // been dismissed.
  if (runs.length === 0 && plans.length === 0 && arcs.length === 0 && dispatchArcs.length === 0) {
    return <EmptyState icon={ActivityIcon} title={t('runner.empty')} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ArcGallery home="gutter" pinnedSessionId={sessionId} />
      {/* The dispatch arcs, above the plans no arc holds — the tab's own arrangement, in this
          home's flush width (`home="gutter"`), each drawn as the SAME deck the runner's arcs are
          drawn as: header, fold, arrows, and the plans of the arc in its own strip. A card all of
          whose plans have been dismissed could not be here at all (`useDispatcherPlans` drops the
          arc). */}
      <DispatchArcDecks groups={split.groups} home="gutter" pinnedSessionId={sessionId} carriedNames={carriedNames} />
      {loosePlans.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-3">
          {loosePlans.map((plan) => {
            const isMine = sessionId !== null && plan.session_app_id === sessionId;
            return (
              <li key={`v3:${plan.name}`} data-testid="runner-widget-plan" data-plan-name={plan.name}
                data-pinned={String(isMine)} className="flex min-w-0 flex-col gap-1">
                {isMine && <SessionPin />}
                <PlanCard plan={plan} onDismiss={planDismissal(plan, carriedNames)} />
              </li>
            );
          })}
        </ul>
      )}
      {listed.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-3">
          {[...mine, ...rest].map((run) => {
            const isMine = sessionId !== null && run.launched_by_session === sessionId;
            return (
              <li
                key={run.run_id}
                data-testid="runner-widget-run"
                data-run-id={run.run_id}
                data-pinned={String(isMine)}
                className="flex min-w-0 flex-col gap-1"
              >
                {isMine && <SessionPin />}
                <RunCard
                  run={run}
                  defaultOpen={false}
                  // Dismiss is offered exactly where the tab offers it: an ended run whose ending is on
                  // the card. `carriedIds` is the unfiltered lane, because that is what a dismissal
                  // prunes the stored list against, within the run id-space.
                  onDismiss={
                    run.state === 'ended' && run.ended_at !== null
                      ? () => dismissRun({ run_id: run.run_id, ended_at: run.ended_at as number }, carriedIds)
                      : undefined
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
