import { ClaudeAccountRows } from '@/modules/accounts/ClaudeAccountRows';
import { DeepseekBalanceReadout } from '@/modules/accounts/DeepseekBalanceReadout';
import { DeepseekPeakHours } from '@/modules/accounts/DeepseekPeakHours';
import type { JevBalance } from '@/modules/accounts/hooks/useJevBalance';
import { JevBalanceReadout } from '@/modules/accounts/JevBalanceReadout';
import { UsageMeters } from '@/modules/accounts/UsageMeters';
import { accountInUseUsage } from '@/modules/accounts/utils/accountInUseUsage';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { Banner, Card } from '@/shared/ui';
import type { ClaudeAccounts, ClaudeUsage, DeepseekBalance } from '@/shared/types';

/** Said in words, because an empty panel would otherwise read as "you have no accounts". */
const UNREACHABLE_LINE = 'The server could not read accounts or usage — both are unknown.';

/** The panel's own id, so the trigger can point at it with `aria-controls`. */
export const ACCOUNT_PANEL_ID = 'account-panel';

type AccountPopoverProps = {
  accounts: ClaudeAccounts | null;
  usage: ClaudeUsage | null;
  /** The DeepSeek reading, held by the row. Not part of `usage`: a different account, from a route of its own. */
  balance: DeepseekBalance | null;
  /** The Jev estimate, held by the row for the same reason. */
  jevBalance: JevBalance | null;
  busy: boolean;
  error: string | null;
  /** Opens the provider's login window — the panel's one sign-in door, for the same account or another. */
  onRelogin: () => void;
  /** The door's three acts, held by the row's `useClaudeAccounts`: use this account, turn the rule on or off, remove one. */
  onUse: (slug: string) => void;
  onSetAuto: (on: boolean) => void;
  onRemove: (slug: string) => void;
  /** Opens the Set up window on the door's `setup-token <slug>`. */
  onSetup: (slug: string) => void;
};

/**
 * The account panel: what the account in use has spent, one row per account the door holds, and
 * the door's sign-in window. Used by the accounts module's AccountFooterRow, which anchors it above
 * the sidebar footer and owns the open state.
 *
 * It composes Card rather than adopting the library's Menu: a Menu is a list of labelled choices,
 * and this panel carries meters, avatars and buttons. Codex is deliberately absent — these are the
 * Claude accounts the door holds, and Codex stays in Settings → Agents (D6).
 */
export function AccountPopover({
  accounts,
  usage,
  balance,
  jevBalance,
  busy,
  error,
  onRelogin,
  onUse,
  onSetAuto,
  onRemove,
  onSetup,
}: AccountPopoverProps) {
  // Advances once a minute so the reset countdowns stay true while the panel is open. The
  // interval exists only for as long as this component does, and this component is mounted
  // only while the panel is showing.
  const now = useMinuteTick();
  const unknown = accounts !== null && !accounts.reachable;
  // The meters draw the account in use — the chosen account, else the live login — which is not
  // always the login `/api/usage` measured. This is the one conversion; UsageMeters is unchanged.
  const metersUsage = accountInUseUsage(usage, accounts, now);

  return (
    // The ceiling has to fit the space ABOVE the row this hangs from, not the viewport: the
    // panel grows upward, so a cap taller than that space pushes its top edge off screen and
    // the first meter loses its label. 70vh sits inside it at every height the app supports,
    // and the panel scrolls from a top edge the reader can see.
    <Card
      id={ACCOUNT_PANEL_ID}
      role="dialog"
      aria-label="Account and usage"
      className="absolute bottom-full left-0 right-0 z-50 mb-2 flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-3"
    >
      {unknown ? <p className="text-xs leading-relaxed text-muted-foreground">{UNREACHABLE_LINE}</p> : <UsageMeters usage={metersUsage} />}

      {/* OUTSIDE that branch on purpose. This reading comes from another vendor and another
          route, so a meter that cannot answer must not take it down with them — the two fail
          independently, and the panel is where a person checks the money precisely when
          something else has stopped. */}
      <DeepseekBalanceReadout balance={balance} />
      <DeepseekPeakHours now={now} />
      <JevBalanceReadout balance={jevBalance} />

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
    </Card>
  );
}
