import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAccountSetup } from '@/modules/accounts/hooks/useAccountSetup';
import { announceAccountsChanged, useClaudeAccounts } from '@/modules/accounts/hooks/useClaudeAccounts';
import { useClaudeUsage } from '@/modules/accounts/hooks/useClaudeUsage';
import { useDeepseekBalance } from '@/modules/accounts/hooks/useDeepseekBalance';
import { useJevBalance } from '@/modules/accounts/hooks/useJevBalance';
import type { JevBalance } from '@/modules/accounts/hooks/useJevBalance';
import { accountInUse } from '@/modules/accounts/utils/accountInUseUsage';
import { ProviderLoginModal } from '@/modules/provider-auth';
import type { ClaudeAccounts, ClaudeUsage, DeepseekBalance } from '@/shared/types';

/**
 * How recently the readings must have been taken on purpose for `refreshStaleReadings` to leave them be.
 *
 * The gutter widget asks for a fresh reading when it mounts and when the page comes back into view. At page load it
 * mounts a moment after this provider's own first reads, and a tab flipped away and back within seconds has nothing
 * newer to show: neither should spend a second set of requests on figures that are seconds old. The popover's open
 * does not use this floor — a person pressing the button gets a reading, as they always did.
 */
const FRESH_READINGS_MS = 10_000;

/** Everything the account panel draws and does, held once for every place that draws it. */
type AccountsValue = {
  accounts: ClaudeAccounts | null;
  usage: ClaudeUsage | null;
  /** The DeepSeek reading. Not part of `usage`: a different account, from a route of its own. */
  balance: DeepseekBalance | null;
  /** The Jev estimate, for the same reason. */
  jevBalance: JevBalance | null;
  busy: boolean;
  /** The refusal of the last door write, in the door's words; null when there is none standing. */
  error: string | null;
  /** True while a sign-in window — Re-login's or an account's Set up — is up over the page. */
  signInOpen: boolean;
  /** Drops a standing refusal: it describes one attempt, so whoever puts the panel away calls this. */
  clearError: () => void;
  /** Opens the provider's login window — the panel's one sign-in door, for the same account or another. */
  onRelogin: () => void;
  /** The door's three acts: use this account, turn the automatic switch on or off, remove one. */
  onUse: (slug: string) => void;
  onSetAuto: (on: boolean) => void;
  onRemove: (slug: string) => void;
  /** Opens the Set up window on the door's `setup-token <slug>`. */
  onSetup: (slug: string) => void;
  /** Reads usage and both balances now, whatever the last read was: what pressing the rail button does. */
  refreshReadings: () => void;
  /** The same read, skipped when the readings were taken within the last few seconds. */
  refreshStaleReadings: () => void;
};

const AccountsContext = createContext<AccountsValue | null>(null);

/**
 * The account panel's one source: the four hooks that read the door's accounts, the provider's usage and the two
 * balances, the door's acts, the account-change re-read, and the two sign-in windows.
 *
 * Mounted once by `ProjectWorkspaceShell`, above the views rail and the main region, so the rail button's popover and
 * the Accounts gutter widget read the same state: opening the widget starts no second poller, and a switch made in one
 * place is on screen in the other at once. The hooks poll on their own timers (accounts a minute, usage and both
 * balances three) for as long as this is mounted — which is as long as the workspace is — and a place that draws
 * the panel only reads.
 *
 * The sign-in windows live here, not in either home: both draw a Re-login button and a Set up row, and the window must
 * outlive the popover that was open when it was pressed. They draw on `document.body`, so where they are mounted
 * changes nothing on screen.
 */
