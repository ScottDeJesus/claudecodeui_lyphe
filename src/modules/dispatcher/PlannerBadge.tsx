import { useTranslation } from 'react-i18next';

import { epochOf, plannerStatusTone } from '@/modules/dispatcher/dispatcherState';
import { useElapsed } from '@/shared/hooks/useElapsed';
import { Badge } from '@/shared/ui';
import type { DispatcherPlanner } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * WHO IS OUT, ON WHAT MODEL, FOR HOW LONG — one planner outing, as one line of the shared `Badge`,
 * exactly as `PlanStatusBadge` draws a plan's own word.
 *
 * A SOUL IS OUT ON THIS PLAN, and that is a fact no other mark on the card states: the plan's status
 * word says what the PLAN is (`designing`), while the outing is what is being done about it and by
 * whom. The line reads `Eupalinos v3 · designing · opus · 12m`.
 *
 * NOTHING HERE IS DERIVED. The soul and the model are the row's own words; the work word is the row's
 * `verb` and `state` read through the two tables below; the clock is `useElapsed`, the app's ONE
 * spelling of elapsed (`PlanClock` reads it the same way, and the composer's clock before it); the
 * tone is `plannerStatusTone`, beside every other tone of this lane's vocabulary.
 *
 * THE CLOCK COUNTS WHAT IS STILL HAPPENING, which is why an ENDED outing draws none: the word that
 * replaces its work (`ended short: <outcome>`) already says what became of it, and how long ago it
 * died is the store's own `ended_at`, printed by `dispatcher status`. A queued outing has waited
 * since it was WRITTEN, one that is out since it FORKED — the store's own two stamps, never a third
 * computation here.
 *
 * `data-planner-badge`, `data-planner-target`, `data-planner-soul` and `data-planner-state` are the
 * browser harness's handles, so a probe reads one outing's mark without reading the card's text.
 *
 * Used by `PlanCard`'s header and `DispatchArcDeck`'s header (`PlannerBadge`), and by the Runner tab's
 * two homes for the outings that have no card and no deck to be drawn in (`LoosePlannerBadges`).
 */

/**
 * The soul's name as a reader says it, by the store's own id — and an id this build has never heard of
 * falls back to the id ITSELF (below), because a soul nobody has translated is still a soul to name.
 */
const SOUL_KEYS: Record<string, string> = {
  'eupalinos-v3': 'dispatcher.planner.soul.eupalinosV3',
  'odysseus-v3': 'dispatcher.planner.soul.odysseusV3',
};

/**
 * What the outing is doing while it is OUT, by its verb — a total table, because the verb is a closed
 * set the store writes. `design` and `tell` are one word on purpose: a `tell` resumes the very session
 * a `design` opened (the same outing continued), so a reader sees the same work being done.
 */
const WORK_KEYS: Record<DispatcherPlanner['verb'], string> = {
  design: 'dispatcher.planner.designing',
  tell: 'dispatcher.planner.designing',
  judge: 'dispatcher.planner.judging',
  cut: 'dispatcher.planner.cutting',
};

/**
 * `SOUL_KEYS` read as an OWN property, or `undefined` — which is what the fallback below tests.
 *
 * A PLAIN LOOKUP ANSWERS FOR EVERY MEMBER `Object.prototype` CARRIES: `SOUL_KEYS['__proto__']` is
 * `Object.prototype` and `['constructor']` is `Object`, so an id that collided with one of those would
 * never be `undefined`, the fallback would not fire, and i18next would be handed an OBJECT — the badge
 * drawing `[object Object]` where the soul's own id belongs. No row the store writes can name such a
 * soul today (`planners.queue_planner` vets a planner's verb against `souls.PLANNER_AGENTS`), and this
 * is the one word that keeps that a fact rather than a hope about a future soul id. The house's own
 * idiom, the shape `SidebarSessionIcon` and `kanban-attachments.service` read their tables with.
 *
 * `WORK_KEYS` needs no such reading: its key set is the CLOSED union `planner.verb`, refused by name in
 * the reader (`dispatcher-planner.reader.ts`), so nothing can reach it that the literal does not hold.
 */
function soulKeyOf(soul: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(SOUL_KEYS, soul) ? SOUL_KEYS[soul] : undefined;
}

/** One outing as its badge: the soul, the work, the model and — while it is queued or out — the clock. */
export function PlannerBadge({ planner }: { planner: DispatcherPlanner }) {
  const { t } = useTranslation();
  // Every `ended` entry the document carries is one whose work is still SHORT of a plan
  // (`report_planners.entries`), so the word below and the warning tone are the same reading of the
  // same row: nothing here has to ask the store a second question to tell a stall from a finish.
  const ended = planner.state === 'ended';
  const since = ended ? null : epochOf(planner.state === 'queued' ? planner.created_at : planner.launched_at);
  const elapsed = useElapsed(since);

  const soulKey = soulKeyOf(planner.soul);
  const work = ended
    ? planner.outcome === null
      ? t('dispatcher.planner.endedShort')
      : t('dispatcher.planner.endedShortCause', { outcome: planner.outcome })
    : planner.state === 'queued'
      ? t('dispatcher.planner.queued')
      : t(WORK_KEYS[planner.verb]);

  const line = [soulKey === undefined ? planner.soul : t(soulKey), work, planner.model, elapsed]
    .filter(Boolean)
    .join(' · ');

  return (
    <Badge
      tone={plannerStatusTone(planner.state)}
      className="min-w-0 max-w-full break-words font-mono text-xs"
      data-planner-badge
      data-planner-target={planner.target}
      data-planner-soul={planner.soul}
      data-planner-state={planner.state}
    >
      {line}
    </Badge>
  );
}

/**
 * The outings with no card and no deck to be drawn in, one badge each, in the lane's own order.
 *
 * AN ARC'S DESIGN BEFORE ITS ARC FILE LOADS IS THE CASE THIS EXISTS FOR: `dispatcher design <arc>.v3
 * --arc` writes a planner row for a name the store holds no arc for yet, and until the arc's own file
 * is loaded no plan and no arc on the screen answers to it. The row is the ONLY thing that says an arc
 * is being designed, so the tab and the gutter draw it above the decks rather than nowhere
 * (`useDispatcherPlans` answers which entries those are).
 *
 * IT DRAWS NOTHING AT ALL WHEN THERE ARE NONE, and returns `null` rather than an empty row: an
 * operator who was never in this state sees the pane exactly as it was before badges existed.
 *
 * Used by `RunnerPanel` (the tab) and `RunnerWidgetBody` (the gutter), immediately above
 * `DispatchArcDecks`, whose own two homes these are.
 */
export function LoosePlannerBadges({
  planners,
  home = 'tab',
}: {
  /** The entries that name no plan and no arc the lane draws (`useDispatcherPlans`). */
  planners: readonly DispatcherPlanner[];
  /** The home's own width, exactly as `DispatchArcDecks` takes it: the tab centres a measured column, the gutter is flush. */
  home?: 'tab' | 'gutter';
}) {
  if (planners.length === 0) return null;
  return (
    <ul
      data-loose-planners
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-2',
        // The same column `DispatchArcDecks` opens for itself in the tab, so a badge stands over the
        // decks it belongs to rather than at the pane's own edge.
        home === 'tab' && 'mx-auto w-full max-w-2xl px-4 pt-5',
      )}
    >
      {planners.map((planner) => (
        <li key={planner.id} className="min-w-0">
          <PlannerBadge planner={planner} />
        </li>
      ))}
    </ul>
  );
}
