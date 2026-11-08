import { useTranslation } from 'react-i18next';

import { epochOf, plannerStatusTone } from '@/modules/dispatcher/dispatcherState';
import { operatorWords, soulWord } from '@/modules/dispatcher/operatorWords';
import { useElapsed } from '@/shared/hooks/useElapsed';
import { Badge } from '@/shared/ui';
import type { DispatcherPlanner } from '@/shared/types';

/**
 * WHO IS OUT, ON WHAT MODEL, FOR HOW LONG — one planner outing, as one line of the shared `Badge`,
 * exactly as `PlanStatusBadge` draws a plan's own word.
 *
 * A SOUL IS OUT ON THIS PLAN, and that is a fact no other mark on the card states: the plan's status
 * word says what the PLAN is (`designing`), while the outing is what is being done about it and by
 * whom. The line reads `Eupalinos · designing · opus · 12m`.
 *
 * NOTHING HERE IS DERIVED. The soul and the model are the row's own words; the work word is the row's
 * `verb` and `state` read through the table below, the soul's name through `soulWord` (`operatorWords.ts`,
 * which the Planning card's lines read too); the clock is `useElapsed`, the app's ONE
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
 * Used on the head's lead row of `PlanCard` and `DispatchArcDeck`. Every outing, carried or loose, is also a
 * line of the Planning card (`PlanningCard`), which words it for a reader triaging what is being planned — but a
 * feature's while its epic's pause holds it, which the epic's own line says.
 */

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

/** One outing as its badge: the soul, the work, the model and — while it is queued or out — the clock. */
export function PlannerBadge({ planner }: { planner: DispatcherPlanner }) {
  const { t } = useTranslation();
  // Every `ended` entry the document carries is one whose work is still SHORT of a plan
  // (`report_planners.entries`), so the word below and the warning tone are the same reading of the
  // same row: nothing here has to ask the store a second question to tell a stall from a finish.
  const ended = planner.state === 'ended';
  const since = ended ? null : epochOf(planner.state === 'queued' ? planner.created_at : planner.launched_at);
  const elapsed = useElapsed(since);

  const work = ended
    ? planner.outcome === null
      ? t('dispatcher.planner.endedShort')
      : t('dispatcher.planner.endedShortCause', { outcome: operatorWords(planner.outcome) })
    : planner.state === 'queued'
      ? t('dispatcher.planner.queued')
      : t(WORK_KEYS[planner.verb]);

  const line = [soulWord(t, planner.soul), work, planner.model, elapsed]
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
