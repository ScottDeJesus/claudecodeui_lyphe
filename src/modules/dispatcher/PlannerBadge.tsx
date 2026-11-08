import type { TFunction } from 'i18next';
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
 * `verb`, `state`, `waiting` and `no_run` read through the functions below, the soul's name through `soulWord` (`operatorWords.ts`,
 * which the Planning card's lines read too); the clock is `useElapsed`, the app's ONE
 * spelling of elapsed (`PlanClock` reads it the same way, and the composer's clock before it); the
 * tone is `plannerStatusTone`, beside every other tone of this lane's vocabulary.
 *
 * WHY AN OUTING IS NOT RUNNING IS SAID IN ITS LINE, in the dispatcher's own two sentences (`report_planners._entry`), so a queued line is
 * never one the reader cannot account for:
 * - a QUEUED outing the take-up is passing over reads `queued · <waiting>` — Pause all, a planning pause, the outing it waits for. The
 *   pacer's clause is not among them: it rides with its Override on the line under the badge (`PaceOverride`) and is drawn once, there,
 *   so a `waiting` that IS the outing's own `pace_hold` stays out of this line;
 * - an outing the house says is NOT RUNNING (`no_run`: it tried to mend the claim and could not, or the launch was refused outright) reads
 *   `not running: <the house's sentence>` in the `danger` tone, whatever its state word would have been.
 * Both are house sentences relayed verbatim, so they pass through `operatorWords` where they are drawn.
 *
 * THE CLOCK COUNTS WHAT IS STILL HAPPENING, which is why an ENDED outing draws none, and neither does one the house says is not
 * running: the word that replaces its work (`ended short: <outcome>`, `not running: <sentence>`) already says what became of it,
 * and how long ago it died is the store's own `ended_at`, printed by `dispatcher status`. A queued outing has waited
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

/**
 * The take-up's reason a QUEUED outing waits, in the operator's words — or `''` when this line has none to say. The pacer's clause is
 * said once, with its Override, on the line under the badge (`PaceOverride`, from `plan.pace_hold` and `arc.pace_hold`), so a `waiting`
 * that IS this outing's own `pace_hold` is left out here. Every other hold (a planning pause, Pause all, the outing it waits for) has
 * no other home on the card and is said in the line.
 */
function waitingWords(planner: DispatcherPlanner): string {
  if (planner.waiting === '' || planner.waiting === planner.pace_hold) return '';
  return operatorWords(planner.waiting);
}

/**
 * The word that stands for the outing's work in its line. The house's own alert outranks every state word; an ended outing says what
 * became of it; a queued one says that it waits, and why when the take-up has a reason; one that is out says what it is doing.
 */
function workWord(t: TFunction, planner: DispatcherPlanner): string {
  if (planner.no_run !== '') return t('dispatcher.planner.notRunning', { reason: operatorWords(planner.no_run) });
  if (planner.state === 'ended') {
    return planner.outcome === null
      ? t('dispatcher.planner.endedShort')
      : t('dispatcher.planner.endedShortCause', { outcome: operatorWords(planner.outcome) });
  }
  if (planner.state === 'queued') {
    const waiting = waitingWords(planner);
    return waiting === '' ? t('dispatcher.planner.queued') : t('dispatcher.planner.queuedWaiting', { waiting });
  }
  return t(WORK_KEYS[planner.verb]);
}

/** One outing as its badge: the soul, the work, the model and — while it is queued or out and nothing says it is stuck — the clock. */
export function PlannerBadge({ planner }: { planner: DispatcherPlanner }) {
  const { t } = useTranslation();
  // Every `ended` entry the document carries is one whose work is still SHORT of a plan
  // (`report_planners.entries`), so the word below and the warning tone are the same reading of the
  // same row: nothing here has to ask the store a second question to tell a stall from a finish.
  const ended = planner.state === 'ended';
  const stuck = planner.no_run !== '';
  const since = ended || stuck ? null : epochOf(planner.state === 'queued' ? planner.created_at : planner.launched_at);
  const elapsed = useElapsed(since);

  const line = [soulWord(t, planner.soul), workWord(t, planner), planner.model, elapsed]
    .filter(Boolean)
    .join(' · ');

  return (
    <Badge
      tone={plannerStatusTone(planner)}
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
