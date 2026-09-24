import { useTranslation } from 'react-i18next';

import { PlanPhaseRow } from '@/modules/dispatcher/PlanPhaseRow';
import { clockOf, epochOf, phaseProgress, planStatusTone, scheduleClock } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { spendText } from '@/modules/plan-runner';
import { useElapsed } from '@/shared/hooks/useElapsed';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger, Meter } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';

/**
 * A v3 plan as its card draws it, in pieces with no frame of their own — `RunFace`'s pieces over
 * the dispatcher's document. What moves the plan is next door (`PlanControls.tsx`).
 *
 * EVERY STRING REACHES THE DOM AS A TEXT NODE. A goal, a phase title, a verdict and an event's
 * detail are free text the dispatcher and its souls wrote; none of it meets a raw-HTML sink.
 */

/** How many of the plan's events the feed shows — the newest, newest first. */
const FEED_LIMIT = 30;

/** The plan's one word, toned by `planStatusTone`. Used by `PlanCard`'s header. */
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
 * Used by `PlanCard`'s header.
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
 * Everything between the plan's word and its verbs: how far it has got, what it has cost, the
 * route the box walks it on, its phases, and its own log.
 *
 * THE ROUTE RIDES THE METER'S SUB-LINE because it is the box's and not the plan's: DeepSeek or
 * Claude, one at a time or all at once, is the posture every plan on this screen walks under, and
 * a plan that sits still under `one at a time` is explained by it.
 *
 * THE EVENT LOG IS THE CARD'S FEED, folded by default: the last thirty events, newest first —
 * time, kind, phase, detail. It is where a relaunch or a held take-up is read in the dispatcher's
 * own words.
 *
 * Used by `PlanCard`, inside its card's body.
 */
export function PlanFace({ plan, defaultOpen }: { plan: DispatcherPlan; defaultOpen: boolean }) {
  const { t } = useTranslation();
  const { route } = useDispatcherPlans();
  const progress = phaseProgress(plan);
  // What the plan has spent: its PAID dollars (`$0.41 DeepSeek`, labelled by what was billed) and
  // its CLAUDE records' tokens — A SPEND FIGURE IS DOLLARS **OR** TOKENS, BY WHO WAS USED, so a
  // plan the vendor billed everywhere shows the `$` and no tokens, one walked on the operator's
  // Claude subscription shows the tokens and no `$` at all (never a `$0.00`), and a mixed one
  // shows both, its token half counting the Claude stages only. `spend.ts` owns the rule, so this
  // card, the run card and the soul pins cannot spell it three ways.
  const spend = spendText(t, plan.cost_usd, plan.tokens_in, plan.tokens_out, plan.tokens);
  const sub = [spend, t('dispatcher.rounds', { count: plan.rounds }), route?.word ?? '']
    .filter(Boolean).join(' · ');
  const feed = plan.events.slice(-FEED_LIMIT).reverse();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Meter
        percent={progress.percent}
        tone="accent"
        label={t('runner.phases')}
        value={`${progress.done} / ${progress.total}`}
        sub={sub}
      />

      <Collapsible defaultOpen={defaultOpen} className="min-w-0">
        <CollapsibleTrigger className="rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
          {t('dispatcher.phaseCount', { count: plan.phases.length })}
        </CollapsibleTrigger>
        <CollapsibleContent className="min-w-0">
          {plan.phases.map((phase) => <PlanPhaseRow key={phase.key} phase={phase} />)}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible className="min-w-0" data-dispatcher-events>
        <CollapsibleTrigger className="rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
          {t('dispatcher.events', { count: plan.events.length })}
        </CollapsibleTrigger>
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
