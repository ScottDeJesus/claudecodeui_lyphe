import { useTranslation } from 'react-i18next';

import { useOffpeak } from '@/modules/plan-runner/hooks/useOffpeak';
import { scheduleClock } from '@/modules/plan-runner/runState';
import { Button } from '@/shared/ui';

type ScheduleControlProps = {
  /**
   * Whose Start this schedules: one queued run's (`plan-runner schedule`), one unstarted arc's (`arc schedule`), or
   * one queued v3 plan's (`dispatcher schedule`, a one-shot systemd timer that sends Resume at the hour).
   */
  scope: 'run' | 'arc' | 'plan';
  /** The scheduled moment as the last frame read it off disk (`start_at`, epoch SECONDS), or `null`. */
  startAt: number | null;
  /** A verb is in flight for this run or arc: the buttons refuse a second press until it answers. */
  busy: boolean;
  /** Relays `offpeak` (schedule) or `none` (cancel). */
  onSchedule: (when: 'offpeak' | 'none') => void;
};

const PREFIX = { run: 'data-runner-schedule', arc: 'data-arc-schedule', plan: 'data-dispatcher-schedule' } as const;
const TITLE = { run: 'runner.schedule.runTitle', arc: 'runner.schedule.arcTitle', plan: 'dispatcher.scheduleTitle' } as const;

/**
 * `Start at 3:00 AM` — or, once scheduled, `Cancel`. Used by `RunCard`'s queued footer, `ArcDeck`'s header and
 * `PlanControls` (the v3 plan card):
 * the same control on both, so one shape means one thing.
 *
 * THE TIME IS THE RUNNER'S: `useOffpeak` relays `plan-runner offpeak` (the end of DeepSeek's last daily peak
 * window, derived from `deepseek.PEAK_UTC`), and this control only renders it in the reader's clock. Until the
 * runner answers, the button waits rather than guessing. A v3 plan reads the same clock: `dispatcher offpeak` prints
 * the same line from the same `PEAK_UTC`, so there is one hour. NOTHING OPTIMISTIC: whether it reads `Start at …` or
 * `Cancel` is `startAt`, the record as the last frame carried it; a press relays the word and the next frame
 * redraws. The watchdog's two-minute tick is what presses Start then — the note says the operator's time.
 *
 * Handles, the scope's own: `data-runner-schedule` / `data-arc-schedule` / `data-dispatcher-schedule` on the group (the current `start_at`,
 * or empty), `…-schedule-set` on `Start at …` and `…-schedule-cancel` on `Cancel`.
 */
export function ScheduleControl({ scope, startAt, busy, onSchedule }: ScheduleControlProps) {
  const { t } = useTranslation();
  const offpeakAt = useOffpeak();
  const prefix = PREFIX[scope];

  return (
    <div role="group" aria-label={t('runner.schedule.label')} className="inline-flex items-center"
      {...{ [prefix]: startAt === null ? '' : String(startAt) }}>
      {startAt === null ? (
        <Button type="button" variant="secondary" size="sm" disabled={busy || offpeakAt === null}
          title={t(TITLE[scope])}
          onClick={() => onSchedule('offpeak')} {...{ [`${prefix}-set`]: '' }}>
          {t('runner.schedule.startAt', { time: offpeakAt === null ? '…' : scheduleClock(offpeakAt) })}
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="sm" disabled={busy} title={t('runner.schedule.cancelTitle')}
          onClick={() => onSchedule('none')} {...{ [`${prefix}-cancel`]: '' }}>
          {t('runner.schedule.cancel')}
        </Button>
      )}
    </div>
  );
}
