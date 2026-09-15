import { ActivityIcon, PinIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { dismissRun } from '@/modules/plan-runner/dismissedRuns';
import { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
import { RunCard } from '@/modules/plan-runner/RunCard';
import { byUrgencyThenNewest } from '@/modules/plan-runner/runState';
import type { RunnerRunSnapshot } from '@/shared/types';
import { Badge, EmptyState } from '@/shared/ui';

/**
 * The mark on a run THIS chat launched: a glyph AND a word.
 *
 * Colour is never the whole signal (design doctrine :147-149) and neither is a shape, so the pin
 * carries the glance and the badge carries the words. The tone is `info` — which run is the open
 * chat's is news about which ROW this is, never a verdict on the run itself.
 *
 * Written here and once more in `MemoryWidgetBody.tsx`. Two copies is below design doctrine §2's
 * promote-on-the-third rule, and the two consumers live in different modules.
 */
function SessionPin() {
  const { t } = useTranslation();
  return (
    <span data-session-pin className="inline-flex items-center gap-1" title={t('gutters.pin.title')}>
      <PinIcon aria-hidden="true" className="h-3.5 w-3.5" />
      <Badge tone="info">{t('gutters.pin.label')}</Badge>
    </span>
  );
}

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
 * IT READS THE BUS AND DRAWS NO FRAME. `useRunnerRuns` hands it the retained lane, so it paints on
 * its first render and owns no state of its own; the chrome, the slots and the scrolling belong to
 * `src/modules/chat-gutters`.
 */
export function RunnerWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { runs, carriedIds } = useRunnerRuns();

  // The lane, sorted once and split once. Both groups keep the urgency order a single stable
  // filter preserves, so "mine" is a lift rather than a second ordering to keep in step.
  const { mine, rest } = useMemo(() => {
    const ordered = [...runs].sort(byUrgencyThenNewest);
    const isMine = (run: RunnerRunSnapshot) => sessionId !== null && run.launched_by_session === sessionId;
    return { mine: ordered.filter(isMine), rest: ordered.filter((run) => !isMine(run)) };
  }, [runs, sessionId]);

  if (runs.length === 0) {
    return <EmptyState icon={ActivityIcon} title={t('runner.empty')} />;
  }

  return (
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
  );
}
