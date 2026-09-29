import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PlanNow } from '@/modules/dispatcher/PlanNow';
import { phaseWord } from '@/modules/dispatcher/phaseWord';
import { PlanPhaseRow } from '@/modules/dispatcher/PlanPhaseRow';
import { StatusFlow } from '@/modules/dispatcher/StatusFlow';
import { clockOf, epochOf, phaseProgress, planStatusTone, scheduleClock } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useElapsed } from '@/shared/hooks/useElapsed';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import type { DispatcherPlan, LaneFlowNode } from '@/shared/types';

/**
 * A plan as its card draws it, in pieces with no frame of their own — the card's face over the
 * dispatcher's document. What moves the plan is next door (`PlanControls.tsx`).
 *
 * EVERY STRING REACHES THE DOM AS A TEXT NODE. A phase title, a verdict and an event's detail are
 * free text the dispatcher and its souls wrote; none of it meets a raw-HTML sink.
 */

/** How many of the plan's events the feed shows — the newest, newest first. */
const FEED_LIMIT = 30;

/** The plan's one word, toned by `planStatusTone`. Used by `PlanCard`'s head (its badge slot) and by `HiddenPlans`' rows. */
export function PlanStatusBadge({ plan }: { plan: DispatcherPlan }) {
  const { t } = useTranslation();
  return <Badge tone={planStatusTone(plan.status)}>{t(`dispatcher.status.${plan.status}`)}</Badge>;
}

/** The epoch of the newest `launched` or `relaunched` event: when the walk now moving began. */
function walkingSince(plan: DispatcherPlan): number | null {
  for (let index = plan.events.length - 1; index >= 0; index -= 1) {
    const event = plan.events[index];
    if (event.kind === 'launched' || event.kind === 'relaunched') return epochOf(event.at);
  }
  return null;
}

/**
 * The plan's one clock: elapsed while it is live, how long ago it ended once complete, and the
 * operator's hour while it is scheduled. Queued, paused, parked and idle plans have nothing moving
 * and nothing to count, so they draw nothing — the status word already said it.
 * Used by `PlanCard`'s head, as its clock slot.
 */
export function PlanClock({ plan }: { plan: DispatcherPlan }) {
  const { t } = useTranslation();
  const live = plan.status === 'live';
  const complete = plan.status === 'complete';
  // One interval at most, and none at all for a plan whose clock does not tick.
  const since = live ? walkingSince(plan) : complete ? epochOf(plan.completed_at) : null;
  const elapsed = useElapsed(since, complete ? 60_000 : 1_000);
  const startAt = plan.status === 'scheduled' ? epochOf(plan.schedule?.start_at ?? null) : null;

  const note = startAt !== null
    ? t('runner.schedule.starts', { time: scheduleClock(startAt) })
    : !elapsed ? '' : complete ? t('runner.ended', { elapsed }) : live ? elapsed : '';
  if (note === '') return null;
  return <span className="flex-none font-mono text-xs text-muted-foreground" data-dispatcher-clock>{note}</span>;
}

/**
 * The plan's GLANCE FACE — everything between its head and its verbs, in the order a glance reads it:
 * where it is (the track of its phases and one caption under it), what a pressed node says (its
 * receipt), what is moving now (`PlanNow`), and then, closed, the whole list and the log. What it has
 * COST is not here: the head carries the plan's total as pills (`PlanCard`), so the face does not
 * state it a second time.
 *
 * THE TRACK IS EVERY PHASE AT ONCE: one node a phase on one row (`StatusFlow`), marked `✓` done,
 * `▶︎` walking, `…` settling and by its position while not started, toned the way its row is
 * (`phaseWord`), filled as far as `phaseProgress` has got. A node pressed opens that phase's row
 * under the track with its stages open — the receipt — and pressed again closes it.
 *
 * THE PLAN'S POSTURE RIDES THE CAPTION (`plan.posture`, `width.word` of its two words): DeepSeek or
 * Claude — its own model word's route — and one at a time or all at once under whichever swarm switch
 * bounds it, `plan swarm …` when its own word does. Two plans on one screen can walk under different
 * postures, and a plan that sits still under `one at a time` is explained by its own.
 *
 * THE EVENT LOG IS THE CARD'S FEED, folded by default: the last thirty events, newest first —
 * time, kind, phase, detail. It is where a relaunch or a held take-up is read in the dispatcher's
 * own words.
 *
 * Used by `PlanCard`, inside its card's body.
 */
