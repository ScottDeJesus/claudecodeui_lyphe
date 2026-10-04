import { useTranslation } from 'react-i18next';

import { clockOf } from '@/modules/dispatcher/dispatcherState';
import { phaseWord } from '@/modules/dispatcher/phaseWord';
import { SpendPills } from '@/modules/dispatcher/SpendPills';
import { spendParts } from '@/shared/spend';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import type { DispatcherPhase } from '@/shared/types';

/**
 * One phase of a plan, over the dispatcher's document. The mark, the position, the title and the
 * word lead; the rounds, the spend pills and the assignee follow; the stages the phase walked fold
 * away beneath, one line each, each ending in its own pills.
 *
 * EVERY STATE CARRIES A WORD AND A GLYPH, never colour alone (design doctrine :147-149), and every
 * string — the title, a soul's verdict — reaches the DOM as a text node: they are free text.
 *
 * `open` starts the stages open, for the receipt a pressed track node opens; in the full list they
 * start folded. Either way it is where the row STARTS — a reader may fold or unfold it after.
 *
 * Used by `PlanFace`, inside the card's phase list and as the receipt of a pressed track node.
 */
export function PlanPhaseRow({ phase, open = false }: { phase: DispatcherPhase; open?: boolean }) {
  const { t } = useTranslation();
  const word = phaseWord(phase);

  return (
    <Collapsible defaultOpen={open} className="min-w-0" data-dispatcher-phase={phase.key} data-phase-status={phase.status}>
      <CollapsibleTrigger className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
        {/* The track's own mark, so the receipt under a node leads with what the node shows; a phase
            not started leads with `·`, since its position follows. */}
        <span className="flex-none font-mono text-xs" aria-hidden="true">{word.key === 'notStarted' ? '·' : word.mark}</span>
        <span className="flex-none font-mono text-xs text-muted-foreground">{phase.position}</span>
        <span className="min-w-0 flex-1 basis-40 break-words text-sm leading-snug">{phase.title}</span>
        <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
          <Badge as="span" tone={word.tone} className="min-w-0 break-words">{t(word.copy)}</Badge>
          <span className="min-w-0 break-words font-mono text-xs text-muted-foreground">
            {t('dispatcher.rounds', { count: phase.rounds })}
          </span>
          {/* The phase's own books as pills, decided the one way (`spendParts`): paid dollars where an
              API billed them, its CLAUDE records' tokens — DOLLARS **OR** TOKENS, BY WHO WAS USED, so
              a phase the vendor walked has no token pills and one on the subscription no `$` pill. A
              phase that has not walked yet has neither and draws no pill at all, never a `$0.00`. The
              row wraps, so three pills at 390px take a second line rather than overrunning the fold. */}
          <SpendPills parts={spendParts(phase.cost_usd, phase.tokens_in, phase.tokens_out, phase.tokens, phase.tokens_cache_read)} />
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{phase.assignee}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {phase.stages.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t('dispatcher.noStages')}</p>
        ) : (
          <ul className="flex flex-col gap-1 py-1 font-mono text-xs text-muted-foreground">
            {phase.stages.map((stage, index) => (
              // The stage's clock, name, soul and verdict are its words; its spend ends the line as its
              // own pills — the stage's bill or its tokens, whichever half it has, or none.
              <li
                key={`${stage.launch_id ?? stage.name}-${index}`}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2"
                data-dispatcher-stage
              >
                <span className="min-w-0 whitespace-pre-wrap break-words">
                  {[clockOf(stage.launched_at), stage.name, stage.soul ?? '', stage.verdict ?? ''].filter(Boolean).join('  ')}
                </span>
                <SpendPills parts={spendParts(stage.cost_usd, stage.tokens_in, stage.tokens_out, stage.tokens, stage.tokens_cache_read)} />
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
