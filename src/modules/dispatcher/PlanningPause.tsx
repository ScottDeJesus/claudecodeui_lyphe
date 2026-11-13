import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoardVerbs } from '@/modules/dispatcher/hooks/useBoardVerbs';
import { useDispatcherVerbs, type DispatcherVerbScope } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { Button } from '@/shared/ui';
import type { PlanningPausedVia, PlanningPress } from '@/shared/types';

/** The line's words, by whose pause it states: `dispatcher.planningPause.paused` and `.pausedWithEpic`. */
const PAUSED_WORD: Record<PlanningPausedVia, string> = {
  own: 'dispatcher.planningPause.paused',
  epic: 'dispatcher.planningPause.pausedWithEpic',
};

/**
 * THE OPERATOR'S BRAKE ON ONE SUBJECT'S PLANNING, as a Planning line's press: `Pause planning` while a feature or an epic is being designed or
 * planned, and `Resume planning` where the subject's OWN pause stands (`dispatcher pause-planning` / `resume-planning`). The brake holds
 * that one subject's designs, tells, cuts and judgments and ends the outing in flight; nothing else pauses — no other card, no walk,
 * not Pause all — and Resume planning sends back what the pause ended. It is the planning record's, never the walk's `stop` and `resume`.
 *
 * `press` IS A READING, NEVER CHOSEN HERE (`featurePress`, `epicPress`, `loosePress` in `planningPress.ts`): a line draws the press
 * only where the dispatcher would take it AND only while the subject is being designed or planned — so a parked feature, an accepted
 * one and one whose planner is its epic's whole-arc outing draw none, though the dispatcher would take a pause on each — and so it is
 * never drawn disabled where it would refuse. It is disabled while a press of this hook is out, and then HELD from a press the lane
 * took until the line shows it: the line redraws from the next `dispatcher_state` frame, seconds after the answer on a large store, and
 * until then the button would stand enabled over a pause that already holds. A press the lane refused is not held (nothing will flip).
 * Pause planning is a secondary `Button` and Resume planning the primary, at the action bar's own 32px desk / 44px
 * finger height as every press on a lane card is. THE WORD "PLANNING" NAMES WHICH BRAKE: the accepted card's bar says Stop and Resume for
 * the walk, the deck says Pause for its walk, and a stalled outing's press says Resume planner.
 *
 * `scope` PICKS THE DOOR, as `PaceOverride`'s does: `plan` for a feature's line, `arc` for an epic's line and for a loose outing's — an
 * epic with no feature yet (`name` is the epic's; the dispatcher resolves it). Nothing is optimistic — the line redraws from the
 * next `dispatcher_state` frame — and a refusal is the dispatcher's own first line, toasted by `useDispatcherVerbs`.
 *
 * Handles: `data-dispatcher-pause-planning` / `data-dispatcher-resume-planning` on the press, each with `data-pause-scope` (`plan` or
 * `arc`), the door it goes through.
 *
 * Used by `PlanningCard`, at the end of each line, in this module — the one place the press is drawn.
 */
export function PlanningPausePress({ name, press, scope }: { name: string; press: PlanningPress; scope: DispatcherVerbScope }) {
  const { t } = useTranslation();
  const { pausePlanning, resumePlanning, busy } = useDispatcherVerbs(name, scope);
  // The press the lane last took from this button, held until the card shows the answer. `busy` clears the moment the dispatcher
  // answers, but the card flips on the next frame, and between the two a still-enabled button would take a second press the
  // dispatcher refuses as already done. Essential state: no prop or hook field says "taken, not yet drawn".
  const [taken, setTaken] = useState<PlanningPress | null>(null);
  // The card flipping IS the frame arriving: let go, so a later flip back (a pause lifted from the terminal) finds the button free.
  if (taken !== null && taken !== press) setTaken(null);
  const pending = busy !== null || taken !== null;

  const sendPress = async () => {
    const tookIt = await (press === 'resume' ? resumePlanning() : pausePlanning());
    if (tookIt) setTaken(press);
  };

  if (press === 'resume') {
    return (
      <Button type="button" size="sm" className="h-8 finger:h-11" disabled={pending} title={t('dispatcher.planningPause.resumeTitle')}
        onClick={() => void sendPress()} data-dispatcher-resume-planning data-pause-scope={scope}>
        {t('dispatcher.planningPause.resume')}
      </Button>
    );
  }
  return (
    <Button type="button" variant="secondary" size="sm" className="h-8 finger:h-11" disabled={pending} title={t('dispatcher.planningPause.pressTitle')}
      onClick={() => void sendPress()} data-dispatcher-pause-planning data-pause-scope={scope}>
      {t('dispatcher.planningPause.press')}
    </Button>
  );
}

