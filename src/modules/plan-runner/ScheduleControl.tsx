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
   * again", which is what a plan at the gate needs too). A dispatch ARC's press chooses nothing by it: its label
   * states what the press does for a plan at the gate and a plan stopped mid-walk alike (`LABEL` below).
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
// written only where a Resume-at press is a distinct thing — a v3 plan stopped mid-walk. A dispatch ARC's hour
// is both at once (its stopped plans are the ones at the gate and the ones down mid-plan), so its one title is
// written once and states the hour over the whole arc.
const TITLE: Record<ScheduleScope, { start: string; resume?: string }> = {
  run: { start: 'runner.schedule.runTitle' },
  arc: { start: 'runner.schedule.arcTitle' },
  plan: { start: 'dispatcher.scheduleTitle', resume: 'dispatcher.resumeTitle' },
  'dispatch-arc': { start: 'dispatcher.arcScheduleTitle' },
};
// The WORD on the press, by scope. Three of the four arms state WHEN the hour is (`Start at 3:00 AM`, or
// `Resume at …` by the verb that hour will send) — the hour is the off-peak moment and the press arms it. A
// dispatch ARC's says what the press DOES instead: the hour it arms is ONE hour over every plan of the arc that
// is not moving, which is a plan waiting at the gate and a plan stopped mid-walk alike, so one word covers both
// and it is the operator's own (2026-09-25: "Pause, and schedule start buttons please"). Its `verb` therefore
// chooses nothing — the row's own Start and this press are the two halves of one arc-level control.
const LABEL: Record<ScheduleScope, { start: string; resume?: string }> = {
  run: { start: 'runner.schedule.startAt' },
  arc: { start: 'runner.schedule.startAt' },
  plan: { start: 'runner.schedule.startAt', resume: 'runner.schedule.resumeAt' },
  'dispatch-arc': { start: 'dispatcher.arcScheduleStart' },
};

/**
 * `Start at 3:00 AM` — or `Resume at 3:00 AM`, or, once scheduled, `Cancel`. Used by `RunCard`'s queued footer,
 * `PlanControls` (the v3 plan card) and both decks' own row (`ArcDeck`'s for a runner arc, `DispatchArcControls`
 * for a dispatch one): the same control on all four, so one shape means one thing.
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
  const labels = LABEL[scope];
  const label = (verb === 'resume' ? labels.resume : undefined) ?? labels.start;

  return (
    <div role="group" aria-label={t('runner.schedule.label')} className="inline-flex items-center"
      {...{ [prefix]: startAt === null ? '' : String(startAt) }}>
      {startAt === null ? (
        <Button type="button" variant="secondary" size="sm" disabled={busy || offpeakAt === null}
          title={t(title)}
          onClick={() => onSchedule('offpeak')} {...{ [`${prefix}-set`]: '' }}>
          {t(label, { time: offpeakAt === null ? '…' : scheduleClock(offpeakAt) })}
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
