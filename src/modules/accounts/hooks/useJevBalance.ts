import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { JevLedgerStats } from '@/shared/types';

/** The DeepSeek balance's cadence, for its reason: a slow figure a person wants fresh when they open the panel. */
const BALANCE_POLL_MS = 180_000;

export type JevBalance = NonNullable<JevLedgerStats['balance']>;

/**
 * What is left of the Jev credit the operator seeded, by this host's own metering.
 *
 * Used by the accounts module's footer row, which owns the ONE instance and hands the reading to
 * both registers, exactly as `useDeepseekBalance` does. It reads `/api/settings/jev/stats` — a local
 * file sum, no vendor call — so it needs no forced-read floor. `null` covers both "not read yet"
 * and "no account seeded": either way there is no figure to draw, and neither is zero.
 */
export function useJevBalance() {
  const [data, setData] = useState<JevBalance | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api.settings.jevStats();
      const body: unknown = response.ok ? await response.json() : null;
      const balance = (body as { balance?: unknown } | null)?.balance as JevBalance | null | undefined;
      if (mountedRef.current) {
        setData(balance && typeof balance.leftUsd === 'number' ? balance : null);
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
