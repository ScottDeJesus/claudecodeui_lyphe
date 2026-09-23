import { useTranslation } from 'react-i18next';

import { count, usd } from '@/modules/jev';
import type { DeepseekUsageSummary, Tone } from '@/shared/types';

/** The paired bars' height: each hour's taller bar is at most this. */
const PLOT_PX = 72;

/** A local `HH:00` for an hour's start, in the box's own zone like every day label on the tab. */
function hourLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The gap in words the operator can act on: which side is bigger, by how much, the sign spelled out. */
function gapLine(gap: number | null, t: (key: string, opts?: Record<string, unknown>) => string): { text: string; tone: Tone } {
  if (gap === null) return { text: t('deepseekUsage.recon.gapUnknown'), tone: 'neutral' };
  if (Math.abs(gap) < 0.005) return { text: t('deepseekUsage.recon.gapNone'), tone: 'positive' };
  const text = gap > 0 ? t('deepseekUsage.recon.gapOver', { usd: `+${usd(gap)}` }) : t('deepseekUsage.recon.gapUnder', { usd: `−${usd(-gap)}` });
  return { text, tone: 'warn' };
}

/**
 * Used by DeepseekUsagePanel as its sixth block: does the ledger's own pricing agree with what the
 * vendor's balance says was spent.
 *
 * ONLY COVERED HOURS ARE COMPARED — an hour in which two balance readings under fifteen minutes apart
 * landed — so a gap is never an artefact of a server that was down. Ledger and balance sit side by
 * side, the gap as a signed number in words under them (amber when they disagree, green when they
 * agree), then covered hours and readings, top-ups, and the hours as paired bars: ledger in the
 * primary tone, balance beside it muted, an uncovered hour's balance an empty slot on the baseline.
 * No readings is a sentence, not a zero; a non-USD balance is said, not converted.
 */
export function DeepseekRecon({ recon }: { recon: DeepseekUsageSummary['recon'] }) {
  const { t } = useTranslation();
  if (recon.readings === 0) {
    return <p className="text-sm text-muted-foreground" data-deepseek-recon-empty>{t('deepseekUsage.recon.noReadings')}</p>;
  }
  if (recon.currency !== null && recon.currency !== 'USD') {
    return <p className="text-sm text-muted-foreground">{t('deepseekUsage.recon.otherCurrency', { currency: recon.currency })}</p>;
  }
  const gap = gapLine(recon.gap_usd, t);
  const max = Math.max(0, ...recon.hours.map((hour) => Math.max(hour.ledger_usd, hour.balance_usd ?? 0)));
  const barHeight = (value: number) => (max > 0 && value > 0 ? Math.max(1, Math.round((value / max) * PLOT_PX)) : 1);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 [@container(min-width:40rem)]:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('deepseekUsage.recon.ledger')}</dt>
          <dd className="font-mono text-lg tabular-nums" data-deepseek-recon-ledger>{usd(recon.ledger_usd)}</dd>
        </div>
        <div className="min-w-0 rounded-lg border border-border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('deepseekUsage.recon.balance')}</dt>
          <dd className="font-mono text-lg tabular-nums" data-deepseek-recon-balance>{usd(recon.balance_usd)}</dd>
        </div>
        <div className="col-span-2 min-w-0 rounded-lg border border-border px-3 py-2 [@container(min-width:40rem)]:col-span-1" data-tone={gap.tone}>
          <dt className="text-xs text-muted-foreground">{t('deepseekUsage.recon.gap')}</dt>
          <dd className="text-sm text-[color:var(--tone-ink)]" data-deepseek-recon-gap>{gap.text}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{t('deepseekUsage.recon.covered', { hours: count(recon.covered_hours), readings: count(recon.readings) })}</span>
        <span>{t('deepseekUsage.recon.topups', { usd: usd(recon.topups_usd) })}</span>
        {recon.unassigned_usd > 0 && <span>{t('deepseekUsage.recon.unassigned', { usd: usd(recon.unassigned_usd) })}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" />{t('deepseekUsage.recon.legendLedger')}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted-foreground/50" />{t('deepseekUsage.recon.legendBalance')}</span>
        </div>
        <div className="flex items-end gap-1 border-b border-border" style={{ height: PLOT_PX }} role="list" aria-label={t('deepseekUsage.recon.label')}>
          {recon.hours.map((hour) => {
            const title = t('deepseekUsage.recon.hourTitle', { hour: hourLabel(hour.hour_start), ledger: usd(hour.ledger_usd), balance: usd(hour.balance_usd) });
            return (
              <div key={hour.hour_start} role="listitem" title={title} aria-label={title} className="flex min-w-0 flex-1 items-end gap-px">
                <div className="min-w-0 flex-1 rounded-t-sm bg-primary" style={{ height: barHeight(hour.ledger_usd) }} />
                <div
                  className={hour.balance_usd === null ? 'min-w-0 flex-1 border-t border-dashed border-muted-foreground/50' : 'min-w-0 flex-1 rounded-t-sm bg-muted-foreground/50'}
                  style={{ height: hour.balance_usd === null ? 1 : barHeight(hour.balance_usd) }}
                />
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t('deepseekUsage.recon.caption')}</p>
      </div>
    </div>
  );
}
