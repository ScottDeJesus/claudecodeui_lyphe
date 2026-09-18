import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { ClaudeUsage } from '@/shared/types';

/**
 * How often usage is re-read on its own. D7's floor.
 *
 * Three minutes, not one: these figures come from the provider through the server's own cache
 * and move slowly, and the reading a person actually cares about is the one taken when they
 * open the panel — which `refresh()` takes on the spot.
 */
const USAGE_POLL_MS = 180_000;

/**
 * The usage windows for whichever account is live.
 *
 * Used by the accounts module's footer row, which shows the 5-hour figure inline and hands
 * the whole reading to the panel. The row holds the ONE instance, so the panel opening and
 * closing never starts or stops a poller.
 */
export function useDescentUsage() {
  // The last reading the route answered with. Held for the same reason the account picture
  // is: `null` (not asked yet) and `{reachable:false}` (asked, no reading) are different
  // things to say, and neither of them is zero.
  const [data, setData] = useState<ClaudeUsage | null>(null);
  // Mount flag: a poll that resolves after the sidebar collapsed must not set state.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api.accounts.usage();
      const body = (await response.json()) as ClaudeUsage;
      if (mountedRef.current) setData(body);
    } catch {
      // A 200 is the route's answer even when nothing can be computed, so a throw is this app's
      // own network or an unreadable body — "no reading", which is not a reading of zero.
      if (mountedRef.current) setData({ reachable: false, reason: 'unreachable' });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, USAGE_POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { data, refresh };
}
