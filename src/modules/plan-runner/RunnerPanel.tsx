import { ActivityIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { dismissRun } from '@/modules/plan-runner/dismissedRuns';
import { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
import { RunCard } from '@/modules/plan-runner/RunCard';
import { Badge, EmptyState, ScrollArea } from '@/shared/ui';
import type { RunnerRunSnapshot, RunnerRunState } from '@/shared/types';

/**
 * Where a run is ranked in the list, and it is a reading of URGENCY rather than of recency.
 *
 * LIVE first because something is happening to it right now. STALE second because a lapsed
 * heartbeat is the one state that may want a hand — it is the reason a person opens this tab
 * unprompted. PAUSED last because a parked run is parked on purpose: the operator stopped it, and
 * a list that raised their own decision above a run in trouble would be the app arguing with them.
 * ENDED last of all — nothing more will happen to it; it is there to be read and dismissed — and
 * within ENDED the most recent ending first, since that is the one the operator came to see.
 *
 * Reversible in one place, by design (the plan's own reversible default): change these three
 * numbers and the order changes, with nothing else to find.
 */
const STATE_ORDER: Record<RunnerRunState, number> = { live: 0, stale: 1, paused: 2, ended: 3 };

/** State first, then newest first inside each state — by its ending for an ended run, its start otherwise. */
function byUrgencyThenNewest(a: RunnerRunSnapshot, b: RunnerRunSnapshot): number {
  const recency = (run: RunnerRunSnapshot) => run.ended_at ?? run.started_at;
  return STATE_ORDER[a.state] - STATE_ORDER[b.state] || recency(b) - recency(a);
}

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
 * card is what a single-card slot would want, which is why the prop exists at all.)
 *
 * THE COUNT INCLUDES PAUSED RUNS AND ENDED RUNS NOT YET DISMISSED, and it agrees with the tab's badge because both read the same
 * `count` off the same hook — the badge from `useWorkspaceTabGates`, this header from here, one
 * value with two readers. A badge of 3 over a panel of 2 cards would make a liar of one of them.
 *
 * `data-runner-panel` is the browser harness's handle, on the ROOT and for the same reason
 * a run's card carries `data-runner-card`: a probe scopes every reading to THIS pane, so a card the
 * operator's own run puts on screen at the same moment is never mistaken for the one under test.
 *
 * The EmptyState is reachable and is not dead code: the tab is STICKY, so a person standing here
 * when the last run ends keeps the tab and meets this instead of the tab vanishing under them.
 */
export function RunnerPanel() {
  const { t } = useTranslation();
  const { runs, count, carriedIds } = useRunnerRuns();

  const ordered = useMemo(() => [...runs].sort(byUrgencyThenNewest), [runs]);

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

      {count === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState icon={ActivityIcon} title={t('runner.empty')} />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {/* A measured column, centred, the way the memory queue's is: these are short cards, and
              letting one run the full width of a desktop workspace strands a line of text in a
              field of empty surface. What lets a title wrap at 390px is `w-full break-words` on the
              card's own heading (`RunCard`), not anything here. */}
          <ul className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-3 px-4 py-5">
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