export function PlanFace({ plan }: { plan: DispatcherPlan }) {
  const { t } = useTranslation();
  const { route } = useDispatcherPlans();
  // The phase whose receipt is open under the track — the node the reader pressed, or none. This
  // card's own and nobody else's: pressing the same node again clears it.
  const [selected, setSelected] = useState<string | null>(null);
  // Whether the full phase list is open. It starts CLOSED, stated here and taken from no prop (see
  // the list below), and its rows are mounted only while it is open — a closed list is not fourteen
  // rows of stages and pills drawn into a clip on every card of the wall.
  const [listOpen, setListOpen] = useState(false);
  const progress = phaseProgress(plan);
  const nodes: LaneFlowNode[] = plan.phases.map((phase) => {
    const word = phaseWord(phase);
    return {
      key: phase.key,
      mark: word.mark,
      tone: word.tone,
      label: t('dispatcher.flow.node', { position: phase.position, title: phase.title, word: t(word.copy) }),
      live: word.key === 'running',
    };
  });
  const caption = [
    progress.total > 0 ? t('dispatcher.flow.caption', { done: progress.done, total: progress.total }) : '',
    t('dispatcher.rounds', { count: plan.rounds }),
    // THIS plan's width (`report.plan_dict`'s `posture`): its own route and whichever swarm switch
    // bounds it. The box's phrase stands in only against a dispatcher build older than the field.
    plan.posture ?? route?.word ?? '',
  ].filter(Boolean).join(' · ');
  const receipt = plan.phases.find((phase) => phase.key === selected) ?? null;
  const feed = plan.events.slice(-FEED_LIMIT).reverse();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <StatusFlow
          nodes={nodes}
          doneCount={progress.done}
          selected={receipt?.key ?? null}
          onSelect={(key) => setSelected((current) => (current === key ? null : key))}
          ariaLabel={t('dispatcher.flow.name', { plan: plan.name })}
        />
        <p className="min-w-0 break-words text-xs text-muted-foreground" data-flow-caption>{caption}</p>
      </div>

      {/* The receipt, keyed by its phase so each node pressed opens its row fresh, stages open. */}
      {receipt && (
        <div className="min-w-0 rounded-lg border border-border motion-safe:animate-shape-item" data-flow-receipt={receipt.key}>
          <PlanPhaseRow key={receipt.key} phase={receipt} open />
        </div>
      )}

      <PlanNow plan={plan} />

      {/* EVERY PHASE IS ON THE FACE ALREADY, as a node of the track, in both homes — so the full list
          is the second look, not the first, and it sits CLOSED. Closed is this face's own default
          (`listOpen`), stated here and taken from no prop: the tab and the gutter draw one face, and
          a home that could pass its own default could open or close the list for the other. A reader
          opens it on purpose; the card never does it for them. */}
      {plan.phases.length > 0 && (
        <Collapsible open={listOpen} onOpenChange={setListOpen} className="min-w-0" data-dispatcher-phases>
          <FaceTrigger>{t('dispatcher.allPhases', { count: plan.phases.length })}</FaceTrigger>
          <CollapsibleContent className="min-w-0">
            {listOpen && plan.phases.map((phase) => <PlanPhaseRow key={phase.key} phase={phase} />)}
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible className="min-w-0" data-dispatcher-events>
        <FaceTrigger>{t('dispatcher.events', { count: plan.events.length })}</FaceTrigger>
        <CollapsibleContent className="min-w-0">
          <ul className="flex flex-col gap-0.5 py-1 font-mono text-xs text-muted-foreground">
            {feed.map((event) => (
              <li key={event.id} className="whitespace-pre-wrap break-words px-2" data-dispatcher-event={event.kind}>
                {[clockOf(event.at), event.kind, event.phase ?? '', event.detail ?? ''].filter(Boolean).join('  ')}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The face's two closed disclosures' trigger: its words, and a chevron that turns when it opens. */
function FaceTrigger({ children }: { children: ReactNode }) {
  return (
    <CollapsibleTrigger className="group flex items-center gap-1 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
      <ChevronRight aria-hidden="true" className="size-3.5 flex-none group-data-[state=open]:rotate-90 motion-safe:transition-transform" />
      {children}
    </CollapsibleTrigger>
  );
}
