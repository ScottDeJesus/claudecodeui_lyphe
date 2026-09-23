import { useTranslation } from 'react-i18next';

import { PHASE_GLYPH } from '@/modules/plan-runner/runState';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import type { RunnerPhaseState } from '@/shared/types';
import { cn } from '@/shared/utils';

/** One phase as the list draws it — the shape a live run's `RunnerPhaseRow` already satisfies. */
type ArcPhaseItem = { id: string; title: string; state: RunnerPhaseState };

/**
 * Rows shown before the rest folds behind "+N more": enough for a whole small plan, and few enough
 * that a 24-phase card does not tower over its neighbours in a strip where every card shares one
 * height.
 */
const VISIBLE_PHASES = 8;

/**
 * A card's phases, one compact line each: the run card's own mark (`PHASE_GLYPH` — ✅ for shipped,
 * `·` still to come), the phase's id and its title. The mark is a glyph, never a hue, and the
 * state's WORD rides beside it for a screen reader, so the row reads without colour at all.
 *
 * NOT `PhaseRow`. That row is a disclosure over a run's timeline with a state badge and a clock; a
 * card that has no run has no timeline to disclose, and eight badges would not fit an 18rem card.
 * The live card's detailed row stays in its run strip; this list is the whole plan at a glance.
 *
 * `[]` is a plan not written yet — one muted line, never an empty frame. `currentId` marks the
 * phase a live run stands on (`aria-current`). Handles for the browser harness: `data-arc-phase`
 * (the id), `data-arc-phase-state`, and `data-arc-no-phases`.
 *
 * Used by `ArcCard`, for every card's face.
 */
export function ArcPhaseList({ phases, currentId }: { phases: ArcPhaseItem[]; currentId: string | null }) {
  const { t } = useTranslation();

  if (phases.length === 0) {
    return <p data-arc-no-phases className="text-xs italic text-muted-foreground">{t('runner.arcNoPhases')}</p>;
  }

  const row = (phase: ArcPhaseItem) => (
    <li
      key={phase.id}
      data-arc-phase={phase.id}
      data-arc-phase-state={phase.state}
      aria-current={phase.id === currentId ? 'step' : undefined}
      title={phase.title}
      // `relative` is load-bearing: it is the containing block of the row's `sr-only` span (absolute),
      // so a FOLDED row's span is clipped with its row instead of escaping to the strip — the strip
      // is the nearest positioned ancestor otherwise, and the span would stretch it into a vertical
      // scroller.
      className={cn('relative flex min-w-0 items-baseline gap-1.5 text-xs leading-snug', phase.id === currentId && 'font-medium')}
    >
      <span className="w-4 flex-none text-center font-mono" aria-hidden="true">{PHASE_GLYPH[phase.state]}</span>
      <span className="flex-none font-mono text-muted-foreground">{phase.id}</span>
      <span className={cn('line-clamp-2 min-w-0 flex-1 break-words', phase.state === 'shipped' && 'text-muted-foreground')}>
        {phase.title}
      </span>
      <span className="sr-only">{t(`runner.phase.${phase.state}`)}</span>
    </li>
  );

  const shown = phases.slice(0, VISIBLE_PHASES);
  const folded = phases.slice(VISIBLE_PHASES);

  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-arc-phases>
      <ol className="flex min-w-0 flex-col gap-0.5">{shown.map(row)}</ol>
      {folded.length > 0 && (
        <Collapsible className="min-w-0">
          <CollapsibleContent>
            <ol className="flex min-w-0 flex-col gap-0.5">{folded.map(row)}</ol>
          </CollapsibleContent>
          {/* One trigger, two words: the Collapsible's own `data-state` picks which is shown, so
              the list keeps no state of its own. */}
          <CollapsibleTrigger className="group mt-0.5 text-xs text-muted-foreground hover:text-foreground">
            <span className="group-data-[state=open]:hidden">{t('runner.arcMorePhases', { n: folded.length })}</span>
            <span className="hidden group-data-[state=open]:inline">{t('runner.arcFewerPhases')}</span>
          </CollapsibleTrigger>
        </Collapsible>
      )}
    </div>
  );
}
