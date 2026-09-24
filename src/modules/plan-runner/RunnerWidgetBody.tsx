import { ActivityIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ArcGallery } from '@/modules/plan-runner/ArcGallery';
import { dismissRun } from '@/modules/plan-runner/dismissedRuns';
import { useArcs } from '@/modules/plan-runner/hooks/useArcs';
import { useArcRunIds } from '@/modules/plan-runner/hooks/useArcRunIds';
import { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
import { RunCard } from '@/modules/plan-runner/RunCard';
import { SessionPin } from '@/modules/plan-runner/SessionPin';
import { byUrgencyThenNewest } from '@/modules/plan-runner/runState';
import type { RunnerRunSnapshot } from '@/shared/types';
import { EmptyState } from '@/shared/ui';

/**
 * The plan-runner runs as the desktop chat gutter draws them: the open chat's runs first, the rest
 * of the lane behind them, every card FOLDED.
 *
 * THE SECOND HOME, BESIDE THE TRANSCRIPT AND NEVER OVER IT. The Runner tab is the card's other
 * home, and it opens every card because a person who navigated there has asked for the runs. Here
 * the runs are company for a conversation that is still the point, so each one is a folded line —
 * a title, a state, a meter — that costs the gutter one row until it is opened. `defaultOpen` is
 * `RunCard`'s one variance, and this is the slot the folded value exists for.
 *
 * THIS CHAT'S RUNS LEAD, AND THE SORT INSIDE EACH GROUP IS THE LANE'S. `byUrgencyThenNewest` is
 * moved, not rewritten, from the tab's own panel, so the two homes can never disagree about which
 * run is urgent. A stable filter then lifts the runs whose `launched_by_session` equals the open
 * chat to the front — `null` on either side is not a match, since "no session launched it" is not
 * "this session launched it". The prop arrives already resolved to an APP session id by the server,
 * so a plain equality is the whole test.
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
 * IT READS THE BUS AND DRAWS NO FRAME. `useRunnerRuns` and `useArcs` hand it the retained lanes, so
 * it paints on its first render and owns no state of its own; the chrome, the slots and the
 * scrolling belong to `src/modules/chat-gutters`.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), as the Runner widget's body.
 */
export function RunnerWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { runs, carriedIds } = useRunnerRuns();
  const { arcs } = useArcs();
  const arcRunIds = useArcRunIds();

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
  // screen, and saying "nothing" over it would be the widget's one lie.
  if (runs.length === 0 && arcs.length === 0) {
    return <EmptyState icon={ActivityIcon} title={t('runner.empty')} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ArcGallery home="gutter" pinnedSessionId={sessionId} />
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
                  // prunes the stored list against.
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
