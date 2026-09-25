import { useTranslation } from 'react-i18next';

import { epochOf, scheduleClock } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { RunModelControl, ScheduleControl } from '@/modules/plan-runner';
import { Badge, Button } from '@/shared/ui';
import type { DispatcherArc, DispatcherArcStatus, Tone } from '@/shared/types';
import { cn, effectiveModelWord } from '@/shared/utils';

/**
 * The arc's own word and tone — `ArcDeck`'s table over the STORE's five words rather than the
 * runner's. The two lanes' arcs are different objects (a runner arc is a deck of minted card plans
 * on disk, a dispatch arc is a row in the store with plans hanging off it), so their status
 * vocabularies are different too, and each lane states its own rather than mapping one onto the
 * other's shape.
 *
 * `judged` is neutral because a judgment is a fact and not a verdict; `empty` is warn because an arc
 * whose every plan was dropped is the one state an operator did not ask for, and it is the state
 * nothing else on the screen would show.
 */
const STATUS: Record<DispatcherArcStatus, { key: string; tone: Tone }> = {
  designing: { key: 'dispatcher.arcStatus.designing', tone: 'info' },
  judged: { key: 'dispatcher.arcStatus.judged', tone: 'neutral' },
  live: { key: 'dispatcher.arcStatus.live', tone: 'info' },
  complete: { key: 'dispatcher.arcStatus.complete', tone: 'positive' },
  empty: { key: 'dispatcher.arcStatus.empty', tone: 'warn' },
};

/**
 * ONE dispatch arc, as a header over the plans of it — `<name>.arc`, its own word, its plan count, the
 * DeepSeek · Claude · Chat switch for the arc's ONE model word, and the three verbs that move the
 * plans under it: Stop, Resume, and Resume at 3:00 AM.
 *
 * THE SWITCH IS THE REASON THIS EXISTS. A plan card carries its own control, and a plan may say
 * anything it likes; the arc's word is the one that reaches EVERY plan of it, because
 * `dispatcher model <arc> <word>` copies it onto each of them (`store.set_arc_model`). So the header
 * is the operator's answer to "all of it, from here on", and a plan that presses its own word
 * afterwards speaks for itself until the arc presses again.
 *
 * THE THREE VERBS ARE THE PLAN CARD'S OWN, APPLIED TO THE WHOLE ARC, and the header draws each one
 * exactly where the dispatcher's own arc door would take it — `arc.walking` for Stop, `arc.stopped`
 * for Resume and for Resume at 3:00 AM, and never a control drawn greyed out where the verb would
 * refuse. Stop is a PAUSE, so nothing guards it; Resume is its undo; the hour is the arm the timer
 * waits on, and once one is set the header says WHEN — `arc.schedule`, the one stamp the press wrote
 * on every STOPPED plan of the arc — beside the control that cancels it. The sets are the dispatcher's own
 * (`report_arcs.walking` / `.stopped`), read off the same plan rows the cards below are drawn from,
 * so a press here and the same verb at a terminal can never reach different plans.
 *
 * NOTHING IS INVENTED AND NOTHING IS COUNTED HERE. The plan count is the names the store listed
 * (`store.arc_plans`'s order, which is the arc file's); the switch draws `arc.model` — the ARC's own
 * word, never a plan's effective one — and a record with no word, or a frame from an older server,
 * reads the runner's default (`effectiveModelWord`), which is what its plans would run on.
 *
 * `data-dispatch-arc`, `data-arc-name` and `data-arc-status` are the browser harness's handles, on
 * the ROOT so a probe scopes every reading and every press to ONE arc — the operator's own arcs walk
 * beside a probe's and must never be pressed.
 *
 * Used by `DispatchArcHeaders`, one per arc the lane carries.
 */
export function DispatchArcHeader({ arc }: { arc: DispatcherArc }) {
  const { t } = useTranslation();
  const { stop, resume, schedule, setModel, busy } = useDispatcherVerbs(arc.name, 'arc');
  const status = STATUS[arc.status] ?? STATUS.designing;
  const armed = epochOf(arc.schedule);
  const held = busy !== null;

  return (
    <section
      data-dispatch-arc
      data-arc-name={arc.name}
      data-arc-status={arc.status}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3"
    >
      <div className="flex min-w-0 items-start gap-2">
        <h4 className="min-w-0 flex-1 break-words font-mono text-sm leading-snug" data-arc-door>
          {`${arc.name}.arc`}
        </h4>
        <Badge tone={status.tone} className="shrink-0">{t(status.key)}</Badge>
      </div>
      {arc.goal && (
        <p className="line-clamp-2 min-w-0 break-words text-xs leading-snug text-muted-foreground">{arc.goal}</p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 text-xs text-muted-foreground" data-arc-plans>
          {t('dispatcher.arcPlans', { count: arc.plans.length })}
        </p>
        <div className="ml-auto">
          <RunModelControl scope="dispatch-arc" value={effectiveModelWord(arc.model)} busy={held}
            onChoose={(choice) => void setModel(choice)} />
        </div>
      </div>
      {/* Only where a verb would be taken: an arc with nothing walking and nothing stopped draws no
          row at all, so a header never offers a press the dispatcher would refuse. (An armed hour is
          not a third case to test for: `arc.schedule` is read over the arc's stopped plans, so an
          hour can only be named on an arc that is stopped.) */}
      {(arc.walking || arc.stopped) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {arc.walking && (
            <Button variant="secondary" size="sm" disabled={held} onClick={() => void stop()}
              data-dispatch-arc-stop>{t('runner.stop')}</Button>
          )}
          {arc.stopped && (
            <>
              <Button size="sm" disabled={held} onClick={() => void resume()}
                data-dispatch-arc-resume>{t('runner.resume')}</Button>
              <ScheduleControl scope="dispatch-arc" verb="resume" startAt={armed} busy={held}
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
    </section>
  );
}

/**
 * Every arc the lane carries, in the order the store listed them (oldest first), above the plan cards
 * they speak for.
 *
 * ONE HOME FOR EACH ARC, HOWEVER MANY CARDS IT HAS. A dispatch arc's plans are drawn in the SAME
 * urgency-ordered list as every other plan — they are not gathered under their arc, and that is the
 * plans list's own rule, not this component's business — so the header stands above the list rather
 * than over its own cards. That is the honest shape for a control that reaches every one of them: a
 * header wedged between two cards would claim a grouping the list does not have.
 *
 * ONE LIST, TWO HOMES, and `home` is its one variance — the run card's two, and `ArcGallery`'s own,
 * whose `home` this mirrors so the dispatcher's headers and the runner's decks stand in the same two
 * places with the same widths. The home is written on the DOM (`data-dispatch-arcs`), so a reading
 * is always taken from ONE home.
 *
 * Nothing here reads the lane: the caller hands it the arcs it already has (`useDispatcherPlans`),
 * so a caller that filters the list and one that does not can never draw different headers.
 */
export function DispatchArcHeaders({ arcs, home = 'tab' }: { arcs: DispatcherArc[]; home?: 'tab' | 'gutter' }) {
  if (arcs.length === 0) return null;
  return (
    <ul
      data-dispatch-arcs
      className={cn('flex min-w-0 flex-col gap-3',
        home === 'tab' && 'mx-auto w-full max-w-2xl px-4 pt-5')}
    >
      {arcs.map((arc) => (
        <li key={arc.name} className="min-w-0">
          <DispatchArcHeader arc={arc} />
        </li>
      ))}
    </ul>
  );
}
