import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { count, pct, seconds, tokens, usd } from '@/modules/jev/jevFormat';
import type { JevConsumer, JevRange, JevSummary } from '@/shared/types';
import { Badge, Pill, PillBar } from '@/shared/ui';
import { cn } from '@/shared/utils';

const RANGES: JevRange[] = ['today', '7d', '30d', 'all'];

type SortKey = 'caller' | 'calls' | 'tokens' | 'usd' | 'share' | 'avg_latency_s' | 'unavailable' | 'cache_hits' | 'refusals';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'caller', label: 'caller', numeric: false },
  { key: 'calls', label: 'calls', numeric: true },
  { key: 'tokens', label: 'tokens', numeric: true },
  { key: 'usd', label: '$', numeric: true },
  { key: 'share', label: 'share', numeric: true },
  { key: 'avg_latency_s', label: 'avg latency', numeric: true },
  { key: 'unavailable', label: 'unavailable', numeric: true },
  { key: 'cache_hits', label: 'cache hits', numeric: true },
  { key: 'refusals', label: 'refusals', numeric: true },
];

/** A null (unpriced, no latency) sorts under every number, whichever way the column runs. */
function sorted(rows: JevConsumer[], sort: Sort): JevConsumer[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'caller') return sign * a.caller.localeCompare(b.caller);
    const av = a[sort.key] ?? Number.NEGATIVE_INFINITY;
    const bv = b[sort.key] ?? Number.NEGATIVE_INFINITY;
    if (av !== bv) return sign * (av - bv);
    // A tie breaks the way the reader orders: calls desc, then caller asc.
    return b.calls - a.calls || a.caller.localeCompare(b.caller);
  });
}

type JevConsumersProps = {
  consumers: JevConsumer[];
  top: JevSummary['top'];
  /** The range's own totals — the denominator every share in the table is a share of. */
  totals: JevSummary['totals'];
  range: JevRange;
  onRangeChange: (next: JevRange) => void;
  /** A caller pressed in the table: the feed filters to it. */
  onPickCaller: (caller: string) => void;
};

/**
 * Used by JevPanel as its third block: who spends the most, readable in one glance.
 *
 * The HEADLINE says it before the table does — the top caller, its share, the range — so nobody adds
 * a column up. The range picker sits here because these are the numbers a range changes. The table
 * is hand-built (the kit has no table): numbers right-aligned in tabular figures, every header a
 * button with `aria-sort`, a numeric column sorting descending on its first press, the share as an
 * inline bar. Sort and the open row are this component's own UI state, not the reader's.
 */
export function JevConsumers({ consumers, top, totals, range, onRangeChange, onPickCaller }: JevConsumersProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<Sort>({ key: 'tokens', dir: 'desc' });
  const [open, setOpen] = useState<string | null>(null);
  const rangeWord = (key: JevRange) => t(`jev.consumers.range.${key}`, { defaultValue: key });
  const onSort = (key: SortKey, numeric: boolean) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: numeric ? 'desc' : 'asc' }));
  const noAsks = t('jev.consumers.noAsks', { defaultValue: 'no description yet' });
  const rows = sorted(consumers, sort);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0" data-jev-top>
          {top ? (
            <>
              <p className="text-base font-medium">
                <span className="font-mono">{top.caller}</span>
                {' — '}
                {t('jev.consumers.ofSpend', { defaultValue: '{{share}} of spend ({{range}})', share: pct(top.share), range: rangeWord(range) })}
              </p>
              <p className="text-sm text-muted-foreground">{top.asks ?? noAsks}</p>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                {t('jev.consumers.rangeTotal', { defaultValue: 'of {{usd}} · {{tokens}} tok · {{calls}} calls ({{range}})', usd: usd(totals.usd), tokens: tokens(totals.tokens), calls: count(totals.calls), range: rangeWord(range) })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('jev.consumers.noTop', { defaultValue: 'No priced call in this range' })}</p>
          )}
        </div>
        <PillBar role="group" aria-label={t('jev.consumers.rangeLabel', { defaultValue: 'Range' })} data-jev-range>
          {RANGES.map((key) => (
            <Pill key={key} isActive={range === key} onClick={() => onRangeChange(key)} data-jev-range-pill={key}>
              <span className="text-xs">{rangeWord(key)}</span>
            </Pill>
          ))}
        </PillBar>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('jev.consumers.empty', { defaultValue: 'No caller in this range' })}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-jev-consumers>
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
                        {t(`jev.consumers.columns.${col.key}`, { defaultValue: col.label })}
                        <span aria-hidden="true" className={cn('text-[10px]', !active && 'invisible')}>{active && sort.dir === 'asc' ? '▲' : '▼'}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = open === row.caller;
                const verbs = Object.entries(row.verbs);
                return (
                  <Fragment key={row.caller}>
                    <tr className="border-b border-border/60 align-top" data-jev-consumer={row.caller}>
                      <td className="max-w-[18rem] py-1.5 pr-3">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={t(expanded ? 'jev.consumers.collapse' : 'jev.consumers.expand', { defaultValue: expanded ? 'Hide the verbs of {{caller}}' : 'Show the verbs of {{caller}}', caller: row.caller })}
                            onClick={() => setOpen(expanded ? null : row.caller)}
                            className="w-4 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {expanded ? '▾' : '▸'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onPickCaller(row.caller)}
                            title={t('jev.consumers.pick', { defaultValue: 'Show only {{caller}} in the feed', caller: row.caller })}
                            className="truncate font-mono text-xs hover:underline"
                          >
                            {row.caller}
                          </button>
                        </div>
                        <div className="truncate pl-5 text-xs text-muted-foreground" title={row.asks ?? undefined}>{row.asks ?? noAsks}</div>
                      </td>
                      <Num>{count(row.calls)}</Num>
                      <Num>{tokens(row.tokens)}</Num>
                      <Num>{usd(row.usd)}</Num>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded bg-muted" aria-hidden="true">
                            <div className="h-full rounded bg-primary/60" style={{ width: `${Math.round(row.share * 100)}%` }} />
                          </div>
                          <span className="font-mono tabular-nums">{pct(row.share)}</span>
                        </div>
                      </td>
                      <Num>{seconds(row.avg_latency_s)}</Num>
                      <Num>
                        {row.unavailable > 0 ? (
                          <Badge as="span" tone="warn" className="font-mono tabular-nums"><span aria-hidden="true">▲</span>&nbsp;{count(row.unavailable)}</Badge>
                        ) : count(row.unavailable)}
                      </Num>
                      <Num>{count(row.cache_hits)}</Num>
                      <Num>{count(row.refusals)}</Num>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border/60 bg-muted/30" data-jev-consumer-verbs={row.caller}>
                        <td colSpan={COLUMNS.length} className="px-5 py-2 text-xs">
                          {verbs.length === 0 ? (
                            <span className="text-muted-foreground">{t('jev.consumers.noVerbs', { defaultValue: 'no priced call — cache hits and refusals only' })}</span>
                          ) : (
                            <ul className="flex flex-wrap gap-x-6 gap-y-1">
                              {verbs.map(([verb, tally]) => (
                                <li key={verb} className="font-mono tabular-nums">
                                  {verb} · {count(tally.calls)} · {tokens(tally.tokens)} tok · {usd(tally.usd)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
