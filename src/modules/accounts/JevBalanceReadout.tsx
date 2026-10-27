import { JevLogo } from '@/shared/ui/JevLogo';
import { cn } from '@/shared/utils';
import type { JevBalance } from '@/modules/accounts/hooks/useJevBalance';

/** The em-dash that stands for "no account seeded" — never `$0.00`, which is a reading. */
const NO_FIGURE = '—';

const usd = (amount: number, digits = 2) =>
  `$${amount.toLocaleString([], { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

type JevBalanceReadoutProps = {
  balance: JevBalance | null;
};

/**
 * What is left of the Jev (TypeSafe) credit.
 * Used by the accounts module's AccountPanelBody, under the DeepSeek balance and its rate line.
 *
 * Unlike that figure this one is NOT the vendor's: TypeSafe publishes no balance route, so it is
 * the credit the operator seeded (`~/.claude/state/jev_account.json`) minus what this host metered
 * on its own calls. The `≈` and the note say so, because a key used anywhere else spends money
 * this screen cannot see.
 */
export function JevBalanceReadout({ balance }: JevBalanceReadoutProps) {
  const figure = balance ? `≈ ${usd(balance.leftUsd)}` : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="flex items-center gap-1.5 self-center text-[13px] font-medium text-foreground">
          <JevLogo className="h-4 w-4" />
          Jev balance
        </span>
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
