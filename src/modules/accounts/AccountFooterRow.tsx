import { useCallback, useEffect, useRef, useState } from 'react';

import { ACCOUNT_PANEL_ID, AccountPopover } from '@/modules/accounts/AccountPopover';
import { DeepseekBalanceReadout } from '@/modules/accounts/DeepseekBalanceReadout';
import { useAccountSetup } from '@/modules/accounts/hooks/useAccountSetup';
import { announceAccountsChanged, useClaudeAccounts } from '@/modules/accounts/hooks/useClaudeAccounts';
import { useClaudeUsage } from '@/modules/accounts/hooks/useClaudeUsage';
import { useDeepseekBalance } from '@/modules/accounts/hooks/useDeepseekBalance';
import { useJevBalance } from '@/modules/accounts/hooks/useJevBalance';
import { JevBalanceReadout } from '@/modules/accounts/JevBalanceReadout';
import { accountInitials } from '@/modules/accounts/utils/accountInitials';
import { accountInUse, accountInUseUsage } from '@/modules/accounts/utils/accountInUseUsage';
import { formatWindowCountdown, windowPercent, windowTone } from '@/modules/accounts/utils/usageWindows';
import { ProviderLoginModal } from '@/modules/provider-auth';
import { Avatar, Meter } from '@/shared/ui';
import type { ClaudeUsageWindow } from '@/shared/types';

type GlanceWindow = { key: string; short: string; full: string };

/**
 * The windows the collapsed row shows, in the order it shows them. `short` is the fallback for
 * a window the meter gives no reset time for — normally the label is the countdown to that reset.
 * `full` is the accessible name, because "5h" read aloud is not a window anyone knows.
 */
const GLANCE_WINDOWS: GlanceWindow[] = [
  { key: 'five_hour', short: '5h', full: 'Current 5-hour window' },
  { key: 'seven_day', short: '7d', full: 'This week' },
];

type AccountFooterRowProps = {
  /** The icon rail draws the avatar alone — there is no room for a label, let alone a panel. */
  collapsed?: boolean;
  /** How the rail's avatar opens the sidebar, where the full row and its panel live. */
  onExpand?: () => void;
};

/**
 * The signed-in Claude account, at the foot of the sidebar.
 *
 * Used by the sidebar module twice, and never both at once: SidebarFooter renders the full
 * row above Settings, and SidebarCollapsed renders it as the rail's avatar. That mutual
 * exclusion is what keeps ONE account poller in the app — mounting this in the footer's
 * desktop and mobile blocks separately would double the read rate D7 caps.
 */
