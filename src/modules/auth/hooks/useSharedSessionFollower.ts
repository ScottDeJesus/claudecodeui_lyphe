import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

import { AUTH_TOKEN_KEY, isValidRefreshedToken, traceAuthDecision } from '@/shared/authToken';

type SharedSessionFollowerOptions = {
  /** Whether this tab holds a session right now; a ref, because the listener is subscribed once. */
  sessionHeldRef: MutableRefObject<boolean>;
  /** Points this tab at the token another tab stored (a refresh or a new sign-in). */
  adoptToken: (token: string) => void;
  /** Drops this tab's view of the session after another tab ended it; storage is already empty. */
  endSessionView: () => void;
};

/**
 * Keeps this tab's session equal to the one in localStorage, which every tab of the origin shares.
 *
 * The token lives in two places per tab: storage (shared) and AuthContext's memory (private). Every
 * request reads storage, but the WebSocket reconnect and the refresh timer read memory, so a tab that
 * missed another tab's refresh carried an old token in memory for as long as it lived — and, once
 * that one aged out, deleted the newer token both tabs were using. The `storage` event is how the
 * private copy stays honest: a refresh elsewhere is adopted, a sign-out elsewhere is followed.
 *
 * Used by AuthContext alone. It reads the stored value instead of the event's `newValue`, because a
 * burst of writes can deliver events out of order and storage holds the last word.
 */
export function useSharedSessionFollower({ sessionHeldRef, adoptToken, endSessionView }: SharedSessionFollowerOptions) {
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && event.key !== AUTH_TOKEN_KEY)) {
        return;
      }
      if (!sessionHeldRef.current) {
        return;
      }

      const current = localStorage.getItem(AUTH_TOKEN_KEY);
      if (current === null) {
        traceAuthDecision({ trigger: 'other-tab-signed-out', token: null }, 'followed');
        endSessionView();
      } else if (isValidRefreshedToken(current)) {
        traceAuthDecision({ trigger: 'other-tab-token', token: current }, 'followed');
        adoptToken(current);
      }
    };

    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, [adoptToken, endSessionView, sessionHeldRef]);
}
