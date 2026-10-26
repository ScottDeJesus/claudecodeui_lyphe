import { useEffect } from 'react';

import { AccountPanelBody } from '@/modules/accounts/AccountPanelBody';
import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';

/**
 * The account panel as the desktop chat gutter draws it: the same body the rail button's popover shows — the two
 * usage windows first, the DeepSeek and Jev balances, then one row per account with its 5-hour and weekly figures,
 * the one in use marked, and a tap on another row to switch.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), through the accounts barrel, as the Accounts widget's body. It
 * takes no props: the panel is the account's, the same in every chat, and every figure it draws is read from
 * `AccountsProvider` — the one set of pollers the popover reads too, so unfolding this starts none. The chrome,
 * the header and the scrolling belong to the frame around it.
 *
 * THE BODY IS MOUNTED ONLY WHILE THE WIDGET IS UNFOLDED, so mounting is unfolding: it reads the readings afresh, as
 * opening the popover does. So does the page coming back into view, because a tab left behind for an hour is
 * showing figures an hour old and the widget is the one panel that is on screen without being asked for.
 * `refreshStaleReadings` leaves alone readings taken a few seconds ago, which is what keeps a page load — where the
 * body mounts just after the provider's own first reads — from reading twice.
 */
export function AccountsWidgetBody() {
  const { refreshStaleReadings, clearError } = useAccountsContext();

  useEffect(() => {
    refreshStaleReadings();
    const readWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshStaleReadings();
    };
    document.addEventListener('visibilitychange', readWhenVisible);
    return () => document.removeEventListener('visibilitychange', readWhenVisible);
  }, [refreshStaleReadings]);

  // A refusal describes one attempt, so it leaves with the panel — here, with the fold, as the popover's does on
  // close — and the provider's hook ends it at the next picture, so it never stands in the gutter until the next press.
  useEffect(() => clearError, [clearError]);

  return (
    <div data-accounts-widget className="flex min-w-0 flex-col gap-3">
      <AccountPanelBody />
    </div>
  );
}
