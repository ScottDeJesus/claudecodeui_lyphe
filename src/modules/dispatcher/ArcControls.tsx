import { useTranslation } from 'react-i18next';

import { epochOf, scheduleClock } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { RunModelControl, ScheduleControl } from '@/modules/plan-runner';
import { Button } from '@/shared/ui';
import type { DispatcherArc } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

/**
 * Everything a dispatch arc PRESSES, on the body's first row of its deck: the DeepSeek · Claude ·
 * Chat switch for the arc's ONE model word, and the three verbs that move the plans under it —
 * Start, Pause, and Schedule start.
 *
 * IT IS THE DECK'S `bodyTop`, WHICH IS WHERE THE RUNNER'S ARC PUTS ITS OWN VERBS. The fold takes
 * this whole row with the strip: the switch and Start/Pause are VERBS, the same layer a run card's
 * footer and a plan card's own controls fold away, so the two lanes' decks cannot disagree about what
 * "collapsed" hides (measured on the runner's deck, 2026-09-25: keeping the verbs in the header made
 * a folded deck 164px against 86px — a "collapsed" row that had not collapsed).
 *
 * THE SWITCH IS THE REASON THIS EXISTS. A plan card carries its own control, and a plan may say
 * anything it likes; the arc's word is the one that reaches EVERY plan of it, because
 * `dispatcher model <arc> <word>` copies it onto each of them (`store.set_arc_model`). So this row is
 * the operator's answer to "all of it, from here on", and a plan that presses its own word afterwards
 * speaks for itself until the arc presses again.
 *
 * THE THREE VERBS ARE THE PLAN CARD'S OWN, APPLIED TO THE WHOLE ARC, and each is drawn exactly where
 * the dispatcher's own arc door would take it — `arc.walking` for Pause, `arc.stopped` for Start and
 * for Schedule start, and never a control drawn greyed out where the verb would refuse. Pause is a
 * PAUSE, so nothing guards it; Start is its undo — and it is the plans' own Start, over an arc whose
 * plans were queued at the gate as much as one stopped mid-walk, which is why it is drawn for a whole
 * arc that never walked. The order it then starts them in is not this row's business: the daemon's
 * waits keep it (`rule.eligible`), so one press begins the arc and each plan takes its turn. The hour
 * is the arm the timer waits on, and once one is set the row says WHEN — `arc.schedule`, the one
 * stamp the press wrote on every STOPPED plan of the arc — beside the control that cancels it. The
 * sets are the dispatcher's own (`report_arcs.walking` / `.stopped`), read off the same plan rows the
 * strip's cards are drawn from, so a press here and the same verb at a terminal can never reach
 * different plans.
 *
 * Nothing is counted here and nothing is invented: the switch draws `arc.model` — the ARC's own word,
 * never a plan's effective one — and a record with no word, or a frame from an older server, reads
 * the runner's default (`effectiveModelWord`), which is what its plans would run on.
 *
 * Handles: `data-dispatch-arc-model` / `data-dispatch-arc-model-choice`, `data-dispatch-arc-stop`,
 * `data-dispatch-arc-resume`, `data-dispatcher-arc-schedule` (`-set`, `-cancel`, the armed hour as
 * the group's value), `data-dispatch-arc-schedule-note`. A probe scopes them under the deck's own
 * `[data-dispatch-arc][data-arc-name]` root, so it reads and presses ONE arc — the operator's own
 * arcs walk beside a probe's and must never be pressed.
 *
 * Used by `DispatchArcDeck`, as the first row of its body.
 */
export function DispatchArcControls({ arc }: { arc: DispatcherArc }) {
  const { t } = useTranslation();
  // `t('runner.start')` is the word this row's own Start is DRAWN with (below), and it is passed for
  // the same reason `PlanControls` passes the word its button carries: a refused press must answer in
  // the word the operator actually read. The hook defaults this to "Resume", which is the plan card's
  // word for a stopped plan and never this row's.
  const { stop, resume, schedule, setModel, busy } = useDispatcherVerbs(arc.name, 'arc', t('runner.start'));
  const armed = epochOf(arc.schedule);
  const held = busy !== null;

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="ml-auto">
          <RunModelControl scope="dispatch-arc" value={effectiveModelWord(arc.model)} busy={held}
            onChoose={(choice) => void setModel(choice)} />
        </div>
      </div>
      {/* Only where a verb would be taken: an arc with nothing live and nothing stopped draws no row
          at all, so a deck never offers a press the dispatcher would refuse. (An armed hour is not a
          third case to test for: `arc.schedule` is read over the arc's stopped plans, so an hour can
          only be named on an arc that is stopped.) */}
      {(arc.walking || arc.stopped) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {arc.walking && (
            <Button variant="secondary" size="sm" disabled={held} onClick={() => void stop()}
              data-dispatch-arc-stop>{t('dispatcher.arcPause')}</Button>
          )}
          {/* THE ARC'S START, AND ON A QUEUED ARC IT IS THE ONLY WAY IN. Every plan of an arc the
              operator accepted with Queue is paused at the gate, which is `arc.stopped` — so this row
              is drawn for an arc that has never walked, and one press lets the whole of it go: the
              plans' own Start repeated over the arc, with the daemon's waits keeping their order. */}
          {arc.stopped && (
            <>
              <Button size="sm" disabled={held} onClick={() => void resume()}
                data-dispatch-arc-resume>{t('runner.start')}</Button>
              <ScheduleControl scope="dispatch-arc" startAt={armed} busy={held}
                onSchedule={(when) => void schedule(when)} />
            </>
          )}
          {/* The hour a press armed, said in the operator's own clock: `report_arcs.hour` answers one
              stamp only when a STOPPED plan of the arc is waiting for it — the same set the Cancel
              beside it clears. So a named hour implies `arc.stopped`, which is what this span and
              that Cancel both sit inside of: neither can be drawn without the other. */}
          {armed !== null && (
            <span className="font-mono text-xs text-muted-foreground" data-dispatch-arc-schedule-note>
              {t('runner.schedule.starts', { time: scheduleClock(armed) })}
            </span>
          )}
        </div>
      )}
    </>
  );
}