/**
 * THE HOUSE-WIDE PRESS OF PAUSE ALL'S PLANNING EXCEPTION, in the Planning card's head: `Resume planning` lets the planner outings run
 * while Pause all is on, and `Pause planning` holds them again (`dispatcher epics run-planning` / `hold-planning`, sent through
 * `useBoardVerbs().setDial`; the route spells `--by app:card`). Tasks and the queue stay held either way, an outing already out is
 * never touched, and Resume all drops the exception.
 *
 * IT IS NOT `PlanningPausePress`, though it wears the same two words: that press brakes and lifts ONE feature's or epic's planning
 * (`pause-planning` / `resume-planning`), which Pause all never touches, while this one is Pause all's and the whole house's. The strip's
 * own sentence (`PlanningCard`) says which brake a press is.
 *
 * `press` IS A READING, NEVER CHOSEN HERE (`dialPress` in `planningPress.ts`), and the press is held as `PlanningPausePress` holds
 * its own: disabled while a press is out, and then from a press the lane took until the strip shows it (the strip redraws from the
 * next `dispatcher_state` frame, and until then a still-enabled button would take a second press the dispatcher refuses as already
 * done). A press the lane refused is not held. Sized as every press on a lane card is: the action bar's 32px desk / 44px finger height.
 *
 * Handle: `data-planning-dial-press`, valued with the word it sends (`run-planning` or `hold-planning`).
 *
 * Used by `PlanningCard`, in the strip under its title — the one place this press is drawn.
 */
export function PlanningDialPress({ press }: { press: PlanningPress }) {
  const { t } = useTranslation();
  const { setDial, busy } = useBoardVerbs();
  // The press the lane last took from this button, held until the strip shows the answer: `busy` clears the moment the dispatcher
  // answers, but the strip flips on the next frame. Essential state, the same hold `PlanningPausePress` keeps.
  const [taken, setTaken] = useState<PlanningPress | null>(null);
  // The strip flipping IS the frame arriving: let go, so a later flip back (Resume all from the terminal) finds the button free.
  if (taken !== null && taken !== press) setTaken(null);
  const pending = busy || taken !== null;
  const word = press === 'resume' ? 'run-planning' : 'hold-planning';

  const sendPress = async () => {
    if (await setDial(word)) setTaken(press);
  };

  return (
    <Button type="button" variant={press === 'resume' ? 'default' : 'secondary'} size="sm" className="h-8 finger:h-11" disabled={pending}
      title={t(press === 'resume' ? 'dispatcher.planningDial.resumeTitle' : 'dispatcher.planningDial.pauseTitle')}
      onClick={() => void sendPress()} data-planning-dial-press={word}>
      {t(press === 'resume' ? 'dispatcher.planningPause.resume' : 'dispatcher.planningPause.press')}
    </Button>
  );
}

/**
 * THE PAUSED STATE, ONE LINE OF THE HEAD'S LEAD ROW: `Planning paused` for the subject's own pause, `Planning paused with its epic` on a
 * feature its epic's pause holds (`via`). Foreground ink and no tone — the stalled line's register: the operator's own brake is a fact,
 * not a hold the house placed (muted) and not an alarm (amber; red is destructive or denied). It rides the head because the head is what
 * a folded card keeps (MAN-5412), so a folded paused card still says it is paused; the status badge stays the dispatcher's own word,
 * since the pause writes no walk flag, and there is no second badge.
 *
 * Handle: `data-plan-planning-paused`, valued `own` or `epic`.
 *
 * Used by `PlanCard` (a feature's head), `DispatchArcDeck` (an epic's head) and `PlanningCard` (a paused subject's line), all in this module.
 */
export function PlanningPausedLine({ via }: { via: PlanningPausedVia }) {
  const { t } = useTranslation();
  return (
    <span data-plan-planning-paused={via} className="min-w-0 break-words text-xs text-foreground">
      {t(PAUSED_WORD[via])}
    </span>
  );
}
