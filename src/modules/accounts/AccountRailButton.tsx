import { useCallback, useEffect, useRef, useState } from 'react';

import { ACCOUNT_PANEL_ID, AccountPopover } from '@/modules/accounts/AccountPopover';
import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { accountInitials } from '@/modules/accounts/utils/accountInitials';
import { accountInUse } from '@/modules/accounts/utils/accountInUseUsage';
import { Avatar, Tooltip } from '@/shared/ui';

/**
 * The signed-in Claude account, as the button at the foot of the views rail.
 *
 * A 40px rail button (44px below md, the touch floor) holding the account's 26px avatar; a press opens the account
 * panel beside the rail, where the usage meters, both balances, the account rows and Re-login live. Drawn by the
 * project-workspace module's WorkspaceRail at the rail's foot. The rail stands whether the chat list shows or is
 * collapsed (collapsing hides the list column only), so the button never remounts on a collapse, and ONE instance is
 * mounted at every moment. It owns the popover's open state and nothing else: the readings, the acts and the sign-in
 * windows are `AccountsProvider`'s, shared with the Accounts gutter widget, and the polls are the provider's — D7
 * caps how often those reads may happen.
 */
export function AccountRailButton() {
  const { accounts, signInOpen, clearError, refreshReadings } = useAccountsContext();

  // Whether the account panel is showing. Not derivable from the picture: the picture says
  // which account is live, and the panel is open precisely while that is being reconsidered.
  const [open, setOpen] = useState(false);

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
    if (!open || signInOpen) return undefined;

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
  }, [open, signInOpen, closePanel]);

  // The account in use, as the door marks it (`in_use`): its email names it, the slug standing in when
  // its saved slot names no email, and the slug draws the avatar's initials. No mark — the door's store
  // does not hold the live identity yet, or the door cannot answer — draws the rail's own blank.
  const inUse = accountInUse(accounts);
  const inUseSlug = inUse?.slug ?? null;
  const label = inUse?.email ?? inUseSlug ?? '—';

  const togglePanel = () => {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    // D7: a reading is taken when the panel opens, so what a person reads is what is true now rather than
    // whatever the last three-minute tick left behind.
    refreshReadings();
  };

  return (
    // `flex` so the root is exactly the button's box: an inline-block tooltip wrapper in a block root would add a line
    // box's descender gap under the button, and the panel's `bottom-0` would then sit that gap below the button's foot.
    <div className="relative flex" ref={rootRef}>
      {/* While the panel is open it stands where this tooltip would, so the bubble is put away (`hidden`) rather than
          left over the panel's corner: swapping the tooltip out for its bare child would remount the button and
          drop its focus. */}
      <Tooltip position="right" showOnFocus content="Account" className={open ? 'hidden' : undefined}>
        <button
          ref={triggerRef}
          type="button"
          data-account-trigger=""
          aria-label={`Account ${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? ACCOUNT_PANEL_ID : undefined}
          onClick={togglePanel}
          // The rail button's ground, hover and focus ring, spelled again because the rail's RailButton is private to the
          // project-workspace module. `relative` is what lets `focus-visible:z-10` lift the ring over a hovered neighbour.
          className="relative grid size-11 flex-none place-items-center rounded-lg text-muted-foreground transition-colors duration-quick hover:bg-secondary hover:text-foreground focus-visible:z-10 max-md:focus-visible:outline-offset-0 md:size-10"
        >
          <Avatar initials={accountInitials(inUseSlug)} size={26} muted={!inUseSlug} />
        </button>
      </Tooltip>

      {/* After the trigger, so a forward Tab walks from the button into the panel. The panel's own
          `left-full` and `bottom-0` seat it beside the rail, on the button's foot. */}
      {open && <AccountPopover />}
    </div>
  );
}
