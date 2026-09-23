import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { JevSummary } from '@/shared/types';

/** The DeepSeek balance's cadence, for its reason: a slow figure a person wants fresh when they open the panel. */
const BALANCE_POLL_MS = 180_000;

/**
 * The estimate this surface draws, in its own camelCase: the reader answers snake_case, and this is
 * where it is mapped once for `JevBalanceReadout` and its two mounts.
 */
export type JevBalance = { creditUsd: number; spentUsd: number; leftUsd: number };

/**
 * What is left of the Jev credit the operator seeded, by this host's own metering.
 *
 * Used by the accounts module's footer row, which owns the ONE instance and hands the reading to
 * both registers, exactly as `useDeepseekBalance` does. It reads `/api/jev/summary` — the one reader,
 * a local file sum, no vendor call — so it needs no forced-read floor. `null` covers both "not read
 * yet" and "no account seeded": either way there is no figure to draw, and neither is zero.
 */
export function useJevBalance() {
  const [data, setData] = useState<JevBalance | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      // `feed: 0` — the balance is a lifetime total, so no feed rows ride along for it.
      const { balance } = await readApiJson<JevSummary>(await api.jev.summary('all', 0));
      if (mountedRef.current) {
        setData(balance === null ? null : {
          creditUsd: balance.credit_usd,
          spentUsd: balance.spent_usd,
          leftUsd: balance.left_usd,
        });
      }
    } catch {
      if (mountedRef.current) setData(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), BALANCE_POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { data, refresh };
}
