import { useTranslation } from 'react-i18next';

import { clockOf, PHASE_GLYPH, phaseStatusTone } from '@/modules/dispatcher/dispatcherState';
import { spendText } from '@/shared/spend';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import type { DispatcherPhase } from '@/shared/types';

/**
 * The word a phase wears, and the one place `settling` is decided. A `running` row whose walker is
 * no longer busy is a walk that ENDED and has not yet been settled by the rule — it is not moving,
 * so it must not wear the blue `running` a reader would take for work in flight.
 */
function phaseWord(phase: DispatcherPhase): { key: string; settling: boolean } {
  if (phase.status === 'running') return phase.busy ? { key: 'running', settling: false } : { key: 'settling', settling: true };
  return { key: phase.status === 'done' ? 'done' : 'notStarted', settling: false };
}

/**
 * One phase of a plan, over the dispatcher's document. The mark, the position, the title and the
 * word lead; the spend and the assignee follow; the stages the phase walked fold away beneath, one
 * line each.
 *
 * EVERY STATE CARRIES A WORD AND A GLYPH, never colour alone (design doctrine :147-149), and every
 * string — the title, a soul's verdict — reaches the DOM as a text node: they are free text.
 *
 * Used by `PlanFace`, inside the card's phase list.
 */
export function PlanPhaseRow({ phase }: { phase: DispatcherPhase }) {
  const { t } = useTranslation();
  const word = phaseWord(phase);
  const tone = word.settling ? 'neutral' : phaseStatusTone(phase);
  const label = word.settling ? t('dispatcher.settling') : t(`dispatcher.phase.${word.key}`);
  // The phase's own books, read the one way (`spend.ts`): paid dollars where an API billed them,
  // its CLAUDE records' tokens — DOLLARS **OR** TOKENS, BY WHO WAS USED, so a phase the vendor
  // walked shows no tokens and one on the subscription shows no `$`. A phase that has not walked
  // yet has neither, and the line loses the field rather than wearing a `$0.00`.
  const spend = spendText(t, phase.cost_usd, phase.tokens_in, phase.tokens_out, phase.tokens);
  const books = [t('dispatcher.rounds', { count: phase.rounds }), spend].filter(Boolean).join(' · ');

  return (
    <Collapsible className="min-w-0" data-dispatcher-phase={phase.key} data-phase-status={phase.status}>
      <CollapsibleTrigger className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
        <span className="flex-none font-mono text-xs" aria-hidden="true">{PHASE_GLYPH[phase.status]}</span>
        <span className="flex-none font-mono text-xs text-muted-foreground">{phase.position}</span>
        <span className="min-w-0 flex-1 basis-40 break-words text-sm leading-snug">{phase.title}</span>
        <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
          <Badge as="span" tone={tone} className="min-w-0 break-words">{label}</Badge>
          {/* Shrinkable, so a long split (`2.6M in · 24.2k out`) wraps at 390px instead of overrunning
              the fold and being clipped by its `overflow: hidden`. */}
          <span className="min-w-0 break-words font-mono text-xs text-muted-foreground">
            {books}
          </span>
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{phase.assignee}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {phase.stages.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t('dispatcher.noStages')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 py-1 font-mono text-xs text-muted-foreground">
            {phase.stages.map((stage, index) => (
              <li key={`${stage.launch_id ?? stage.name}-${index}`} className="whitespace-pre-wrap break-words px-2" data-dispatcher-stage>
                {[clockOf(stage.launched_at), stage.name, stage.soul ?? '', stage.verdict ?? '',
                  spendText(t, stage.cost_usd, stage.tokens_in, stage.tokens_out, stage.tokens)]
                  .filter(Boolean).join('  ')}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
