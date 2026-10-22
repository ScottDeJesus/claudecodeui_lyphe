import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StateBadge } from '@/modules/carrier-bulletins/StateBadge';
import { carrierStanding, STANDING_LOOK } from '@/modules/carrier-bulletins/utils/bulletinModel';
import { fileWords, pageSplitWords, pullWords, readingWords, rulesWords, standingWords } from '@/modules/carrier-bulletins/utils/bulletinWords';
import type { OverviewRow } from '@/shared/carrier-bulletins-types';
import { cn } from '@/shared/utils';

type CarrierRowProps = {
  row: OverviewRow;
  /** The row's place in its group, which staggers its entrance. */
  index: number;
  onOpen: (bulletinId: string) => void;
};

/** The rows' stagger, Cerberus's 45 ms a row, capped so a long group is not still arriving seconds later. */
const STAGGER_MS = 45;
const STAGGER_ROWS = 12;

/**
 * ONE CARRIER on the overview, the whole row its press target, read top to bottom:
 * 1. the carrier's name, and its standing as a badge in a word and a colour: "1 page waiting" or "Reading stopped" in the
 *    tone for act, "Not settled yet" or "Not read yet" while Claude is not done, "Settled" calm;
 * 2. its current file: the bulletin's number and the day it was stored;
 * 3. its pages, by need: waiting, not read, read and not settled, settled, and how many were carried from an earlier
 *    file because their content did not change;
 * 4. what the file holds in the rules: requirements live, open questions, duties not placed;
 * 5. quieter, beside them once the panel is wide: the last pull (when, and what it brought) and the last reading (when,
 *    how it ended, the model, its calls and its tokens). A pull that failed says so in the warn ink.
 *
 * Names, never ids (INV-76): the carrier, its bulletin number, its dates.
 *
 * Used by the carrier-bulletins module's `OverviewScreen`, one per carrier in each group.
 */
export function CarrierRow({ row, index, onOpen }: CarrierRowProps) {
  const { t } = useTranslation();
  const pullFailed = row.last_pull !== null && row.last_pull.outcome.startsWith('failed');
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row.bulletin_id)}
        style={{ animationDelay: `${Math.min(index, STAGGER_ROWS) * STAGGER_MS}ms` }}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-background focus-visible:[outline-offset:-2px] motion-safe:animate-[vv-rise_.4s_theme(transitionTimingFunction.enter)_both]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="min-w-0 text-[15px] font-medium text-foreground [overflow-wrap:anywhere]">{row.carrier}</span>
            <StateBadge look={STANDING_LOOK[carrierStanding(row)]} words={standingWords(row, t)} />
          </span>
          <span className="grid gap-x-8 gap-y-0.5 tabular-nums [@container(min-width:720px)]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <span className="flex min-w-0 flex-col gap-0.5 text-[13px]">
              <span className="text-muted-foreground">{fileWords(row, t)}</span>
              <span className="text-foreground">{pageSplitWords(row, t)}</span>
              <span className="text-muted-foreground">{rulesWords(row, t)}</span>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 text-[12.5px] text-muted-foreground">
              <span className={cn(pullFailed && 'text-warn-ink')}>{pullWords(row.last_pull, t)}</span>
              <span>{readingWords(row.last_reading, t)}</span>
            </span>
          </span>
        </span>
        <ChevronRight className="mt-1 size-4 flex-none text-ink-faint" aria-hidden="true" />
      </button>
    </li>
  );
}
