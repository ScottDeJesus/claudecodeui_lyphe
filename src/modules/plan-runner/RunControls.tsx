import { useTranslation } from 'react-i18next';

import { useRunnerVerbs } from '@/modules/plan-runner/hooks/useRunnerVerbs';
import { RunModelControl } from '@/modules/plan-runner/RunModelControl';
import { ScheduleControl } from '@/modules/plan-runner/ScheduleControl';
import { runUnfinished } from '@/modules/plan-runner/runState';
import { Button } from '@/shared/ui';
import type { RunnerRunSnapshot } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

type RunControlsProps = {
  run: RunnerRunSnapshot;
  /**
   * How to clear an ended run from the screen. Rendered only when the caller passes it: a card does
   * not know the lane, and the list that draws it does.
   */
  onDismiss?: () => void;
  /**
   * Whether the run's own model word rides here. `false` on an arc's plan card, whose deck header
   * carries the arc's ONE model toggle (operator, 2026-09-22: "an arc plan should have 1 toggle") —
   * and that toggle re-pins every minted, unfinished card's run, so the live run is reachable
   * through it and nothing is lost. Defaults to `true`.
   */
  showModel?: boolean;
};

/**
 * The verbs that apply to a run, chosen by state rather than by all being present and some
 * disabled.
 *
 * ONLY A LIVE RUN CAN BE STOPPED: `plan-runner stop` looks for a lock naming the run and refuses
 * without one, so a stale run — whose daemon is gone — has literally nothing to stop, and offering
 * the button would be inviting a refusal. A parked or dead run offers Resume, the verb that
 * actually continues it. A QUEUED run offers Start, which is that same `resume` (`start` is what
 * created it parked; the runner's resume is the walk), beside it `Start at …` (`ScheduleControl`),
 * the same press made ahead of time. An ENDED run offers Dismiss — the operator asked to see a run
 * finish and clear it themselves (2026-09-09) — and Resume too whenever a phase is still blocked
 * or pending, read off the PHASES and never off the receipt's word: the runner's `complete` means
 * something shipped, not that nothing is left (`runUnfinished`).
 *
 * THE MODEL CONTROL IS DRAWN ONLY WHERE A PRESS COULD STILL MOVE THE RUN: a finished run has no
 * next phase for the word to reach.
 *
 * NO CONFIRMATION DIALOG GUARDS STOP, deliberately — it is a pause, and the button beside it is
 * the undo; and a refusal from the runner is shown in its own words by `useRunnerVerbs`, never
 * swallowed.
 *
 * Used by `RunCard`'s footer and by `ArcCard`, at the foot of the run its plan card owns.
 */
export function RunControls({ run, onDismiss, showModel = true }: RunControlsProps) {
  const { t } = useTranslation();
  const ended = run.state === 'ended';
  const queued = run.state === 'queued';
  // The resume verb's WORD travels into the hook: pressing Start and being answered under the
  // header "Resume" is the runner's own rule in this app's other name for it.
  const { stop, resume, setModel, schedule, busy } = useRunnerVerbs(run.run_id,
    queued ? t('runner.start') : t('runner.resume'));
  const unfinished = ended && runUnfinished(run);

  return (
    // The row is this component's own, so a host supplies a SLOT and not a layout: `w-full` is what
    // lets it fill one (`RunCard`'s footer and `ArcCard`'s run strip are both flex containers).
    <div className="flex w-full flex-wrap items-center gap-2">
      {ended ? (
        <>
          {unfinished && (
            <Button size="sm" disabled={busy !== null} onClick={() => void resume()}>
              {t('runner.resume')}
            </Button>
          )}
          {onDismiss && (
            <Button variant="secondary" size="sm" onClick={onDismiss} data-runner-dismiss>
              {t('runner.dismiss')}
            </Button>
          )}
        </>
      ) : queued ? (
        // Start IS `resume`: the runner's `resume` re-opens the ledger and walks the run at its
        // stage, and a queued run has no stage yet — it begins where a fresh run does.
        // Beside it, the same Start made ahead of time: the watchdog presses it at the scheduled moment.
        <>
          <Button size="sm" disabled={busy !== null} onClick={() => void resume()} data-runner-start>
            {t('runner.start')}
          </Button>
          <ScheduleControl scope="run" startAt={run.start_at ?? null} busy={busy !== null}
            onSchedule={(when) => void schedule(when)} />
        </>
      ) : run.state === 'live' ? (
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void stop()}>
          {t('runner.stop')}
        </Button>
      ) : (
        <Button size="sm" disabled={busy !== null} onClick={() => void resume()}>
          {t('runner.resume')}
        </Button>
      )}
      {/* The run's own DeepSeek / Claude word, on every run a press could still move. A record with
          no word — or a frame from an older server — reads DeepSeek. */}
      {showModel && (!ended || unfinished) && (
        <div className="ml-auto">
          <RunModelControl scope="run" value={effectiveModelWord(run.model)} busy={busy !== null}
            onChoose={(choice) => void setModel(choice)} />
        </div>
      )}
    </div>
  );
}

