import { useTranslation } from 'react-i18next';

import { scheduleClock } from '@/modules/dispatcher/dispatcherState';
import { useOffpeak } from '@/modules/dispatcher/hooks/useOffpeak';
import { Button } from '@/shared/ui';

type ScheduleControlProps = {
  /** The scheduled moment as the last frame read it off disk (`start_at`, epoch SECONDS), or `null`. */
  startAt: number | null;
  /** A verb is in flight for this plan: the buttons refuse a second press until it answers. */
  busy: boolean;
  /** Relays `offpeak` (schedule) or `none` (cancel). */
  onSchedule: (when: 'offpeak' | 'none') => void;
};

/**
 * `Resume at 3:00 AM` — or, once scheduled, `Cancel`. Used by `PlanControls` (the plan card) for a plan STOPPED
 * MID-WALK, whose timer's press is the very Resume the button beside it sends. (The `Start at …` of a plan
 * still waiting at the gate, and the epic deck's `Schedule start`, are gone: the board's one Start is at the top
 * of In flight, and an hour armed from a terminal on a plan that never walked still shows its `Cancel` here.)
 *
 * THE TIME IS THE DISPATCHER'S: `useOffpeak` relays `dispatcher offpeak` (the end of DeepSeek's last daily peak
 * window, derived from `deepseek.PEAK_UTC`), and this control only renders it in the reader's clock. Until the
 * dispatcher answers, the button waits rather than guessing. NOTHING OPTIMISTIC: whether it reads `Resume at …`
 * or `Cancel` is `startAt`, the record as the last frame carried it; a press relays the word and the next frame
 * redraws. The daemon's own tick is what presses Resume then — the note says the operator's time.
 *
 * 32px TALL, the height of every control in the card's `ActionBar`, which is the only row it is drawn in.
 *
 * Handles: `data-dispatcher-schedule` on the group (the current `start_at`, or empty), `…-schedule-set` on the
 * press and `…-schedule-cancel` on `Cancel`.
 */
export function ScheduleControl({ startAt, busy, onSchedule }: ScheduleControlProps) {
  const { t } = useTranslation();
  const offpeakAt = useOffpeak();

  return (
    <div role="group" aria-label={t('runner.schedule.label')} className="inline-flex items-center"
      data-dispatcher-schedule={startAt === null ? '' : String(startAt)}>
      {startAt === null ? (
        <Button type="button" variant="secondary" size="sm" className="h-8 finger:h-11" disabled={busy || offpeakAt === null}
          title={t('dispatcher.resumeTitle')}
          onClick={() => onSchedule('offpeak')} data-dispatcher-schedule-set="">
          {t('runner.schedule.resumeAt', { time: offpeakAt === null ? '…' : scheduleClock(offpeakAt) })}
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="h-8 finger:h-11" disabled={busy} title={t('runner.schedule.cancelTitle')}
          onClick={() => onSchedule('none')} data-dispatcher-schedule-cancel="">
          {t('runner.schedule.cancel')}
        </Button>
      )}
    </div>
  );
}
