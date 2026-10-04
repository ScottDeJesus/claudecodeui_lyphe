import { useTranslation } from 'react-i18next';

import { DeepseekDayBars } from '@/modules/deepseek-spend/DeepseekDayBars';
import { ago, count, pct, usd } from '@/modules/jev';
import type { DeepseekUsageSummary, Tone } from '@/shared/types';
import { Badge } from '@/shared/ui';

type DeepseekBurnProps = Pick<DeepseekUsageSummary, 'balance' | 'spend' | 'days' | 'pricing' | 'ledger'>;

/** `[[1, 4], [6, 10]]` → `01:00–04:00 and 06:00–10:00`. */
function windows(peak: [number, number][]): string {
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return peak.map(([from, to]) => `${hh(from)}–${hh(to)}`).join(' and ');
}

/**
 * Used by DeepseekUsagePanel as its first block: the balance, the burn, and the last fourteen days.
 *
 * The balance here is the VENDOR'S OWN reading — unlike Jev's estimate — so it carries no `≈`, only
 * the age of the reading. No reading yet is `—` and a sentence, never `$0.00`. The spend figures lead
 * with the per-row dollars — what the outings really cost, priced per window, the same figure a run
 * receipt and a heal booked since 2026-09-23 carry, `costs.result_cost` sending a child here too — and
 * the peak-list figure sits small beside each as the rate those dollars were halved from. A heal booked
 * BEFORE that date is the one exception, and it is not this panel's: it carries its chain's whole bill,
 * the Claude stages it rode included, which no vendor ledger ever billed.
 * The balance-measured drop sits under them when a pair of readings has measured one.
 */
export function DeepseekBurn({ balance, spend, days, pricing, ledger }: DeepseekBurnProps) {
  const { t } = useTranslation();
  const tone: Tone = balance === null ? 'neutral' : balance.available ? 'positive' : 'warn';
  const figures = [
    { key: 'today', usd: spend.today_usd, list: spend.today_list_usd, outings: spend.today_outings },
    { key: 'week', usd: spend.week_usd, list: spend.week_list_usd, outings: spend.week_outings },
    { key: 'all', usd: spend.all_usd, list: spend.all_list_usd, outings: spend.all_outings },
  ];
  const measured = spend.today_balance_usd !== null || spend.week_balance_usd !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-deepseek-balance>
        <span className="font-mono text-2xl font-semibold tabular-nums">{balance ? usd(balance.total) : '—'}</span>
        <span className="text-sm text-muted-foreground">
          {balance
            ? t('deepseekUsage.burn.asOf', { currency: balance.currency, when: ago(balance.checked_at) })
            : t('deepseekUsage.burn.noReading')}
        </span>
        {balance && (
          <Badge as="span" tone={tone} data-deepseek-balance-badge>
            <span aria-hidden="true">{balance.available ? '✓' : '▲'}</span>&nbsp;
            {balance.available ? t('deepseekUsage.burn.available') : t('deepseekUsage.burn.unavailable')}
          </Badge>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {figures.map((figure) => (
          <div key={figure.key} className="min-w-0 rounded-lg border border-border px-3 py-2" data-deepseek-spend={figure.key}>
            <dt className="text-xs text-muted-foreground">{t(`deepseekUsage.burn.${figure.key}`)}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-lg tabular-nums">{usd(figure.usd)}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{t('deepseekUsage.burn.list', { usd: usd(figure.list) })}</span>
            </dd>
            <dd className="font-mono text-xs tabular-nums text-muted-foreground">{t('deepseekUsage.burn.outings', { n: count(figure.outings) })}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p className="font-mono tabular-nums" data-deepseek-measured>
          {measured
            ? t('deepseekUsage.burn.measured', { today: usd(spend.today_balance_usd), week: usd(spend.week_balance_usd) })
            : t('deepseekUsage.burn.measuredNone')}
        </p>
        <p data-deepseek-pricing>
          {t('deepseekUsage.burn.pricing', { windows: windows(pricing.peak_utc), offPeak: pct(pricing.off_peak_factor) })}
        </p>
        {ledger.unpriced_models.length > 0 && (
          <p className="text-[color:var(--tone-ink)]" data-tone="warn">
            <span aria-hidden="true">▲</span> {t('deepseekUsage.burn.unpriced', { models: ledger.unpriced_models.join(', ') })}
          </p>
        )}
      </div>

      <DeepseekDayBars days={days} />
    </div>
  );
}
