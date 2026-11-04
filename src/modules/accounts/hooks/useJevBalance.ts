import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { JevSummary } from '@/shared/types';

/** The DeepSeek balance's cadence, for its reason: a slow figure a person wants fresh when they open the panel. */
const BALANCE_POLL_MS = 180_000;

/**
 * The estimate this surface draws, in its own camelCase: the reader answers snake_case, and this is
 * where it is mapped once for `JevBalanceReadout`.
 *
 * Each figure is its own reading, and unknown is `null` — never `0` and never `NaN`. A reply that
 * carries `balance: {}` (or one figure short) is an estimate with a hole in it, and the readout
 * draws the hole as an em-dash while every figure that did arrive still draws.
 */
export type JevBalance = { creditUsd: number | null; spentUsd: number | null; leftUsd: number | null };

/** One wire figure as a reading: a finite number, or `null` for anything else — absent, `null`, a string, `NaN`. */
function figureOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The summary's `balance` as the readout draws it, or `null` for "no account seeded" (the contract's
 * own `balance: null`).
 *
 * Anything else that is not an object is a seeded estimate whose figures are all unknown, rather than
 * "no credit seeded": the reply said there is something here and did not say what, and the readout's
 * words for that are not the words for an absence.
 */
function balanceFromWire(balance: unknown): JevBalance | null {
  if (balance === null) return null;
  const figures = typeof balance === 'object' ? (balance as Record<string, unknown>) : {};
  return {
    creditUsd: figureOrNull(figures.credit_usd),
    spentUsd: figureOrNull(figures.spent_usd),
    leftUsd: figureOrNull(figures.left_usd),
  };
}

/**
 * What is left of the Jev credit the operator seeded, by this host's own metering.
 *
 * Used by the accounts module's AccountsProvider, which owns the ONE instance and hands the reading to
 * every home of the panel, exactly as `useDeepseekBalance` does. It reads `/api/jev/summary` — the one reader,
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
      if (mountedRef.current) setData(balanceFromWire(balance));
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
