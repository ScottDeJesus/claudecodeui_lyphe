import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionBar } from '@/modules/dispatcher/ActionBar';
import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { RunModelControl } from '@/modules/dispatcher/RunModelControl';
import { ScheduleControl } from '@/modules/dispatcher/ScheduleControl';
import { SwarmControl } from '@/modules/dispatcher/SwarmControl';
import { Button } from '@/shared/ui';
import type { DispatcherPlan, DispatcherRoute, DispatcherSwarmWord } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

/**
 * The box's swarm switch as one word of the grammar — `off`, `on`, `on <N>` — the word a plan on
 * `Box` walks under, which its swarm control wears. `null` before the first frame has a route.
 */
function boxSwarmWord(route: DispatcherRoute | null): DispatcherSwarmWord | null {
  if (route === null) return null;
  if (!route.swarm.enabled) return 'off';
  return route.swarm.lanes === null ? 'on' : `on ${route.swarm.lanes}`;
}

/**
 * The plan card's `ActionBar`: the verbs that apply to a plan, chosen by its status, then its model
 * switch. A verb is drawn where the dispatcher would take it, never drawn disabled where it would
 * refuse.
 *
 * - `live` → Stop. A pause; Resume is its undo, so no dialog guards it.
 * - `paused` → Resume and `Resume at …`: a plan STOPPED mid-walk is the one an hour makes sense in
 *   front of, because the timer's press is the very Resume the button beside it sends.
 * - `queued` → Start (it IS `resume`: the plan is approved and paused and has never walked) and
 *   `Start at …`, the same press made ahead of time as a one-shot systemd timer.
 * - `scheduled` → the same pair, reading the armed hour: `Resume`/`Start` and `Cancel` (the schedule
 *   control). The hour itself is the card's own clock (`PlanFace.PlanClock`), said once.
 * - `parked` → Unpark. `idle` in `designed` or `questions` → Park, the way out of the Stop hold.
 * - `complete` → nothing: a finished plan has no verb left, and putting its card away is Hide, in the
 *   head's corner (`LaneCardHead`) — a press on the screen, not on the plan.
 *
 * `paused` AND `scheduled` ARE BOTH THE STOPPED PLAN, and `launched` is what tells which word the
 * hour wears. A plan that has WALKED and been stopped reads `paused` with no hour and `scheduled`
 * with one; a plan still waiting at the gate reads `queued`, and `scheduled` once armed. The two are
 * drawn differently on purpose — Resume at 3:00 AM against Start at 3:00 AM — because the dispatcher's
 * Resume is a promise about a walk that is already out and its Start about one that never began, and
 * the operator pressing either should read the same word on the button as the plan's own state.
 *
 * THE PLAN'S OWN MODEL WORD RIDES THE SAME BAR, on every plan a press could still move — a
 * COMPLETE plan has no next phase for the word to reach, so its bar draws nothing at all. It is not
 * a verb chosen by status, so it is drawn beside them rather than among them: `dispatcher model` is
 * never refused for the state a plan is in (the word is read when a chain is LAUNCHED), so no status
 * can be a reason to hide it.
 *
 * The control draws the plan's EFFECTIVE word — its own, else its arc's, else the configured default
 * (`dispatcher.model.of`) — so what it shows is what this plan's next chain is really launched with,
 * including a word it merely inherited from its arc. A plan that belongs to an arc keeps its own
 * control here: the arc's action bar carries the ARC's word and hands it down, and this is where one plan
 * speaks for itself again.
 *
 * THE PLAN'S OWN SWARM WORD RIDES BESIDE IT (`SwarmControl`), on the same plans and for the same
 * reason: `dispatcher swarm` is never refused for a plan's state either (the word is read at the
 * rule's next take-up). `Box` hands the plan back to the box's switch and wears that switch's word, so
 * the card says what bounds the plan whichever switch it is.
 *
 * A STALLED PLANNER IS DRAWN BESIDE ALL OF THEM, whatever the plan's status (`plan.planner.stalled`):
 * Resume planner, the press that puts the outing that ended short back to work. Which door it goes
 * back through — `cut`, `judge`, a `tell` of `continue` — is the dispatcher's own reading of its store
 * at the press, so the card names none; the daemon asks again for an ending that was only the weather
 * (`planner_retry`), and this is the operator's hand for the ones it will not.
 *
 * A refusal is the dispatcher's own first line, toasted by `useDispatcherVerbs`.
 *
 * Used by `PlanCard`, directly under its head.
 */
export function PlanControls({ plan }: { plan: DispatcherPlan }) {
  const { t } = useTranslation();
  // A STOPPED plan is one that has walked: `report.launched` is that fact, and it is what tells the
  // two `scheduled` plans apart — one waiting for the Start it was queued with, one waiting for the
  // Resume that ends the stop. `paused` is stopped by definition (a paused plan that never walked
  // reads `queued`).
  const stops = plan.status === 'paused' || (plan.status === 'scheduled' && plan.launched);
  const starts = plan.status === 'queued' || (plan.status === 'scheduled' && !plan.launched);
  const { stop, resume, schedule, park, unpark, plannerResume, setModel, setSwarm, busy } = useDispatcherVerbs(plan.name, 'plan',
    starts ? t('runner.start') : t('runner.resume'));
  const { route } = useDispatcherPlans();
  const held = busy !== null;
  const armed = epochOf(plan.schedule?.start_at ?? null);
  const word = starts ? t('runner.start') : t('runner.resume');

  let verbs: ReactNode = null;
  if (plan.status === 'live') {
    verbs = (
      <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void stop()} data-dispatcher-stop>
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
        <Button size="sm" className="h-8" disabled={held} onClick={() => void resume()}
          {...(stops ? { 'data-dispatcher-resume': '' } : { 'data-dispatcher-start': '' })}>{word}</Button>
        <ScheduleControl scope="plan" verb={stops ? 'resume' : 'start'} busy={held}
          onSchedule={(when) => void schedule(when)} startAt={armed} />
      </>
    );
  } else if (plan.status === 'parked') {
    verbs = (
      <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void unpark()} data-dispatcher-unpark>
        {t('dispatcher.unpark')}
      </Button>
    );
  } else if (plan.status === 'idle' && (plan.state === 'designed' || plan.state === 'questions')) {
    verbs = (
      <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void park()} data-dispatcher-park>
        {t('dispatcher.park')}
      </Button>
    );
  }

  // The stalled planner's Resume rides after whichever verbs the status drew, in the same row.
  if (plan.planner?.stalled) {
    verbs = (
      <>
        {verbs}
        <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void plannerResume()}
          data-dispatcher-planner-resume>
          {t('dispatcher.plannerResume')}
        </Button>
      </>
    );
  }

  const movable = plan.status !== 'complete';
  const modelWord = effectiveModelWord(plan.model);
  return (
    <ActionBar
      verbs={verbs}
      model={movable ? (
        <>
          <SwarmControl value={plan.swarm ?? null} boxWord={boxSwarmWord(route)} busy={held}
            onChoose={(choice) => void setSwarm(choice)} />
          <RunModelControl scope="plan" value={modelWord} busy={held}
            onChoose={(choice) => void setModel(choice)} />
        </>
      ) : null}
    />
  );
}
