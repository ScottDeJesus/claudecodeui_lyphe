import { ACCOUNT_PANEL_ID } from '@/modules/accounts/AccountPopover';
import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { accountInitials } from '@/modules/accounts/utils/accountInitials';
import { accountInUse } from '@/modules/accounts/utils/accountInUseUsage';
import { Avatar, Tooltip } from '@/shared/ui';

/**
 * The signed-in Claude account, as the button at the foot of the views rail.
 *
 * A 40px rail button (44px below md, the touch floor) holding the account's 26px avatar; a press opens the account switcher beside
 * it, the same one every account ring opens (`toggleSwitcher`), and a second press shuts it. Drawn by the project-workspace module's
 * WorkspaceRail at the rail's foot. It owns nothing: whether the switcher is open, the readings, the acts and the sign-in windows are
 * `AccountsProvider`'s, and how the switcher shuts (Escape, a press outside it) is the switcher's own (`AccountPopover`).
 */
export function AccountRailButton() {
  const { accounts, switcher, toggleSwitcher } = useAccountsContext();
  const open = switcher !== null;

  // The account in use, as the door marks it (`in_use`): its email names it, the slug standing in when
  // its saved slot names no email, and the slug draws the avatar's initials. No mark — the door's store
  // does not hold the live identity yet, or the door cannot answer — draws the rail's own blank.
  const inUse = accountInUse(accounts);
  const inUseSlug = inUse?.slug ?? null;
  const label = inUse?.email ?? inUseSlug ?? '—';

  return (
    // While the switcher is open it stands where this tooltip would, so the bubble is put away (`hidden`) rather than left over its
    // corner: swapping the tooltip out for its bare child would remount the button and drop its focus.
    <Tooltip position="right" showOnFocus content="Account" className={open ? 'hidden' : undefined}>
      <button
        type="button"
        data-account-trigger=""
        aria-label={`Account ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? ACCOUNT_PANEL_ID : undefined}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          // The switcher opens beside the rail, level with this button and clear of it.
          toggleSwitcher({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, clear: rect.width / 2 + 8, beside: true });
        }}
        // The rail button's ground, hover and focus ring, spelled again because the rail's RailButton is private to the
        // project-workspace module. `relative` is what lets `focus-visible:z-10` lift the ring over a hovered neighbour.
        className="relative grid size-11 flex-none place-items-center rounded-lg text-muted-foreground transition-colors duration-quick hover:bg-secondary hover:text-foreground focus-visible:z-10 max-md:focus-visible:outline-offset-0 md:size-10"
      >
        <Avatar initials={accountInitials(inUseSlug)} size={26} muted={!inUseSlug} />
      </button>
    </Tooltip>
  );
}
