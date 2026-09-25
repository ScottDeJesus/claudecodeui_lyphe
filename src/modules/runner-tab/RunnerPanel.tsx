import { ActivityIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { byUrgencyThenNewest as planUrgency, DispatchArcHeaders, epochOf, PlanCard, useDispatcherPlans } from '@/modules/dispatcher';
import { ArcGallery, byUrgencyThenNewest, dismissRun, RunCard, useArcRunIds, useArcs, useRunnerRuns } from '@/modules/plan-runner';
import { Badge, EmptyState, ScrollArea } from '@/shared/ui';

/**
 * The Runner tab's pane: every run the lane is carrying, each as a whole card.
 *
 * IT READS THE BUS AND NOTHING ELSE. `useRunnerRuns` hands it the retained `runner:*` value, so
 * this pane paints on its FIRST render with whatever the bus was already holding rather than
 * blank until the runner next moves — which is what makes selecting the tab feel instant. It
 * fetches nothing on mount and owns no state of its own; the seed and the socket are `RunnerFeed`'s
 * job, one level up and one module-internal file away.
 *
 * EVERY CARD IS OPEN. `defaultOpen` is the one variance `RunCard` offers, and the tab is the place
 * that wants it: a person who has navigated HERE has asked for the runs, so making them press a
 * disclosure per card to see the phases would be charging them twice for one request. (A folded
 * card is what a single-card slot would want, which is why the prop exists at all.) A `PlanCard`
 * is not passed the prop at all — a plan card's phases are shown in every home it has, so the two
 * homes cannot disagree about what it shows (`PlanFace`), and this tab is one of those homes.
 *
 * A RUN AN ARC CARD OWNS IS NOT LISTED HERE. The card draws it, whole — progress, stage, clock,
 * verbs — and drawing it again below the deck was the same plan twice (operator, 2026-09-24).
 * `useArcRunIds` is the one rule for which runs those are, read by the gutter widget too, so the
 * two homes cannot disagree about where a run belongs. What it filters is the LIST alone: the
 * count below still counts them, because a run drawn inside a card is on this very screen and a
 * "0" over a panel that is showing one would be the header lying about the lane.
 *
 * THE COUNT INCLUDES PAUSED RUNS AND ENDED RUNS NOT YET DISMISSED, and it agrees with the tab's badge because both read the same
 * `count` off the same hook — the badge from `useWorkspaceTabGates`, this header from here, one
 * value with two readers. A badge of 3 over a panel of 2 cards would make a liar of one of them.
 *
 * `data-runner-panel` is the browser harness's handle, on the ROOT and for the same reason
 * a run's card carries `data-runner-card`: a probe scopes every reading to THIS pane, so a card the
 * operator's own run puts on screen at the same moment is never mistaken for the one under test.
 *
 * THE v3 PLANS JOIN THE SAME LIST. The dispatcher's plans (`useDispatcherPlans`) are drawn as
 * `PlanCard`s — the run card's composition with a `dispatch v1` pill — ABOVE the runs and below the
 * arc gallery, in their own urgency order; the header's count and the EmptyState read runs AND
 * plans. A dismissal passes ITS OWN lane's carried ids — `carriedIds` for a run, `carriedNames` (the
 * plans' `v3:<name>`) for a plan: `dismissRun` prunes only within the ending's own id-space, so the
 * other lane's dismissals stand whichever card is pressed (`dismissedRuns.ts`).
 *
 * The EmptyState is reachable and is not dead code: the tab is STICKY, so a person standing here
 * when the last run ends keeps the tab and meets this instead of the tab vanishing under them. It
 * shows only when there is nothing at all — no run, no runner arc and no DISPATCH arc: an arc whose
 * next card has no run yet is still something to look at (`ArcGallery` draws it above the run list,
 * inside the same scroll), and a dispatch arc is a control over the plans below it whichever cards
 * are still on screen (`DispatchArcHeaders`).
 *
 * THE DISPATCH ARCS' OWN WORD RIDES ABOVE THE PLANS. `DispatchArcHeaders` sits between the runner's
 * gallery and the plan cards: an arc's control reaches every plan of that arc, so it belongs where
 * those plans begin rather than at the top of a list that is mostly other things.
 */
export function RunnerPanel() {
  const { t } = useTranslation();
  const { runs, count: runCount, carriedIds } = useRunnerRuns();
  const { plans, arcs: dispatchArcs, count: planCount, carriedNames } = useDispatcherPlans();
  const count = runCount + planCount;
  const orderedPlans = useMemo(() => [...plans].sort(planUrgency), [plans]);
  const { arcs } = useArcs();
  const arcRunIds = useArcRunIds();

  const ordered = useMemo(
    () => runs.filter((run) => !arcRunIds.has(run.run_id)).sort(byUrgencyThenNewest),
    [runs, arcRunIds],
  );

  return (
    <div className="flex h-full flex-col" data-runner-panel>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <ActivityIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('runner.title')}</h2>
        {/* No badge at zero: the EmptyState below already says "nothing", and a "0" over it would
            say it a second time in a shape that reads like a count worth checking. */}
        {count > 0 && <Badge tone="neutral">{count}</Badge>}
      </div>

      {count === 0 && arcs.length === 0 && dispatchArcs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState icon={ActivityIcon} title={t('runner.empty')} />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ArcGallery />
          {/* THE DISPATCH ARCS SIT ABOVE THE DISPATCH PLANS, in the same centred column: a dispatch
              arc is a control over the v3 plans below it (its word reaches every one of them), not a
              deck of its own, so it belongs where those plans begin. `ArcGallery` above is the RUNNER
              lane's arcs — minted card plans on disk — and the two are different objects with
              different words, which is why they are two components and not one list. */}
          <DispatchArcHeaders arcs={dispatchArcs} />
          {/* A measured column, centred, the way the memory queue's is: these are short cards, and
              letting one run the full width of a desktop workspace strands a line of text in a
              field of empty surface. What lets a title wrap at 390px is `w-full break-words` on the
              card's own heading (`RunCard`), not anything here. */}
          <ul className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-3 px-4 py-5">
            {orderedPlans.map((plan) => {
              const endedAt = plan.status === 'complete' ? epochOf(plan.completed_at) : null;
              return (
                <li key={`v3:${plan.name}`} className="min-w-0">
                  <PlanCard
                    plan={plan}
                    onDismiss={endedAt !== null ? () => dismissRun({ run_id: `v3:${plan.name}`, ended_at: endedAt }, carriedNames) : undefined}
                  />
                </li>
              );
            })}
            {ordered.map((run) => (
              <li key={run.run_id} className="min-w-0">
                <RunCard
                  run={run}
                  defaultOpen
                  onDismiss={
                    run.state === 'ended' && run.ended_at !== null
                      ? () => dismissRun({ run_id: run.run_id, ended_at: run.ended_at as number }, carriedIds)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
