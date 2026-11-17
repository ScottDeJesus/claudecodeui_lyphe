import { RotateCw } from 'lucide-react';

import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { ClaudeAccountRows } from '@/modules/accounts/ClaudeAccountRows';
import { DeepseekBalanceReadout } from '@/modules/accounts/DeepseekBalanceReadout';
import { DeepseekPeakHours } from '@/modules/accounts/DeepseekPeakHours';
import { JevBalanceReadout } from '@/modules/accounts/JevBalanceReadout';
import { UsageMeters } from '@/modules/accounts/UsageMeters';
import { accountInUseUsage } from '@/modules/accounts/utils/accountInUseUsage';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { Banner, Button } from '@/shared/ui';

/** Said in words, because an empty panel would otherwise read as "you have no accounts". */
const UNREACHABLE_LINE = 'The server could not read accounts or usage — both are unknown.';

/**
 * The account panel's body, top to bottom: a dial for each usage window of the account in use, every account the door holds with its
 * week as a ring and its one act, the automatic switch, the two balances and the rate on a line each, and the door's sign-in. Drawn as the panel's own children,
 * with no chrome of its own — a fragment, so whoever stands it up supplies the box and the column its sections sit in.
 *
 * Used by the accounts module's AccountPopover (the account switcher every account ring opens) and by AccountsWidgetBody, in the
 * Accounts gutter widget. It takes no props: both read the one state `AccountsProvider` holds, so the two homes cannot disagree about
 * the account in use or a figure on it.
 *
 * Codex is deliberately absent — these are the Claude accounts the door holds, and Codex stays in Settings → Agents (D6).
 */
export function AccountPanelBody() {
  const { accounts, usage, balance, jevBalance, busy, error, onRelogin, onUse, onSetAuto, onRemove, onSetup } = useAccountsContext();
  // Advances once a minute so the reset countdowns stay true while the panel is showing. The interval exists only
  // for as long as this component does, and this component is mounted only while a home of the panel is open.
  const now = useMinuteTick();
  const unknown = accounts !== null && !accounts.reachable;
  // The dials draw the account in use — the chosen account, else the live login — which is not
  // always the login `/api/usage` measured. This is the one conversion; UsageMeters draws what it is given.
  const metersUsage = accountInUseUsage(usage, accounts, now);

  return (
    <>
      {unknown ? <p className="text-xs leading-relaxed text-muted-foreground">{UNREACHABLE_LINE}</p> : <UsageMeters usage={metersUsage} />}

      {/* The account section: one row per account and the automatic switch, with the acts the row's hooks hand it. It renders
          nothing until the first answer lands — a lane that cannot answer is its own calm line inside the section, never a
          blank space. */}
      <ClaudeAccountRows
        picture={accounts}
        busy={busy}
        nowMs={now}
        onUse={onUse}
        onSetAuto={onSetAuto}
        onRemove={onRemove}
        onSetup={onSetup}
      />

      {/* OUTSIDE the dials' branch above on purpose. This reading comes from another vendor and another
          route, so a reading that cannot answer must not take it down with them — the two fail
          independently, and the panel is where a person checks the money precisely when
          something else has stopped. */}
      <div className="flex flex-col">
        <div className="flex items-center gap-2 pb-1" role="heading" aria-level={3}>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Balances</span>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
        <DeepseekBalanceReadout balance={balance} />
        <DeepseekPeakHours now={now} />
        <JevBalanceReadout balance={jevBalance} />
      </div>

      <div className="flex flex-col gap-2">
        {/* The panel's one sign-in door: it signs the box's own login in again. Closing its window
            re-reads the panel, where a new live identity appears as a "Set up" row — the sign-in
            itself changed no account the door holds. */}
        <div className="flex">
          <Button variant="outline" size="sm" className="finger:h-11 finger:w-11 finger:px-0" disabled={busy} aria-label="Re-login" title="Re-login" onClick={onRelogin}>
            <RotateCw className="hidden finger:block" />
            <span className="finger:hidden">Re-login</span>
          </Button>
        </div>

        {error && (
          <Banner tone="warn">
            <span className="text-xs">{error}</span>
          </Banner>
        )}
      </div>
    </>
  );
}