export function AccountFooterRow({ collapsed = false, onExpand }: AccountFooterRowProps) {
  const { data: accounts, chooseAccount, setAuto, removeAccount, busy, error, clearError } =
    useClaudeAccounts();
  const { data: usage, refresh: refreshUsage } = useClaudeUsage();
  // A different account from the one above, from a route of its own — held here so the row and
  // the panel share their ONE reading, and so neither is hidden when the account lane cannot answer.
  const { data: balance, refresh: refreshBalance } = useDeepseekBalance();
  // The third account on this row: a seeded credit metered locally, read from a local route.
  const { data: jevBalance, refresh: refreshJevBalance } = useJevBalance();

  // Whether the account panel is showing. Not derivable from the picture: the picture says
  // which account is live, and the panel is open precisely while that is being reconsidered.
  const [open, setOpen] = useState(false);
  // Whether the provider's own login is running in the embedded terminal. Held here rather
  // than in the panel because the panel closes and this must not close with it.
  const [loginOpen, setLoginOpen] = useState(false);
  // The account the Set up window signs in, and the acts that open and close it; closing re-reads the picture.
  const { setup, openSetup, closeSetup } = useAccountSetup();

  // The glance labels count DOWN, so they cannot wait for the three-minute usage poll to be
  // redrawn — a "1m" would sit there for three. One tick a minute, and only while there is a
  // countdown on screen to move.
  const [nowTick, setNowTick] = useState(() => Date.now());

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closePanel = useCallback(() => {
    setOpen(false);
    // A refusal describes one attempt, so it leaves with the panel rather than greeting the
    // next person who opens it.
    clearError();
  }, [clearError]);

  // Dismissal is two-way, as the library's Menu is: a pointer outside closes the panel, and
  // Escape closes it without moving the pointer, handing focus back to the trigger.
  //
  // ⚠ Escape is claimed at WINDOW in the CAPTURE phase and marked with preventDefault, and with
  // preventDefault ALONE. ChatInterface aborts the running turn from a document-level capture
  // listener gated on `defaultPrevented` (`ChatInterface.tsx`'s stop-on-Escape effect), and window-capture runs
  // before document-capture — so the mark is already on the event by the time that gate reads
  // it, and closing this panel mid-run no longer kills the run.
  //
  // stopPropagation() is deliberately NOT called, though the idiom this copies
  // (`useComposerMenuAnchor.ts:57-58`) does. This panel is not modal: something opened from the
  // keyboard while it is open — the command palette, a Dialog — sits IN FRONT of it, and
  // stopping propagation at the earliest possible point took the key away from the very overlay
  // the reader was looking at, closing this panel behind it instead. Marking the event says
  // "already handled" to anything that asks; it does not deny the key to anything that does not.
  //
  // While a sign-in window is up — the re-login's or an account's Set up — neither dismissal fires.
  // The window is drawn on `document.body`, outside `rootRef`, so every pointer inside it would read
  // as "outside" and close the panel behind it, and an Escape meant for the terminal would close the
  // panel too. The panel stays as it was, and is still open, and still working, when the window closes.
  useEffect(() => {
    if (!open || loginOpen || setup !== null) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      // An open menu is the panel's own surface: ActionMenu portals it to `body`, so its press must land.
      if ((event.target as Element | null)?.closest('[role="menu"]')) return;
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closePanel();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePanel();
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape, { capture: true });
    };
  }, [open, loginOpen, setup, closePanel]);

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

  // The two windows worth a glance, as bars — the account in use's, converted exactly as the panel's
  // meters convert it, so the two registers cannot disagree. `weekly_scoped:*` plans are left out:
  // the row has space for two, and the panel carries every window. An absent window draws no bar;
  // `percent: null` does — an empty track and an em-dash, the honest picture of "nobody has this number".
  const metersUsage = accountInUseUsage(usage, accounts, nowTick);
  const windows = metersUsage?.reachable ? metersUsage.windows : [];
  const glanceWindows = GLANCE_WINDOWS
    .map((glance) => {
      const found = windows.find((usageWindow) => usageWindow.key === glance.key);
      return found ? { ...glance, usageWindow: found } : null;
    })
    .filter((entry): entry is GlanceWindow & { usageWindow: ClaudeUsageWindow } => entry !== null);

  // The account in use's slug, as the door marks it (`in_use`). No mark — the door's store does not
  // hold the live identity yet, or the door cannot answer — draws the rail's own blank.
  const inUseSlug = accountInUse(accounts)?.slug ?? null;
  const label = inUseSlug ?? '—';
  const hasCountdown = glanceWindows.some(({ usageWindow }) => Boolean(usageWindow.resetsAt));

  useEffect(() => {
    if (!hasCountdown) return undefined;
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [hasCountdown]);

  const togglePanel = () => {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    // D7: a reading is taken when the panel opens, so what a person reads is what is true
    // now rather than whatever the last three-minute tick left behind. Both readings: the
    // balance is money, and a figure that only moves on a timer is the one a person would
    // check twice.
    void refreshUsage();
    void refreshBalance();
    void refreshJevBalance();
  };

  // Re-login, the panel's one sign-in door: it signs the box's own login in again. There is nothing
  // to save before it opens and nothing to file when it closes — the token switch owns the account,
  // and a new live identity lands in the panel as a "Set up" row.
  const handleRelogin = useCallback(() => setLoginOpen(true), []);
  // Closing the window re-reads the panel, so a sign-in made in there shows at once instead of at
  // the poller's next minute tick. A window closed without signing in changes no account, and the
  // re-read is harmless.
  const handleLoginClose = useCallback(() => {
    setLoginOpen(false);
    announceAccountsChanged();
  }, []);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Account ${label}`}
        title={`Account ${label}`}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
      >
        <Avatar initials={accountInitials(inUseSlug)} size={22} muted={!inUseSlug} />
      </button>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        data-account-row=""
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? ACCOUNT_PANEL_ID : undefined}
        onClick={togglePanel}
        className="flex w-full items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/60 md:rounded-lg md:bg-transparent md:px-2.5 md:hover:bg-accent/60"
      >
        <Avatar initials={accountInitials(inUseSlug)} size={26} muted={!inUseSlug} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground" title={label}>{label}</span>
          {glanceWindows.length > 0 ? (
            <span className="mt-1 flex items-center gap-3">
              {glanceWindows.map(({ key, short, full, usageWindow }) => {
                const percent = windowPercent(usageWindow);
                // Time left where there is one, the window's own name where there is not.
                const countdown = formatWindowCountdown(usageWindow.resetsAt, nowTick);
                const glanceLabel = countdown ?? short;
                return (
                  <span key={key} className="min-w-0 flex-1" title={countdown ? `${full} · ${countdown} left` : full}>
                    <Meter
                      variant="inline"
                      percent={percent}
                      tone={windowTone(usageWindow, percent)}
                      label={glanceLabel}
                      ariaLabel={countdown ? `${full} — ${countdown} left` : `${short} — ${full}`}
                      value={percent === null ? '—' : `${percent}%`}
                    />
                  </span>
                );
              })}
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">usage —</span>
          )}
          {/* Under the meters and inside the same column, which is where the account's own
              readings live: the windows above are what is LEFT of this Claude account, and this
              line is what is LEFT of the DeepSeek one that pays for builds. It draws while the
              meters are unknown — the two sources fail independently, and this is the one that
              still answers when the account lane does not. */}
          <span className="mt-1 block">
            <DeepseekBalanceReadout balance={balance} variant="inline" />
          </span>
          <span className="mt-0.5 block">
            <JevBalanceReadout balance={jevBalance} variant="inline" />
          </span>
        </span>
        <span aria-hidden="true" className="flex-none text-[9px] text-ink-faint">▼</span>
      </button>

      {/* After the trigger, so a forward Tab walks into the panel instead of past the whole
          sidebar footer. Its own `bottom-full` is what puts it above the row. */}
      {open && (
        <AccountPopover
          accounts={accounts}
          usage={usage}
          balance={balance}
          jevBalance={jevBalance}
          busy={busy}
          error={error}
          onRelogin={handleRelogin}
          onUse={(slug) => { void chooseAccount(slug); }}
          onSetAuto={(on) => { void setAuto(on); }}
          onRemove={(slug) => { void removeAccount(slug); }}
          onSetup={openSetup}
        />
      )}

      <ProviderLoginModal
        isOpen={loginOpen}
        onClose={handleLoginClose}
        provider="claude"
      />

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
    </div>
  );
}
