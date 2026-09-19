import { cn } from '@/shared/utils';
import type { JevBalance } from '@/modules/accounts/hooks/useJevBalance';

/** The em-dash that stands for "no account seeded" — never `$0.00`, which is a reading. */
const NO_FIGURE = '—';

const usd = (amount: number, digits = 2) =>
  `$${amount.toLocaleString([], { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

type JevBalanceReadoutProps = {
  balance: JevBalance | null;
  /** The same two registers as `DeepseekBalanceReadout`, which this sits directly under. */
  variant?: 'stacked' | 'inline';
};

/**
 * What is left of the Jev (TypeSafe) credit.
 * Used by the accounts module twice, directly under the DeepSeek balance in both registers.
 *
 * Unlike that figure this one is NOT the vendor's: TypeSafe publishes no balance route, so it is
 * the credit the operator seeded (`~/.claude/state/jev_account.json`) minus what this host metered
 * on its own calls. The `≈` and the note say so, because a key used anywhere else spends money
 * this screen cannot see.
 */
export function JevBalanceReadout({ balance, variant = 'stacked' }: JevBalanceReadoutProps) {
  const figure = balance ? `≈ ${usd(balance.leftUsd)}` : null;
  const sentence = balance
    ? `Jev balance, estimated: ${usd(balance.leftUsd)} left of ${usd(balance.creditUsd)} seeded; ${usd(balance.spentUsd)} metered on this host.`
    : 'Jev balance: no credit seeded in jev_account.json.';

  if (variant === 'inline') {
    return (
      <span className="flex min-w-0 items-baseline gap-1.5 text-xs" title={sentence} aria-label={sentence}>
        <span className="flex-none text-ink-faint">Jev</span>
        <span className={cn('truncate tabular-nums', figure ? 'text-muted-foreground' : 'text-ink-faint')}>
          {figure ?? NO_FIGURE}
        </span>
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-foreground">Jev balance</span>
        <span className={cn('ml-auto text-[12.5px] tabular-nums', figure ? 'text-muted-foreground' : 'text-ink-faint')}>
          {figure ?? NO_FIGURE}
        </span>
      </div>
      <span className="text-xs leading-relaxed text-ink-faint">
        {balance
          ? `${usd(balance.spentUsd)} of ${usd(balance.creditUsd)} spent, metered here. TypeSafe has no balance API.`
          : 'No credit seeded.'}
      </span>
    </div>
  );
}
