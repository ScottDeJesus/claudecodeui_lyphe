import { useTranslation } from 'react-i18next';

import { useOffpeak } from '@/modules/plan-runner/hooks/useOffpeak';
import { scheduleClock } from '@/modules/plan-runner/runState';
import { Button } from '@/shared/ui';

type ScheduleControlProps = {
  /**
   * Whose Start this schedules: one queued run's (`plan-runner schedule`), one unstarted arc's (`arc schedule`),
   * one v3 plan's (`dispatcher schedule <plan>`, a one-shot systemd timer that resumes at the hour), or a dispatch
   * ARC's (`dispatcher schedule <arc>`, one timer per stopped plan of it).
   */
  scope: 'run' | 'arc' | 'plan' | 'dispatch-arc';
  /**
   * WHICH PLAN VERB THE HOUR WILL SEND, and so what the button is called: `start` (the default) for a plan still
   * waiting at the gate or an arc of them, `resume` for one already stopped mid-walk — which is `PlanControls`' rule
   * and its reason, one word per press. It changes the label, the title and nothing else: the dispatcher's `schedule`
   * verb is the same verb either way, and the timer it arms runs `resume` forever (that word IS "start walking
   * again", which is what a plan at the gate needs too).
   */
  verb?: 'start' | 'resume';
  /** The scheduled moment as the last frame read it off disk (`start_at`, epoch SECONDS), or `null`. */
  startAt: number | null;
  /** A verb is in flight for this run or arc: the buttons refuse a second press until it answers. */
  busy: boolean;
  /** Relays `offpeak` (schedule) or `none` (cancel). */
  onSchedule: (when: 'offpeak' | 'none') => void;
};

const PREFIX = { run: 'data-runner-schedule', arc: 'data-arc-schedule', plan: 'data-dispatcher-schedule', 'dispatch-arc': 'data-dispatcher-arc-schedule' } as const;
type ScheduleScope = ScheduleControlProps['scope'];
// The title that says what this press really does. `start` is what a scope's hour means by default; `resume` is
// written only where a Resume-at press is a distinct thing — a v3 plan stopped mid-walk, and a dispatch arc,
// whose hour can ONLY ever mean "walk again" (its plans are all stopped) and so states that one title twice.
const TITLE: Record<ScheduleScope, { start: string; resume?: string }> = {
  run: { start: 'runner.schedule.runTitle' },
  arc: { start: 'runner.schedule.arcTitle' },
  plan: { start: 'dispatcher.scheduleTitle', resume: 'dispatcher.resumeTitle' },
  'dispatch-arc': { start: 'dispatcher.arcResumeTitle', resume: 'dispatcher.arcResumeTitle' },
};

/**
 * `Start at 3:00 AM` — or `Resume at 3:00 AM`, or, once scheduled, `Cancel`. Used by `RunCard`'s queued footer,
 * `ArcDeck`'s header, `PlanControls` (the v3 plan card) and `DispatchArcHeader` (the dispatch arc):
 * the same control on all four, so one shape means one thing.
 *
 * THE TIME IS THE RUNNER'S: `useOffpeak` relays `plan-runner offpeak` (the end of DeepSeek's last daily peak
 * window, derived from `deepseek.PEAK_UTC`), and this control only renders it in the reader's clock. Until the
 * runner answers, the button waits rather than guessing. A v3 plan and a dispatch arc read the same clock:
 * `dispatcher offpeak` prints the same line from the same `PEAK_UTC`, so there is one hour. NOTHING OPTIMISTIC:
 * whether it reads `Start at …` or `Cancel` is `startAt`, the record as the last frame carried it; a press relays
 * the word and the next frame redraws. The watchdog's two-minute tick is what presses Start then — the note says
 * the operator's time.
 *
 * Handles, the scope's own: `data-runner-schedule` / `data-arc-schedule` / `data-dispatcher-schedule` /
 * `data-dispatcher-arc-schedule` on the group (the current `start_at`, or empty), `…-schedule-set` on the press and
 * `…-schedule-cancel` on `Cancel`.
 */
export function ScheduleControl({ scope, verb = 'start', startAt, busy, onSchedule }: ScheduleControlProps) {
  const { t } = useTranslation();
  const offpeakAt = useOffpeak();
  const prefix = PREFIX[scope];
  const titles = TITLE[scope];
  const title = (verb === 'resume' ? titles.resume : undefined) ?? titles.start;

  return (
    <div role="group" aria-label={t('runner.schedule.label')} className="inline-flex items-center"
      {...{ [prefix]: startAt === null ? '' : String(startAt) }}>
      {startAt === null ? (
        <Button type="button" variant="secondary" size="sm" disabled={busy || offpeakAt === null}
          title={t(title)}
          onClick={() => onSchedule('offpeak')} {...{ [`${prefix}-set`]: '' }}>
          {t(verb === 'resume' ? 'runner.schedule.resumeAt' : 'runner.schedule.startAt',
            { time: offpeakAt === null ? '…' : scheduleClock(offpeakAt) })}
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
