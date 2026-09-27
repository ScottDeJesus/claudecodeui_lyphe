import { useTranslation } from 'react-i18next';

import { clockOf, phaseStatusTone } from '@/modules/dispatcher/dispatcherState';
import { SpendPills } from '@/modules/dispatcher/SpendPills';
import { spendParts } from '@/shared/spend';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import type { DispatcherPhase, Tone } from '@/shared/types';

/** How a phase reads, decided once: its word's copy key, its tone, and its mark on the track. */
type PhaseWord = { key: 'running' | 'settling' | 'done' | 'notStarted'; copy: string; tone: Tone; mark: string };

/**
 * The word a phase wears, and the one place `settling` is decided. A `running` row whose walker is
 * no longer busy is a walk that ENDED and has not yet been settled by the rule — it is not moving,
 * so it must not wear the blue `running` a reader would take for work in flight: it is `neutral`,
 * and its mark is `…` rather than `▶︎`.
 *
 * The mark is the phase's sign on the plan's track: `✓` done, `▶︎` walking, `…` settling, and its
 * own position while it has not started — a number is what a reader counts along the row by.
 *
 * Used by this row, by `PlanFace` for the track's nodes and by `PlanNow` for its lines, so the three
 * can never disagree about whether a phase is moving.
 */
export function phaseWord(phase: DispatcherPhase): PhaseWord {
  if (phase.status === 'running') {
    return phase.busy
      ? { key: 'running', copy: 'dispatcher.phase.running', tone: phaseStatusTone(phase), mark: '▶︎' }
      : { key: 'settling', copy: 'dispatcher.settling', tone: 'neutral', mark: '…' };
  }
  if (phase.status === 'done') return { key: 'done', copy: 'dispatcher.phase.done', tone: phaseStatusTone(phase), mark: '✓' };
  return { key: 'notStarted', copy: 'dispatcher.phase.notStarted', tone: phaseStatusTone(phase), mark: String(phase.position) };
}

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
          <SpendPills parts={spendParts(phase.cost_usd, phase.tokens_in, phase.tokens_out, phase.tokens)} />
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
                <SpendPills parts={spendParts(stage.cost_usd, stage.tokens_in, stage.tokens_out, stage.tokens)} />
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
