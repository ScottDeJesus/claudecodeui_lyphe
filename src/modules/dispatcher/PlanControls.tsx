import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AcceptWhenCut } from '@/modules/dispatcher/AcceptWhenCut';
import { ActionBar } from '@/modules/dispatcher/ActionBar';
import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { usePutAway } from '@/modules/dispatcher/hooks/usePutAway';
import { ModelPick } from '@/modules/dispatcher/ModelPick';
import { OverrideFold } from '@/modules/dispatcher/OverrideFold';
import { ScheduleControl } from '@/modules/dispatcher/ScheduleControl';
import { Button } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

/**
 * The plan card's `ActionBar`: the verbs that apply to a plan, chosen by its status, then its fold of overrides.
 * A verb is drawn where the dispatcher would take it, never drawn disabled where it would refuse.
 *
 * - `live` → Stop, and Start beside it while PAUSE ALL holds the plan (`route.epics.paused` and the
 *   dispatcher's own `plan.queue_hold`): the press that picks this one plan out of a paused house. It
 *   sends the same `resume` verb the queued Start does — `store.set_paused(False)` writes the
 *   no-detail `resumed` event even over a plan that is not paused, which is `release.own_press_at` at
 *   or after the moment Pause all went on (`line_gate` step 2) — and the next frame's `queue_hold` is
 *   null, so Start goes away by itself. The clause's TEXT is never matched: the dial reading and the
 *   hold's presence decide. A live plan the queue does not hold draws Stop alone: Stop is a pause, and
 *   Resume is its undo, so no dialog guards it.
 * - `stalled` → Resume, and Stop beside it. The plan is released and its running work has ended with
 *   nothing to record it (`report_stall`): Resume is the press that starts things again — it wakes the
 *   dispatcher, or starts one, and its first pass settles what ended and takes the walk up — so it is
 *   the primary; Stop stays because the plan is still released, and an operator who would rather hold
 *   it than wake it must be able to. Never Stop alone: a card that offers only Pause over work that
 *   is not there is the card that said the epic was moving.
 * - `paused` → Resume and `Resume at …`: a plan STOPPED mid-walk is the one an hour makes sense in
 *   front of, because the timer's press is the very Resume the button beside it sends. Resume runs
 *   under Pause all too: pressed under it, its own press is at or after the pause's moment (`line_gate`
 *   step 2), and the plan is let through while every plan not pressed stays held.
 * - `queued` → Start (it IS `resume`: the plan is approved and paused and has never walked). THIS START IS THE
 *   OVERRIDE: the master controller's one Start, at the top of In flight, lets every waiting plan go and leaves
 *   the queue's order and the epic limits to decide what runs, while this one lets THIS feature go right away —
 *   past the queue's order, the epics-at-once limit and its epic's feature limit (`release.own_press`).
 *   PAUSE ALL HOLDS A START ONLY WHEN THE PRESS CAME BEFORE IT WENT ON (`epic_dial.Dial.since`): a Start
 *   pressed while Pause all is on goes right away, one plan out of a paused house, and its own tasks still run
 *   as many at a time as its task WIP allows. There is no `Start at …`: the hour a feature never walked was
 *   armed for is gone from the card.
 * - `scheduled` → the same, reading the armed hour: `Resume`/`Start` and `Cancel` (the schedule
 *   control). The hour itself is the card's own clock (`PlanFace.PlanClock`), said once.
 * - `hidden` → Show. The operator hid the plan, and a hide is the dispatcher's: the plan is paused and held out of the
 *   queue until he Shows it, which is also what lets it take its turn (`usePutAway`). The card is drawn at all only
 *   when news brought it back (an ask, an ending); the `Hidden` list is the usual way back.
 * - `parked` → Unpark. `idle` in `designed` or `questions` → Park, the way out of the Stop hold.
 * - `idle` in `designed` → `Accept when cut` before Park (`AcceptWhenCut`): the operator's Accept on the design he
 *   has read, ahead of the cut — the card sends the design stamp it drew (`design_loaded_at`), and the dispatcher
 *   approves the first cut of that exact design. Pressed, the card reads `Accepted · starts when cut` with
 *   `Cancel`, Park beside it, and keeps reading it while the plan is `loaded` and the cut is landing. A plan in
 *   `questions` has no design to accept yet (his answers reload it, which clears a press), so Park is alone.
 * - `complete` → nothing: a finished plan has no verb left, and putting its card away is Hide, in the
 *   head's corner (`LaneCardHead`) — a press on the screen, not on the plan.
 *
 * `paused` AND `scheduled` ARE BOTH THE STOPPED PLAN, and `launched` is what tells which word the
 * hour wears. A plan that has WALKED and been stopped reads `paused` with no hour and `scheduled`
 * with one; a plan still waiting at the gate reads `queued`, and `scheduled` once armed. The two are
 * drawn differently on purpose — Resume against Start — because the dispatcher's Resume is a promise about a walk
 * that is already out and its Start about one that never began, and the operator pressing either should read
 * the same word on the button as the plan's own state.
 *
 * THE PLAN'S OWN MODEL WORD IS AN OVERRIDE, in the fold under the verbs (`OverrideFold`, closed by default), on every
 * plan a press could still move — a COMPLETE plan has no next phase for the word to reach, so its bar draws
 * nothing at all. It is not a verb chosen by status, so no status can be a reason to hide it: `dispatcher model`
 * is never refused for the state a plan is in (the word is read when a chain is LAUNCHED). The dropdown's
 * first option follows what sits above the card — its epic's word when the epic carries one, else the top (the
 * house switch the master controller draws) — and any other option is the plan's own word. The folded line
 * names the plan's own model word when it departs from that, and nothing when it does not: an epic's press hands its
 * word to each of its features (`store.set_arc_model`), so a feature carrying the very word its epic says overrides
 * nothing. The arc's deck carries the ARC's word and hands it down, and this is where one plan speaks for itself again.
 *
 * A FEATURE CARRIES NO CONCURRENCY CONTROL: how many features of an epic are in progress, and how
 * many tasks each runs at once, are the EPIC's WIP (`EpicWipControl`, in the epic deck's fold). When
 * the epic's feature limit is what a feature is waiting on, the card says so in its head
 * (`PlanCard`'s `data-plan-wip-hold` line) — that is a fact, not a press.
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
  const { route, arcs, carriedNames } = useDispatcherPlans();
  const putAway = usePutAway(carriedNames);
  // A STOPPED plan is one that has walked: `report.launched` is that fact, and it is what tells the
  // two `scheduled` plans apart — one waiting for the Start it was queued with, one waiting for the
  // Resume that ends the stop. `paused` is stopped by definition (a paused plan that never walked
  // reads `queued`).
  const stops = plan.status === 'paused' || (plan.status === 'scheduled' && plan.launched);
  const starts = plan.status === 'queued' || (plan.status === 'scheduled' && !plan.launched);
  // A LIVE plan the queue holds while Pause all is on: the dispatcher's own reading (the board's dial and
  // this plan's clause), never the clause's words. Start is the press that picks this plan out of the pause.
  const startUnderPause = plan.status === 'live' && route?.epics?.paused === true && plan.queue_hold !== null;
  const { stop, resume, schedule, park, unpark, plannerResume, setModel, armAccept, disarmAccept, busy } = useDispatcherVerbs(plan.name, 'plan',
    starts ? t('runner.start') : t('runner.resume'));
  const held = busy !== null;
  const armed = epochOf(plan.schedule?.start_at ?? null);
  const word = starts ? t('runner.start') : t('runner.resume');

  let verbs: ReactNode = null;
  if (plan.status === 'live') {
    // Start is the pause's own exception (`release.own_press_at` at or after the dial's moment): the same
    // `resume` verb the queued Start sends, drawn only while the dispatcher says the queue holds this plan.
    verbs = (
      <>
        {startUnderPause && (
          <Button size="sm" className="h-8" disabled={held} onClick={() => void resume()} data-dispatcher-start>
            {t('runner.start')}
          </Button>
        )}
        <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void stop()} data-dispatcher-stop>
          {t('runner.stop')}
        </Button>
      </>
    );
  } else if (plan.status === 'stalled') {
    verbs = (
      <>
        <Button size="sm" className="h-8" disabled={held} onClick={() => void resume()} data-dispatcher-resume>
          {t('runner.resume')}
        </Button>
        <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void stop()} data-dispatcher-stop>
          {t('runner.stop')}
        </Button>
      </>
    );
  } else if (stops || starts) {
    // ONE BUTTON, TWO STATES: the plan is at the gate (`starts` — Start, the override of the board's one Start) or
    // the plan is down mid-walk (`stops` — Resume, and `Resume at …`). The dispatcher's `resume` verb is what either
    // press runs, and the wording is what tells the operator whether he is beginning something or taking it back up.
    // The hour is offered only to a plan that walked; once an hour IS set — on either — the control is its `Cancel`,
    // and where that hour is, the card's own clock already says (`PlanFace.PlanClock`).
    verbs = (
      <>
        <Button size="sm" className="h-8" disabled={held} onClick={() => void resume()}
          {...(stops ? { 'data-dispatcher-resume': '' } : { 'data-dispatcher-start': '' })}>{word}</Button>
        {(stops || armed !== null) && (
          <ScheduleControl busy={held} onSchedule={(when) => void schedule(when)} startAt={armed} />
        )}
      </>
    );
  } else if (plan.status === 'hidden') {
    verbs = (
      <Button size="sm" className="h-8" disabled={held} onClick={() => putAway.show([plan])} data-dispatcher-show>
        {t('dispatcher.hidden.show')}
      </Button>
    );
  } else if (plan.status === 'parked') {
    verbs = (
      <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void unpark()} data-dispatcher-unpark>
        {t('dispatcher.unpark')}
      </Button>
    );
  } else if (plan.status === 'idle' && (plan.state === 'designed' || plan.state === 'questions'
    || (plan.state === 'loaded' && plan.accept_armed))) {
    // `loaded` is drawn only for a press that is still standing (the cut has landed, the daemon has not
    // approved it yet): the armed word and Cancel, and no Park — a loaded plan is not parkable.
    const parkable = plan.state !== 'loaded';
    verbs = (
      <>
        {plan.state !== 'questions' && (
          <AcceptWhenCut scope="plan" busy={held}
            pressable={plan.state === 'designed' && !plan.accept_armed && Boolean(plan.design_loaded_at)}
            armed={Boolean(plan.accept_armed)}
            armedTitle={plan.accept_armed ? t('dispatcher.acceptWhenCutArmedTitle', { by: plan.accept_armed.by, at: plan.accept_armed.at }) : undefined}
            onArm={() => void armAccept(plan.design_loaded_at ?? '')} onCancel={() => void disarmAccept()} />
        )}
        {parkable && (
          <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void park()} data-dispatcher-park>
            {t('dispatcher.park')}
          </Button>
        )}
      </>
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
  // What this feature follows when it has no word of its own: its epic's, if the epic carries one, else the
  // house switch's as the frame read it. A word of its own that equals its epic's departs from nothing.
  const epicWord = plan.arc === null ? null : (arcs.find((arc) => arc.name === plan.arc)?.model ?? null);
  const follows = epicWord ?? effectiveModelWord(null, route ? route.provider === 'deepseek' : null);
  const override = plan.model_own !== null && plan.model_own !== epicWord ? plan.model_own : null;
  return (
    <ActionBar
      verbs={verbs}
      fold={movable ? (
        <OverrideFold scope="plan" overrides={override === null ? [] : [t(`runner.model.${override}`)]}>
          <ModelPick scope="plan" own={override} follows={follows} source={epicWord === null ? 'top' : 'epic'} busy={held}
            onChoose={(choice) => void setModel(choice)} />
        </OverrideFold>
      ) : null}
    />
  );
}
