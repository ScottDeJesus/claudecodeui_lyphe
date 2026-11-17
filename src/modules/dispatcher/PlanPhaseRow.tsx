import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { clockOf } from '@/modules/dispatcher/dispatcherState';
import { phaseWord } from '@/modules/dispatcher/phaseWord';
import { RUN_KIND_TONE, roundsOf, runKindOf, verdictTone } from '@/modules/dispatcher/runWords';
import { SPEND_COLUMNS, SpendColumns } from '@/modules/dispatcher/SpendColumns';
import { spendParts } from '@/shared/spend';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import type { DispatcherPhase } from '@/shared/types';
import { cn } from '@/shared/utils';

/** A small badge, for the words inside a row of mono figures: a run's kind, its verdict, a task's rounds. */
const SMALL_BADGE = 'h-[18px] flex-none px-1.5 py-0 text-[10.5px] uppercase leading-[16px] tracking-[0.08em]';

/** The edge down a run's left side, in the colour of its kind, so a column of runs reads as build, review, fix before a word is read. */
const RUN_EDGE = { build: 'border-[var(--info-dot)]', fix: 'border-[var(--warn-dot)]', review: 'border-[var(--ink-faint)]' } as const;

/**
 * One phase of a plan, over the dispatcher's document. The mark, the position, the title and the
 * word lead; its assignee, its rounds and what it spent stand on a line under them; the stages the
 * phase walked fold away beneath, one line each, each ending in its own figures.
 *
 * THE DETAIL IS COLOUR CODED AND SET IN COLUMNS, so a task's runs are read at a glance:
 * - what kind of run: a build is info, a fix is warn (it went round again), a review is plain; each
 *   run wears an edge down its left side in the same colour (`runWords`). A stage of another name is
 *   shown as it is written;
 * - how it came out: PASS is positive, FAIL is danger, and a run still out on a walking task reads
 *   "running" in info. A verdict is free text and is drawn as written;
 * - rounds: one round is plain, two or more is warn, and each round is headed where it starts, a
 *   later one in warn;
 * - what it spent: three columns under one heading (in, cache, out), right-aligned so every row
 *   lines up (`SpendColumns`): the task's totals in a heavier weight on its own line, each run's
 *   under it. DOLLARS OR TOKENS, BY WHO WAS USED, as everywhere (`spendParts`): a run a vendor
 *   billed shows its dollars across the columns.
 *
 * EVERY STATE CARRIES A WORD AND A GLYPH, never colour alone, and every string — the title, a
 * soul's verdict — reaches the DOM as a text node: they are free text.
 *
 * `open` starts the stages open, for the receipt a pressed track node opens; in the full list they
 * start folded. Either way it is where the row STARTS — a reader may fold or unfold it after.
 *
 * Used by `PlanFace`, inside the card's phase list and as the receipt of a pressed track node.
 */
