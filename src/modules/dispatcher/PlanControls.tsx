import { useTranslation } from 'react-i18next';

import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { RunModelControl } from '@/modules/dispatcher/RunModelControl';
import { ScheduleControl } from '@/modules/dispatcher/ScheduleControl';
import { Button } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

/**
 * The verbs that apply to a plan, chosen by its status: a verb is drawn where the dispatcher would
 * take it, never drawn disabled where it would refuse.
 *
 * - `live` → Stop. A pause; Resume is its undo, so no dialog guards it.
 * - `paused` → Resume and `Resume at …`: a plan STOPPED mid-walk is the one an hour makes sense in
 *   front of, because the timer's press is the very Resume the button beside it sends.
 * - `queued` → Start (it IS `resume`: the plan is approved and paused and has never walked) and
 *   `Start at …`, the same press made ahead of time as a one-shot systemd timer.
 * - `scheduled` → the same pair, reading the armed hour: `Resume`/`Start` and `Cancel` (the schedule
 *   control). The hour itself is the card's own clock (`PlanFace.PlanClock`), said once.
 * - `parked` → Unpark. `idle` in `designed` or `questions` → Park, the way out of the Stop hold.
 * - `complete` → Dismiss, when the list that draws the card offers one.
 *
 * `paused` AND `scheduled` ARE BOTH THE STOPPED PLAN, and `launched` is what tells which word the
 * hour wears. A plan that has WALKED and been stopped reads `paused` with no hour and `scheduled`
 * with one; a plan still waiting at the gate reads `queued`, and `scheduled` once armed. The two are
 * drawn differently on purpose — Resume at 3:00 AM against Start at 3:00 AM — because the dispatcher's
 * Resume is a promise about a walk that is already out and its Start about one that never began, and
 * the operator pressing either should read the same word on the button as the plan's own state.
 *
 * THE PLAN'S OWN MODEL WORD RIDES THE SAME FOOTER, on every plan a press could still move — a
 * COMPLETE plan has no next phase for the word to reach. It is not
 * a verb chosen by status, so it is drawn beside them rather than among them: `dispatcher model` is
 * never refused for the state a plan is in (the word is read when a chain is LAUNCHED), so no status
 * can be a reason to hide it.
 *
 * The control draws the plan's EFFECTIVE word — its own, else its arc's, else the configured default
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
  // A STOPPED plan is one that has walked: `report.launched` is that fact, and it is what tells the
  // two `scheduled` plans apart — one waiting for the Start it was queued with, one waiting for the
  // Resume that ends the stop. `paused` is stopped by definition (a paused plan that never walked
  // reads `queued`).
  const stops = plan.status === 'paused' || (plan.status === 'scheduled' && plan.launched);
  const starts = plan.status === 'queued' || (plan.status === 'scheduled' && !plan.launched);
  const { stop, resume, schedule, park, unpark, setModel, busy } = useDispatcherVerbs(plan.name, 'plan',
    starts ? t('runner.start') : t('runner.resume'));
  const held = busy !== null;
  const armed = epochOf(plan.schedule?.start_at ?? null);
  const word = starts ? t('runner.start') : t('runner.resume');

  let verbs: React.ReactNode = null;
  if (plan.status === 'live') {
    verbs = (
      <Button variant="secondary" size="sm" disabled={held} onClick={() => void stop()} data-dispatcher-stop>
        {t('runner.stop')}
      </Button>
    );
  } else if (stops || starts) {
    // ONE PAIR, TWO STATES: the plan is at the gate (`starts` — Start, and `Start at …`) or the plan
    // is down mid-walk (`stops` — Resume, and `Resume at …`). The control is identical and only the
    // word differs, which is the point: the dispatcher's `resume` verb is what either press runs, and
    // the wording is what tells the operator whether he is beginning something or taking it back up.
    // Once the hour IS set the pair becomes the press and its `Cancel`; where that hour is, the
    // card's own clock already says (`PlanFace.PlanClock`), and a second copy beside the buttons
    // would be the same fact twice on one card.
    verbs = (
      <>
        <Button size="sm" disabled={held} onClick={() => void resume()}
          {...(stops ? { 'data-dispatcher-resume': '' } : { 'data-dispatcher-start': '' })}>{word}</Button>
        <ScheduleControl scope="plan" verb={stops ? 'resume' : 'start'} busy={held}
          onSchedule={(when) => void schedule(when)} startAt={armed} />
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
          none does — the same slot the arc's own control row gives it, so the two read alike. */}
      {movable && (
        <div className="ml-auto">
          <RunModelControl scope="plan" value={effectiveModelWord(plan.model)} busy={held}
            onChoose={(choice) => void setModel(choice)} />
        </div>
      )}
    </div>
  );
}
