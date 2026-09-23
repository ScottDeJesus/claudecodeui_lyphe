import { useTranslation } from 'react-i18next';

import { count, tokens, usd } from '@/modules/jev/jevFormat';
import type { JevDay } from '@/shared/types';
import { cn } from '@/shared/utils';

/** The plot's height: the tallest bar is exactly this, every other bar its share of it. */
const PLOT_PX = 96;

/** `2026-09-19` → `Sep 19`, built from the parts so the box's own zone never shifts the day. */
function dateLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Used by JevBurn: the last fourteen local days as bars, hand-built from divs.
 *
 * ONE SERIES. Dollars per day, or tokens per day when the days are unpriced — and the caption says
 * which. Bars grow from a zero baseline (the plot's bottom edge, ruled), the tallest is the whole
 * plot and the max is printed, today's bar is solid and the rest are muted, and a zero day is a
 * one-pixel stub on the baseline so a quiet day never reads as a missing one. Every bar carries its
 * whole reading as a title, so no number here needs a second chart.
 */
export function JevDayBars({ days }: { days: JevDay[] }) {
  const { t } = useTranslation();
  const priced = days.length > 0 && days.every((day) => day.usd !== null);
  const valueOf = (day: JevDay): number => (priced ? day.usd ?? 0 : day.tokens);
  const format = (value: number): string => (priced ? usd(value) : tokens(value));
  const values = days.map(valueOf);
  const max = Math.max(0, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const calls = days.reduce((sum, day) => sum + day.calls, 0);
  const last = days.length - 1;
  const seriesLabel = priced
    ? t('jev.chart.seriesUsd', { defaultValue: '$ per day' })
    : t('jev.chart.seriesTokens', { defaultValue: 'tokens per day — no price on file' });

  return (
    <div className="flex flex-col gap-1" data-jev-daybars>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{t('jev.chart.max', { defaultValue: 'max {{value}}', value: format(max) })}</span>
        <span>{seriesLabel}</span>
        <span className="font-mono tabular-nums">{t('jev.chart.total', { defaultValue: '14 days · {{value}} · {{calls}} calls', value: format(total), calls: count(calls) })}</span>
      </div>
      <div
        className="flex items-end gap-1 border-b border-border"
        style={{ height: PLOT_PX }}
        role="list"
        aria-label={t('jev.chart.label', { defaultValue: 'Spend by day, the last 14 days' })}
      >
        {days.map((day, i) => {
          const value = valueOf(day);
          const height = max > 0 && value > 0 ? Math.max(1, Math.round((value / max) * PLOT_PX)) : 1;
          const title = t('jev.chart.barTitle', {
            defaultValue: '{{date}} · {{calls}} calls · {{tokens}} tok · {{usd}}',
            date: dateLabel(day.day), calls: count(day.calls), tokens: tokens(day.tokens), usd: usd(day.usd),
          });
          return (
            <div
              key={day.day}
              role="listitem"
              title={title}
              aria-label={title}
              className={cn('min-w-0 flex-1 rounded-t-sm transition-opacity hover:opacity-80', i === last ? 'bg-primary' : 'bg-primary/40')}
              style={{ height }}
            />
          );
        })}
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {days.map((day, i) => (
          <span key={day.day} className="min-w-0 flex-1 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
            {(last - i) % 2 === 0 ? Number(day.day.slice(8)) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
