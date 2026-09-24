import { useTranslation } from 'react-i18next';

import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { ScheduleControl } from '@/modules/plan-runner';
import { Button } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';

/**
 * The verbs that apply to a v3 plan, chosen by its status — `RunControls`' rule: a verb is drawn
 * where the dispatcher would take it, never drawn disabled where it would refuse.
 *
 * - `live` → Stop. A pause; Resume is its undo, so no dialog guards it.
 * - `paused` → Resume.
 * - `queued` → Start (it IS `resume`: the plan is approved and paused and has never walked) and
 *   `Start at …`, the same press made ahead of time as a one-shot systemd timer.
 * - `scheduled` → Start and Cancel (the schedule control, reading the armed hour).
 * - `parked` → Unpark. `idle` in `designed` or `questions` → Park, the way out of the Stop hold.
 * - `complete` → Dismiss, when the list that draws the card offers one.
 *
 * NO MODEL CONTROL: the route is the box's switch, never a plan's, and it rides the meter.
 * A refusal is the dispatcher's own first line, toasted by `useDispatcherVerbs`.
 *
 * Used by `PlanCard`'s footer.
 */
export function PlanControls({ plan, onDismiss }: { plan: DispatcherPlan; onDismiss?: () => void }) {
  const { t } = useTranslation();
  const starts = plan.status === 'queued' || plan.status === 'scheduled';
  const { stop, resume, schedule, park, unpark, busy } = useDispatcherVerbs(plan.name,
    starts ? t('runner.start') : t('runner.resume'));
  const held = busy !== null;

  let verbs: React.ReactNode = null;
  if (plan.status === 'live') {
    verbs = (
      <Button variant="secondary" size="sm" disabled={held} onClick={() => void stop()} data-dispatcher-stop>
        {t('runner.stop')}
      </Button>
    );
  } else if (plan.status === 'paused') {
    verbs = (
      <Button size="sm" disabled={held} onClick={() => void resume()} data-dispatcher-resume>{t('runner.resume')}</Button>
    );
  } else if (starts) {
    verbs = (
      <>
        <Button size="sm" disabled={held} onClick={() => void resume()} data-dispatcher-start>{t('runner.start')}</Button>
        <ScheduleControl scope="plan" busy={held} onSchedule={(when) => void schedule(when)}
          startAt={plan.status === 'scheduled' ? epochOf(plan.schedule?.start_at ?? null) : null} />
      </>
    );
  } else if (plan.status === 'parked') {
    verbs = (
      <Button variant="secondary" size="sm" disabled={held} onClick={() => void unpark()} data-dispatcher-unpark>
        {t('dispatcher.unpark')}
      </Button>
    );
  } else if (plan.status === 'idle' && (plan.state === 'designed' || plan.state === 'questions')) {
    verbs = (
      <Button variant="secondary" size="sm" disabled={held} onClick={() => void park()} data-dispatcher-park>
        {t('dispatcher.park')}
      </Button>
    );
  } else if (plan.status === 'complete' && onDismiss) {
    verbs = (
      <Button variant="secondary" size="sm" onClick={onDismiss} data-dispatcher-dismiss>{t('runner.dismiss')}</Button>
    );
  }

  if (verbs === null) return null;
  return <div className="flex w-full flex-wrap items-center gap-2">{verbs}</div>;
}