export function PlanPhaseRow({ phase, open = false }: { phase: DispatcherPhase; open?: boolean }) {
  const { t } = useTranslation();
  const word = phaseWord(phase);
  const rounds = roundsOf(phase.stages);
  const stageSpend = phase.stages.map((stage) => spendParts(stage.cost_usd, stage.tokens_in, stage.tokens_out, stage.tokens, stage.tokens_cache_read));
  // The heading names the three columns, so it stands only over rows that have them.
  const columned = stageSpend.some((parts) => parts.tokens?.kind === 'split');

  return (
    <Collapsible defaultOpen={open} className="min-w-0" data-dispatcher-phase={phase.key} data-phase-status={phase.status}>
      <CollapsibleTrigger className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left hover:bg-muted finger:min-h-11">
        {/* The track's own mark, so the receipt under a node leads with what the node shows; a phase
            not started leads with `·`, since its position follows. */}
        <span className="flex-none font-mono text-xs" aria-hidden="true">{word.key === 'notStarted' ? '·' : word.mark}</span>
        <span className="flex-none font-mono text-xs text-muted-foreground">{phase.position}</span>
        <span className="min-w-0 flex-1 break-words text-sm leading-snug">{phase.title}</span>
        <Badge as="span" tone={word.tone} className="flex-none">{t(word.copy)}</Badge>
        {/* Its books, on a line of their own under the title so they stand over its runs' figures: who has it, how
            many rounds it took, then what it spent, decided the one way (`spendParts`). A phase that has not walked
            yet has no rounds and no spend, and the line is its assignee alone, never a `$0.00`. */}
        <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-phase-books>
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{phase.assignee}</span>
          {phase.rounds > 0 && (
            <Badge as="span" tone={phase.rounds > 1 ? 'warn' : 'neutral'} className={SMALL_BADGE} data-phase-rounds={phase.rounds}>
              {t('dispatcher.rounds', { count: phase.rounds })}
            </Badge>
          )}
          <SpendColumns parts={spendParts(phase.cost_usd, phase.tokens_in, phase.tokens_out, phase.tokens, phase.tokens_cache_read)} vendor={phase.paid_vendor} sum />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {phase.stages.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t('dispatcher.noStages')}</p>
        ) : (
          <ul className="flex flex-col gap-1 px-2 py-1 font-mono text-xs text-muted-foreground">
            {columned && (
              <li aria-hidden="true" className="flex justify-end" data-spend-heads>
                <span className={cn(SPEND_COLUMNS, 'text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]')}>
                  <span>{t('dispatcher.columns.in')}</span>
                  <span>{t('dispatcher.columns.cache')}</span>
                  <span>{t('dispatcher.columns.out')}</span>
                </span>
              </li>
            )}
            {phase.stages.map((stage, index) => {
              const kind = runKindOf(stage.name);
              // Out and unanswered, on a task that is walking: the one run that can still be said to be running.
              const out = word.key === 'running' && stage.launched_at !== null && stage.returned_at === null && stage.verdict === null;
              const opensRound = phase.rounds > 1 && (index === 0 || rounds[index] !== rounds[index - 1]);
              return (
                <Fragment key={`${stage.launch_id ?? stage.name}-${index}`}>
                  {opensRound && (
                    <li
                      data-dispatcher-round={rounds[index]}
                      className={cn('pt-0.5 text-[10px] uppercase tracking-[0.08em]', rounds[index] > 1 ? 'text-warn-ink' : 'text-[var(--ink-faint)]')}
                    >
                      {t('dispatcher.round', { n: rounds[index] })}
                    </li>
                  )}
                  {/* The stage's clock, kind, soul and verdict are its words; its spend ends the line in
                      the columns: the stage's bill or its tokens, whichever half it has, or none. */}
                  <li
                    className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-l-2 py-0.5 pl-2', kind === null ? 'border-border' : RUN_EDGE[kind])}
                    data-dispatcher-stage
                    data-run-kind={kind ?? undefined}
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="flex-none text-[var(--ink-faint)]">{clockOf(stage.launched_at)}</span>
                      {kind === null
                        ? <span className="min-w-0 break-words">{stage.name}</span>
                        : <Badge as="span" tone={RUN_KIND_TONE[kind]} className={cn(SMALL_BADGE, 'min-w-[3.25rem] text-center')} title={stage.name}>{t(`dispatcher.run.${kind}`)}</Badge>}
                      {stage.soul && <span className="min-w-0 break-all">{stage.soul}</span>}
                      {stage.verdict
                        ? <Badge as="span" tone={verdictTone(stage.verdict)} className={cn(SMALL_BADGE, 'h-auto min-h-[18px] min-w-0 whitespace-pre-wrap break-words normal-case tracking-normal')} data-run-verdict>{stage.verdict}</Badge>
                        : out && <Badge as="span" tone="info" className={SMALL_BADGE} data-run-verdict="running">{t('dispatcher.run.running')}</Badge>}
                    </span>
                    <SpendColumns parts={stageSpend[index]} vendor={stage.paid_vendor} />
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
