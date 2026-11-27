import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useLaneWatch } from '@/shared/hooks/useLaneWatch';
import { useServerFrame } from '@/shared/hooks/useServerFrame';
import type { ClaudeUsage, ServerEvent } from '@/shared/types';

/** The server lane this hook watches (`server/modules/accounts/accounts-lanes.ts`); one live login per host, so no key. */
const USAGE_LANE = 'accounts_usage';
const USAGE_FRAME_KIND = 'accounts_usage_state';
const USAGE_FRAME_KINDS = [USAGE_FRAME_KIND] as const;

type UsageFrame = ServerEvent & { usage: ClaudeUsage };

/** The frame's reading, checked where it enters: a body without a boolean `reachable` is no reading. */
function isUsageFrame(event: ServerEvent): event is UsageFrame {
  if (event.kind !== USAGE_FRAME_KIND) return false;
  const usage = event.usage;
  return typeof usage === 'object' && usage !== null && 'reachable' in usage && typeof usage.reachable === 'boolean';
}

/**
 * The usage windows for whichever account is live.
 *
 * Used by the accounts module's AccountsProvider, which hands the whole reading to every home of the panel.
 * The provider holds the ONE instance, so a panel opening and closing never starts or stops the server's watch.
 */
export function useClaudeUsage() {
  // The last reading the route answered with. Held for the same reason the account picture
  // is: `null` (not asked yet) and `{reachable:false}` (asked, no reading) are different
  // things to say, and neither of them is zero.
  const [data, setData] = useState<ClaudeUsage | null>(null);
  // Mount flag: a read that resolves after the provider unmounted (a sign-out, or the workspace leaving the tree) must not set state.
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
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // While mounted the server reads the window for this tab and sends each reading that moved; a
  // reconnect reads the route once, for whatever the drop missed.
  useLaneWatch(USAGE_LANE, null, true);
  useServerFrame(USAGE_FRAME_KINDS, (event) => {
    if (!isUsageFrame(event)) {
      void refresh();
      return;
    }
    if (mountedRef.current) setData(event.usage);
  });

  return { data, refresh };
}
