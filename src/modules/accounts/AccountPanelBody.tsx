import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { ClaudeAccountRows } from '@/modules/accounts/ClaudeAccountRows';
import { DeepseekBalanceReadout } from '@/modules/accounts/DeepseekBalanceReadout';
import { DeepseekPeakHours } from '@/modules/accounts/DeepseekPeakHours';
import { JevBalanceReadout } from '@/modules/accounts/JevBalanceReadout';
import { UsageMeters } from '@/modules/accounts/UsageMeters';
import { accountInUseUsage } from '@/modules/accounts/utils/accountInUseUsage';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { Banner } from '@/shared/ui';

/** Said in words, because an empty panel would otherwise read as "you have no accounts". */
const UNREACHABLE_LINE = 'The server could not read accounts or usage — both are unknown.';

/**
 * The account panel's body: what the account in use has spent, the two balances, one row per account the door
 * holds, and the door's sign-in window. Drawn as the panel's own children, with no chrome of its own — a fragment, so
 * whoever stands it up supplies the box and the column (`flex flex-col gap-3`) its sections sit in.
 *
 * Used by the accounts module's AccountPopover, in the card the rail button opens, and by AccountsWidgetBody, in the
 * Accounts gutter widget. It takes no props: both read the one state `AccountsProvider` holds, so the two homes
 * cannot disagree about the account in use or a figure on it.
 *
 * Codex is deliberately absent — these are the Claude accounts the door holds, and Codex stays in Settings → Agents (D6).
 */
export function AccountPanelBody() {
  const { accounts, usage, balance, jevBalance, busy, error, onRelogin, onUse, onSetAuto, onRemove, onSetup } = useAccountsContext();
  // Advances once a minute so the reset countdowns stay true while the panel is showing. The interval exists only
  // for as long as this component does, and this component is mounted only while a home of the panel is open.
  const now = useMinuteTick();
  const unknown = accounts !== null && !accounts.reachable;
  // The meters draw the account in use — the chosen account, else the live login — which is not
  // always the login `/api/usage` measured. This is the one conversion; UsageMeters is unchanged.
  const metersUsage = accountInUseUsage(usage, accounts, now);

  return (
    <>
      {unknown ? <p className="text-xs leading-relaxed text-muted-foreground">{UNREACHABLE_LINE}</p> : <UsageMeters usage={metersUsage} />}

      {/* The account section: one row per account, the automatic switch, the last switch, and the
          four acts the row's hooks hand it. It renders nothing until the first answer lands — a
          lane that cannot answer is its own calm line inside the section, never a blank space. */}
      <ClaudeAccountRows
        picture={accounts}
        busy={busy}
        nowMs={now}
        onUse={onUse}
        onSetAuto={onSetAuto}
        onRemove={onRemove}
        onSetup={onSetup}
      />

      {/* OUTSIDE the meters' branch above on purpose. This reading comes from another vendor and another
          route, so a meter that cannot answer must not take it down with them — the two fail
          independently, and the panel is where a person checks the money precisely when
          something else has stopped. */}
      <DeepseekBalanceReadout balance={balance} />
      <DeepseekPeakHours now={now} />
      <JevBalanceReadout balance={jevBalance} />

      <div className="flex flex-col gap-1.5">
        {/* The panel's one sign-in door: it signs the box's own login in again. Closing its window
            re-reads the panel, where a new live identity appears as a "Set up" row — the sign-in
            itself changed no account the door holds. */}
        <button
          type="button"
          disabled={busy}
          onClick={onRelogin}
          className="rounded-lg px-2.5 py-2 text-left text-[13px] text-accent-ink transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          ↻ Re-login
        </button>

        {error && (
          <Banner tone="warn">
            <span className="text-xs">{error}</span>
          </Banner>
        )}
      </div>
    </>
  );
}
