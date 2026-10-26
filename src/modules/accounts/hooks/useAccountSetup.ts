import { useCallback, useState } from 'react';

import { announceAccountsChanged } from '@/modules/accounts/hooks/useClaudeAccounts';

/**
 * The Set up window: the account whose sign-in token is being saved, and the two acts that open
 * and close it.
 *
 * Used by the accounts module's AccountsProvider, which mounts `ProviderLoginModal` on the door's
 * `setup-token <slug>` verb. One object rather than two states, so an open window ALWAYS has a slug:
 * a bare `setup-token` is a usage error, and no press on the panel can produce one.
 */
export function useAccountSetup() {
  // The account the window signs in; null when no window is up. Nothing else names it: the window's
  // command and its title both read this one slug, so they cannot disagree.
  const [setup, setSetup] = useState<{ slug: string } | null>(null);

  const openSetup = useCallback((slug: string) => setSetup({ slug }), []);

  const closeSetup = useCallback(() => {
    setSetup(null);
    // The window just ran the door's save-and-check for that account, so the picture it drew when it
    // opened is stale — a token may now be saved, checking, or refused. The provider owns the app's ONE
    // account poller, and this tells it to read now rather than at its next minute tick.
    announceAccountsChanged();
  }, []);

  return { setup, openSetup, closeSetup };
}