export function AccountsProvider({ children }: { children: ReactNode }) {
  const { data: accounts, chooseAccount, setAuto, removeAccount, busy, error, clearError } = useClaudeAccounts();
  const { data: usage, refresh: refreshUsage } = useClaudeUsage();
  const { data: balance, refresh: refreshBalance } = useDeepseekBalance();
  const { data: jevBalance, refresh: refreshJevBalance } = useJevBalance();

  // Whether the provider's own login is running in the embedded terminal. Held here, above both homes, because
  // the popover closes and this must not close with it.
  const [loginOpen, setLoginOpen] = useState(false);
  // The account the Set up window signs in, and the acts that open and close it; closing re-reads the picture.
  const { setup, openSetup, closeSetup } = useAccountSetup();

  // A newly chosen account is read at once. The door's choice moves which account is in use, and the
  // three-minute tick would otherwise leave the last account's figures under the new name; the
  // server's cache misses when the box's own login moves (`usage.service.ts`), so this reading is
  // the new one's own. The first account seen is the mount's own reading already (`useClaudeUsage`),
  // so only a change reads.
  const inUseDigest = accountInUse(accounts)?.digest;
  const seenDigestRef = useRef(inUseDigest);
  useEffect(() => {
    if (inUseDigest === undefined) return;
    if (seenDigestRef.current !== undefined && seenDigestRef.current !== inUseDigest) void refreshUsage();
    seenDigestRef.current = inUseDigest;
  }, [inUseDigest, refreshUsage]);

  // When the readings were last taken on purpose, mount included — the hooks above read once as this mounts. Stamped in a
  // LAYOUT effect: a child's passive effect (the widget body's first ask) runs before this component's own, and a
  // stamp still at zero would read the widget's mount as a reading nobody had taken.
  const lastReadingsAtRef = useRef(0);
  useLayoutEffect(() => {
    lastReadingsAtRef.current = Date.now();
  }, []);

  // D7: a reading is taken when the panel is opened, so what a person reads is what is true now rather than
  // whatever the last three-minute tick left behind. Both balances too: the balance is money, and a figure that
  // only moves on a timer is the one a person would check twice.
  const refreshReadings = useCallback(() => {
    lastReadingsAtRef.current = Date.now();
    void refreshUsage();
    void refreshBalance();
    void refreshJevBalance();
  }, [refreshUsage, refreshBalance, refreshJevBalance]);

  const refreshStaleReadings = useCallback(() => {
    if (Date.now() - lastReadingsAtRef.current < FRESH_READINGS_MS) return;
    refreshReadings();
  }, [refreshReadings]);

  // Re-login, the panel's one sign-in door: it signs the box's own login in again. There is nothing
  // to save before it opens and nothing to file when it closes — the token switch owns the account,
  // and a new live identity lands in the panel as a "Set up" row.
  const onRelogin = useCallback(() => setLoginOpen(true), []);
  // Closing the window re-reads the panel, so a sign-in made in there shows at once instead of at
  // the poller's next minute tick. A window closed without signing in changes no account, and the
  // re-read is harmless.
  const handleLoginClose = useCallback(() => {
    setLoginOpen(false);
    announceAccountsChanged();
  }, []);

  const onUse = useCallback((slug: string) => { void chooseAccount(slug); }, [chooseAccount]);
  const onSetAuto = useCallback((on: boolean) => { void setAuto(on); }, [setAuto]);
  const onRemove = useCallback((slug: string) => { void removeAccount(slug); }, [removeAccount]);

  const signInOpen = loginOpen || setup !== null;
  const value = useMemo<AccountsValue>(() => ({
    accounts,
    usage,
    balance,
    jevBalance,
    busy,
    error,
    signInOpen,
    clearError,
    onRelogin,
    onUse,
    onSetAuto,
    onRemove,
    onSetup: openSetup,
    refreshReadings,
    refreshStaleReadings,
  }), [accounts, usage, balance, jevBalance, busy, error, signInOpen, clearError, onRelogin, onUse, onSetAuto, onRemove, openSetup, refreshReadings, refreshStaleReadings]);

  return (
    <AccountsContext.Provider value={value}>
      {children}

      <ProviderLoginModal isOpen={loginOpen} onClose={handleLoginClose} provider="claude" />

      {/* The Set up window, beside the Re-login one: the same terminal running the account CLI's
          `setup-token` for one account, mounted only while `useAccountSetup` names that account. */}
      {setup !== null && (
        <ProviderLoginModal
          isOpen
          customCommand={`~/.claude/scripts/claude-account setup-token ${setup.slug}`}
          title={`Set up ${setup.slug}'s sign-in token`}
          onClose={closeSetup}
          provider="claude"
        />
      )}
    </AccountsContext.Provider>
  );
}

/**
 * The account panel's state and acts, from the provider above. Used by the accounts module's AccountRailButton
 * (the popover's trigger), AccountPanelBody (the body both homes draw) and AccountsWidgetBody (the gutter's
 * refresh). A loud error when nothing provides it: a panel drawn outside the workspace would otherwise draw an
 * empty picture and read as "you have no accounts".
 */
export function useAccountsContext(): AccountsValue {
  const value = useContext(AccountsContext);
  if (value === null) throw new Error('useAccountsContext must be used inside AccountsProvider.');
  return value;
}
