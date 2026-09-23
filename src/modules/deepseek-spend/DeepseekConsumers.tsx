import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { count, pct, tokens, usd } from '@/modules/jev';
import type { DeepseekConsumer, DeepseekRange, DeepseekUsageSummary } from '@/shared/types';
import { Pill, PillBar } from '@/shared/ui';
import { cn } from '@/shared/utils';

const RANGES: DeepseekRange[] = ['today', '7d', '30d', 'all'];

type SortKey = 'kind' | 'name' | 'outings' | 'input' | 'output' | 'cache_read' | 'cache_write' | 'usd' | 'share';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const COLUMNS: { key: SortKey; numeric: boolean }[] = [
  { key: 'kind', numeric: false },
  { key: 'name', numeric: false },
  { key: 'outings', numeric: true },
  { key: 'input', numeric: true },
  { key: 'output', numeric: true },
  { key: 'cache_read', numeric: true },
  { key: 'cache_write', numeric: true },
  { key: 'usd', numeric: true },
  { key: 'share', numeric: true },
];

function sorted(rows: DeepseekConsumer[], sort: Sort): DeepseekConsumer[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'kind' || sort.key === 'name') return sign * a[sort.key].localeCompare(b[sort.key]) || a.name.localeCompare(b.name);
    const diff = a[sort.key] - b[sort.key];
    // A tie breaks the way the reader orders: $ desc, then name asc.
    return diff !== 0 ? sign * diff : b.usd - a.usd || a.name.localeCompare(b.name);
  });
}

type DeepseekConsumersProps = Pick<DeepseekUsageSummary, 'consumers' | 'top' | 'kinds' | 'totals'> & {
  range: DeepseekRange;
  onRangeChange: (next: DeepseekRange) => void;
};

/**
 * Used by DeepseekUsagePanel as its second block: who spends the most, readable in one glance.
 *
 * Shaped after JevConsumers: the HEADLINE names the top consumer and its share before the table
 * does, the range picker sits here because these are the numbers a range changes, and the table is
 * hand-built — every header a button with `aria-sort`, a numeric column sorting descending on its
 * first press, default $ descending, the share as an inline bar. A consumer is a (kind, name) pair:
 * a run by its plan, a chain or heal by its slug, a wave by its id, a stray session by its project.
 * The kinds strip above the table is the same spend folded one level up.
 */
export function DeepseekConsumers({ consumers, top, kinds, totals, range, onRangeChange }: DeepseekConsumersProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort>({ key: 'usd', dir: 'desc' });
  const rangeWord = (key: DeepseekRange) => t(`deepseekUsage.range.${key}`);
  const kindWord = (key: string) => t(`deepseekUsage.kind.${key}`, { defaultValue: key });
  const onSort = (key: SortKey, numeric: boolean) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: numeric ? 'desc' : 'asc' }));
  const rows = sorted(consumers, sort);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0" data-deepseek-top>
          {top ? (
            <>
              <p className="text-base font-medium">
                <span className="font-mono">{top.name}</span>
                {' — '}
                {t('deepseekUsage.consumers.ofSpend', { share: pct(top.share), range: rangeWord(range) })}
              </p>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                {t('deepseekUsage.consumers.rangeTotal', { usd: usd(totals.usd), list: usd(totals.usd_list), tokens: tokens(totals.tokens), outings: count(totals.outings), range: rangeWord(range) })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('deepseekUsage.consumers.noTop')}</p>
          )}
        </div>
        <PillBar role="group" aria-label={t('deepseekUsage.range.label')} data-deepseek-range>
          {RANGES.map((key) => (
            <Pill key={key} isActive={range === key} onClick={() => onRangeChange(key)} data-deepseek-range-pill={key}>
              <span className="text-xs">{rangeWord(key)}</span>
            </Pill>
          ))}
        </PillBar>
      </div>

      {kinds.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('deepseekUsage.consumers.kinds')} data-deepseek-kinds>
          {kinds.map((kind) => (
            <li key={kind.key} className="flex min-w-0 items-baseline gap-2 rounded-lg border border-border px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">{kindWord(kind.key)}</span>
              <span className="font-mono tabular-nums">{usd(kind.usd)}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{pct(kind.share)} · {count(kind.outings)}</span>
            </li>
          ))}
        </ul>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('deepseekUsage.consumers.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-deepseek-consumers>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {COLUMNS.map((col) => {
                  const active = sort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cn('whitespace-nowrap py-1.5 pr-3 font-medium', col.numeric ? 'text-right' : 'text-left')}
                    >
                      <button type="button" onClick={() => onSort(col.key, col.numeric)} className="inline-flex items-center gap-1 hover:text-foreground">
                        {t(`deepseekUsage.consumers.columns.${col.key}`)}
                        <span aria-hidden="true" className={cn('text-[10px]', !active && 'invisible')}>{active && sort.dir === 'asc' ? '▲' : '▼'}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}:${row.name}`} className="border-b border-border/60" data-deepseek-consumer={`${row.kind}:${row.name}`}>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">{kindWord(row.kind)}</td>
                  <td className="max-w-[18rem] truncate py-1.5 pr-3 font-mono text-xs" title={row.name}>{row.name}</td>
                  <Num>{count(row.outings)}</Num>
                  <Num>{tokens(row.input)}</Num>
                  <Num>{tokens(row.output)}</Num>
                  <Num>{tokens(row.cache_read)}</Num>
                  <Num>{tokens(row.cache_write)}</Num>
                  <Num>{usd(row.usd)}</Num>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded bg-muted" aria-hidden="true">
                        <div className="h-full rounded bg-primary/60" style={{ width: `${Math.round(row.share * 100)}%` }} />
                      </div>
                      <span className="font-mono tabular-nums">{pct(row.share)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A number cell: right-aligned, tabular, one line. */
function Num({ children }: { children: ReactNode }) {
  return <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono tabular-nums">{children}</td>;
}
