import { useTranslation } from 'react-i18next';

import { cachePercent, humanizeTokens, moneyText } from '@/shared/spend';
import type { SpendParts } from '@/shared/types';
import { cn } from '@/shared/utils';

/** The three columns every row of figures shares, so each figure stands under the one above it: tokens in, the cache's share, tokens out. */
export const SPEND_COLUMNS = 'inline-grid flex-none grid-cols-[3.5rem_2rem_3.5rem] gap-x-1.5 text-right font-mono text-xs tabular-nums whitespace-nowrap';

/**
 * A SPEND FIGURE SET IN COLUMNS, for the rows of a task and its runs, where the same three figures repeat down the card and
 * are compared by eye. It draws the halves `spendParts` decided, the same decision the pills draw (`SpendPills`), so a row
 * and a pill can never disagree about what a record has:
 *
 * - tokens split: in, the share of it read from the cache, out, each in its own column and its own ink (in is the info
 *   ink, out the strong ink, the cache share the faint one), so a column reads down the card in one colour;
 * - paid dollars: the figure and the vendor that billed it, across the columns (a paid record has no tokens to show);
 * - a total with no split: the total, across the columns;
 * - neither: nothing is drawn, never a zero nobody measured.
 *
 * `sum` sets a task's own totals in a heavier weight than its runs' figures under them. The words a reader hears are the
 * pills' own (`dispatcher.pill.*`), on a visually hidden node; the arrows are for the eye.
 *
 * Every element is phrasing content: a task's row draws these inside its fold's trigger button.
 *
 * Used by `PlanPhaseRow`, on a task's line and on each of its runs' lines.
 */
export function SpendColumns({ parts, vendor, sum = false }: { parts: SpendParts; vendor: string | null; sum?: boolean }) {
  const { t } = useTranslation();
  const { paid, tokens } = parts;
  if (paid === null && tokens === null) return null;

  const share = tokens?.kind === 'split' ? cachePercent(tokens.cacheRead, tokens.in) : null;
  const paidWords = paid === null ? null : vendor ? t('runner.paid', { usd: moneyText(paid), vendor }) : t('runner.paidAlone', { usd: moneyText(paid), defaultValue: '${{usd}}' });

  return (
    <span data-spend-columns className={cn('ml-auto inline-flex flex-none items-baseline gap-2', sum && 'font-semibold')}>
      {paidWords !== null && (
        <span data-spend-column="paid" className="font-mono text-xs tabular-nums text-foreground">{paidWords}</span>
      )}
      {tokens?.kind === 'split' && (
        <span className={SPEND_COLUMNS}>
          <span aria-hidden="true" data-spend-column="in" className="text-[var(--info-ink)]">↓ {humanizeTokens(tokens.in)}</span>
          <span aria-hidden="true" data-spend-column="cache" className="font-normal text-[var(--ink-faint)]">{share === null ? '' : `${share}%`}</span>
          <span aria-hidden="true" data-spend-column="out" className="text-[var(--ink-strong)]">↑ {humanizeTokens(tokens.out)}</span>
          <span className="sr-only">
            {[
              t('dispatcher.pill.in', { n: humanizeTokens(tokens.in) }),
              share === null ? null : t('dispatcher.pill.cache', { pct: share }),
              t('dispatcher.pill.out', { n: humanizeTokens(tokens.out) }),
            ].filter(Boolean).join(' ')}
          </span>
        </span>
      )}
      {tokens?.kind === 'total' && (
        <span data-spend-column="tokens" className="font-mono text-xs tabular-nums text-muted-foreground">⛁ {t('dispatcher.pill.tokens', { n: humanizeTokens(tokens.total) })}</span>
      )}
    </span>
  );
}
