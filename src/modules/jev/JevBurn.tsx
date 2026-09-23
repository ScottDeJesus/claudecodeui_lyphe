import { useTranslation } from 'react-i18next';

import { JevDayBars } from '@/modules/jev/JevDayBars';
import { count, toneGlyph, usd } from '@/modules/jev/jevFormat';
import type { JevDay, JevSummary, Tone } from '@/shared/types';
import { Badge, Tooltip } from '@/shared/ui';

type JevBurnProps = { balance: JevSummary['balance']; spend: JevSummary['spend']; days: JevDay[] };

/**
 * Used by JevPanel as its first block: the balance, the burn, and the last fourteen days.
 *
 * The balance is an ESTIMATE and is drawn as one — the `≈`, the word beside it, and the tooltip
 * that says why — because TypeSafe has no balance route: it is the seeded credit minus every priced
 * token this host has metered, purged rows included. Under a dollar left, the badge turns warn.
 * Unknown (no account file) is `—`, never `$0.00`: zero is a reading, and this is the lack of one.
 */
export function JevBurn({ balance, spend, days }: JevBurnProps) {
  const { t } = useTranslation();
  const low = balance !== null && balance.left_usd < 1;
  const tone: Tone = balance === null ? 'neutral' : low ? 'warn' : 'positive';
  const figures = [
    { key: 'today', label: t('jev.burn.today', { defaultValue: 'today' }), usd: spend.today_usd, calls: spend.today_calls },
    { key: 'week', label: t('jev.burn.week', { defaultValue: '7 days' }), usd: spend.week_usd, calls: spend.week_calls },
    { key: 'all', label: t('jev.burn.all', { defaultValue: 'all time' }), usd: spend.all_usd, calls: spend.all_calls },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-jev-balance>
        <span className="font-mono text-2xl font-semibold tabular-nums">{balance ? `≈ ${usd(balance.left_usd)}` : '—'}</span>
        <span className="text-sm text-muted-foreground">
          {balance
            ? t('jev.burn.leftOf', { defaultValue: 'left of {{credit}}', credit: usd(balance.credit_usd) })
            : t('jev.burn.unknown', { defaultValue: 'balance unknown — no account file to price from' })}
        </span>
        <Tooltip content={t('jev.burn.estimateTitle', { defaultValue: 'TypeSafe has no balance API — credit minus priced usage, including purged rows' })} position="bottom">
          <Badge as="span" tone={tone} data-jev-balance-badge>
            <span aria-hidden="true">{toneGlyph(tone)}</span>&nbsp;{t('jev.burn.estimate', { defaultValue: 'estimate' })}
          </Badge>
        </Tooltip>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {figures.map((figure) => (
          <div key={figure.key} className="min-w-0 rounded-lg border border-border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{figure.label}</dt>
            <dd className="font-mono text-lg tabular-nums">{usd(figure.usd)}</dd>
            <dd className="font-mono text-xs tabular-nums text-muted-foreground">{t('jev.burn.calls', { defaultValue: '{{n}} calls', n: count(figure.calls) })}</dd>
          </div>
        ))}
      </dl>

      <JevDayBars days={days} />
    </div>
  );
}
