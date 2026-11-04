import { JevLogo } from '@/shared/ui/JevLogo';
import { cn } from '@/shared/utils';
import type { JevBalance } from '@/modules/accounts/hooks/useJevBalance';

/** The em-dash that stands for every unknown — no account seeded, or a figure the reply left out — never `$0.00`, which is a reading. */
const NO_FIGURE = '—';

/** One dollar figure as money, or the em-dash for an unknown one: `0` is a real reading and draws `$0.00`. */
const usd = (amount: number | null) =>
  amount === null ? NO_FIGURE : `$${amount.toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The line under the figure: what was spent of what credit, an unknown half drawn as an em-dash beside the half that arrived. */
function noteInWords(balance: JevBalance | null): string {
  if (!balance) return 'No credit seeded.';
  // All three unknown is not an estimate of nothing, it is a reply this app could not read — and `— of — spent` does not say so.
  if (balance.creditUsd === null && balance.spentUsd === null && balance.leftUsd === null) {
    return 'Balance unknown — the summary carried no readable figure.';
  }
  return `${usd(balance.spentUsd)} of ${usd(balance.creditUsd)} spent, metered here. TypeSafe has no balance API.`;
}

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
  const figure = balance && balance.leftUsd !== null ? `≈ ${usd(balance.leftUsd)}` : null;

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
      <span className="text-xs leading-relaxed text-ink-faint">{noteInWords(balance)}</span>
    </div>
  );
}
