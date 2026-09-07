import { useCallback, useEffect, useRef, useState } from 'react';

import { ACCOUNT_PANEL_ID, AccountPopover } from '@/modules/accounts/AccountPopover';
import { useDescentAccounts } from '@/modules/accounts/hooks/useDescentAccounts';
import { useDescentUsage } from '@/modules/accounts/hooks/useDescentUsage';
import { accountInitials } from '@/modules/accounts/utils/accountInitials';
import { ProviderLoginModal } from '@/modules/provider-auth';
import { Avatar } from '@/shared/ui';

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
 * exclusion is what keeps ONE Descent poller in the app — mounting this in the footer's
 * desktop and mobile blocks separately would double the read rate D7 caps.
 */
export function AccountFooterRow({ collapsed = false, onExpand }: AccountFooterRowProps) {
  const { data: accounts, switchTo, capture, busy, error, clearError } = useDescentAccounts();
  const { data: usage, refresh: refreshUsage } = useDescentUsage();

  // Whether the account panel is showing. Not derivable from the picture: the picture says
  // which account is live, and the panel is open precisely while that is being reconsidered.
  const [open, setOpen] = useState(false);
  // Whether the provider's own login is running in the embedded terminal. Held here rather
  // than in the panel because the panel closes and this must not close with it.
  const [loginOpen, setLoginOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Whether the login command exited cleanly while the modal was open. A ref rather than state
  // because nothing renders from it — it only decides whether closing the modal has a new login
  // worth saving. A non-zero exit (the operator cancelled, or the auth failed) leaves it false.
  // See `handleLoginClose`.
  const loginCompletedRef = useRef(false);

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
  // listener gated on `defaultPrevented` (`ChatInterface.tsx:302-310`), and window-capture runs
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
  // While the login modal is up neither dismissal fires — the modal covers the panel, and
  // closing it underneath would take the write's banner with it before anyone had read it.
  useEffect(() => {
    if (!open || loginOpen) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
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
  }, [open, loginOpen, closePanel]);

  const picture = accounts?.reachable ? accounts : null;

  // The 5-hour figure, inline. Guarded on the NUMBER and not on the window, because a window
  // with `percent: null` is a reading nobody has — "usage —", never "undefined%" and never 0.
  const fiveHour = usage?.reachable ? usage.windows.find((window) => window.key === 'five_hour') : undefined;
  const usageText = typeof fiveHour?.percent === 'number'
    ? `${Math.round(fiveHour.percent)}% of this 5-hour window`
    : 'usage —';

  const label = picture?.activeLabel ?? '—';

  const togglePanel = () => {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    // D7: a reading is taken when the panel opens, so what a person reads is what is true
    // now rather than whatever the last three-minute tick left behind.
    void refreshUsage();
  };

  // "Add another account": save the login that is live NOW before the CLI can replace it, then
  // run the provider's own login. Descent's capture also re-points its ACTIVE account to
  // whatever it just saved (`server_api_accounts.py:101`), which is why the toast says so.
  const handleAddAccount = useCallback(async () => {
    loginCompletedRef.current = false;
    await capture();
    setLoginOpen(true);
  }, [capture]);

  // Closing the modal saves again ONLY when the login command exited CLEANLY. A capture is
  // never a no-op at the far end — it rewrites both slot files, appends an audit row and
  // repaints every Descent client — so neither a modal opened and closed without signing in
  // NOR a login the operator cancelled (which exits non-zero, and still fires `onComplete`)
  // churns Descent's store for a login that did not change.
  const handleLoginClose = useCallback(async () => {
    setLoginOpen(false);
    if (!loginCompletedRef.current) return;
    loginCompletedRef.current = false;
    await capture();
  }, [capture]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Account ${label}`}
        title={`Account ${label}`}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
      >
        <Avatar initials={accountInitials(picture?.activeLabel ?? null)} size={22} muted={!picture?.activeLabel} />
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
        <Avatar initials={accountInitials(picture?.activeLabel ?? null)} size={26} muted={!picture?.activeLabel} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground" title={label}>{label}</span>
          <span className="block text-xs text-muted-foreground">{usageText}</span>
        </span>
        <span aria-hidden="true" className="flex-none text-[9px] text-ink-faint">▼</span>
      </button>

      {/* After the trigger, so a forward Tab walks into the panel instead of past the whole
          sidebar footer. Its own `bottom-full` is what puts it above the row. */}
      {open && (
        <AccountPopover
          accounts={accounts}
          usage={usage}
          busy={busy}
          error={error}
          onSwitch={(slug) => { void switchTo(slug); }}
          onAddAccount={() => { void handleAddAccount(); }}
          onSaveLiveLogin={() => { void capture(); }}
        />
      )}

      <ProviderLoginModal
        isOpen={loginOpen}
        onClose={() => { void handleLoginClose(); }}
        onComplete={(exitCode) => { loginCompletedRef.current = exitCode === 0; }}
        provider="claude"
      />
    </div>
  );
}
