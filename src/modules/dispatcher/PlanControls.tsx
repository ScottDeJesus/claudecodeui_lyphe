import { useTranslation } from 'react-i18next';

import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { RunModelControl, ScheduleControl } from '@/modules/plan-runner';
import { Button } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

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
 * THE PLAN'S OWN MODEL WORD RIDES THE SAME FOOTER, on every plan a press could still move — a
 * COMPLETE plan has no next phase for the word to reach, which is `RunControls`' own rule. It is not
 * a verb chosen by status, so it is drawn beside them rather than among them: `dispatcher model` is
 * never refused for the state a plan is in (the word is read when a chain is LAUNCHED), so no status
 * can be a reason to hide it.
 *
 * The control draws the plan's EFFECTIVE word — its own, else its arc's, else the runner's default
 * (`dispatcher.model.of`) — so what it shows is what this plan's next chain is really launched with,
 * including a word it merely inherited from its arc. A plan that belongs to an arc keeps its own
 * control here: the arc header carries the ARC's word and hands it down, and this is where one plan
 * speaks for itself again.
 *
 * A refusal is the dispatcher's own first line, toasted by `useDispatcherVerbs`.
 *
 * Used by `PlanCard`'s footer.
 */
export function PlanControls({ plan, onDismiss }: { plan: DispatcherPlan; onDismiss?: () => void }) {
  const { t } = useTranslation();
  const starts = plan.status === 'queued' || plan.status === 'scheduled';
  const { stop, resume, schedule, park, unpark, setModel, busy } = useDispatcherVerbs(plan.name,
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

  const movable = plan.status !== 'complete';
  if (verbs === null && !movable) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {verbs}
      {/* `ml-auto` puts the switch at the row's end when a verb shares the row, and at its start when
          none does — the same slot `RunControls` gives it, so the two cards' footers read alike. */}
      {movable && (
        <div className="ml-auto">
          <RunModelControl scope="plan" value={effectiveModelWord(plan.model)} busy={held}
            onChoose={(choice) => void setModel(choice)} />
        </div>
      )}
    </div>
  );
}
