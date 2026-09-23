import { useTranslation } from 'react-i18next';

import { count, tokens, usd } from '@/modules/jev';
import type { DeepseekDay } from '@/shared/types';
import { cn } from '@/shared/utils';

/** The plot's height, the same as the Jev view's so the two burn charts read at one scale. */
const PLOT_PX = 96;

/** `2026-09-19` → `Sep 19`, built from the parts so the box's own zone never shifts the day. */
function dateLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Used by DeepseekBurn: the last fourteen local days of DeepSeek spend as bars, drawn the way
 * JevDayBars draws Jev's — one series (per-row dollars), a ruled zero baseline, the tallest bar the
 * whole plot with its max printed, today solid and the rest muted, a zero day a one-pixel stub so a
 * quiet day never reads as a missing one. Each bar carries its whole reading, the list figure
 * included, as its title.
 */
export function DeepseekDayBars({ days }: { days: DeepseekDay[] }) {
  const { t } = useTranslation();
  const max = Math.max(0, ...days.map((day) => day.usd));
  const total = days.reduce((sum, day) => sum + day.usd, 0);
  const outings = days.reduce((sum, day) => sum + day.outings, 0);
  const last = days.length - 1;

  return (
    <div className="flex flex-col gap-1" data-deepseek-daybars>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{t('deepseekUsage.chart.max', { value: usd(max) })}</span>
        <span>{t('deepseekUsage.chart.series')}</span>
        <span className="font-mono tabular-nums">{t('deepseekUsage.chart.total', { value: usd(total), outings: count(outings) })}</span>
      </div>
      <div
        className="flex items-end gap-1 border-b border-border"
        style={{ height: PLOT_PX }}
        role="list"
        aria-label={t('deepseekUsage.chart.label')}
      >
        {days.map((day, i) => {
          const height = max > 0 && day.usd > 0 ? Math.max(1, Math.round((day.usd / max) * PLOT_PX)) : 1;
          const title = t('deepseekUsage.chart.barTitle', {
            date: dateLabel(day.day), outings: count(day.outings), tokens: tokens(day.tokens), usd: usd(day.usd), list: usd(day.usd_list),
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
