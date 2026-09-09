import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api } from '@/shared/api';
import type { MemoryPending } from '@/shared/types';

/**
 * How often the pending queue is re-read. Deliberately slow, and the same floor the accounts
 * poller keeps: nothing here moves except when a session proposes a memory or a person reviews
 * one, and the proxy's own per-call ceiling is sized against this interval so a stalled Descent
 * costs one skipped reading rather than a queue of them.
 */
const MEMORY_POLL_MS = 60_000;

/**
 * The pending picture, and the one way to ask for it again.
 *
 * `pending` is `null` until the first answer lands — "not asked yet", which a screen has to
 * tell apart from `{reachable: false}` ("asked, and there was no picture to be had"): the
 * first is a spinner, the second is words about Descent being unreachable.
 */
type MemoryIntakeValue = {
  pending: MemoryPending | null;
  pendingCount: number;
  refresh: () => Promise<void>;
};

/**
 * `null` on purpose, not a filled-in default: a default object makes the hook's guard below
 * unreachable and lets a consumer mounted outside the provider read a picture nobody polls
 * for (TasksSettingsContext.tsx:37-53 is the shape to avoid).
 */
const MemoryIntakeContext = createContext<MemoryIntakeValue | null>(null);

/**
 * The app's ONE memory-intake poller, mounted inside the auth gate so it never asks against
 * the login screen.
 *
 * It holds the READING and nothing else. Four consumers read it — the two workspace tab gates,
 * the command palette and the panel — and only the panel writes; keeping the write lifecycle
 * out (hooks/useMemoryReview.ts) is what stops a button press re-rendering all four.
 */
export function MemoryIntakeProvider({ children }: { children: ReactNode }) {
  // The last queue the proxy answered with. Essential rather than derived: it is the only copy
  // of the picture between polls, and `null` (nothing asked yet) has to look different on
  // screen from a reachable-false answer.
  const [pending, setPending] = useState<MemoryPending | null>(null);

  // Mount flag: a poll that resolves after this provider is gone must not set state.
  const mountedRef = useRef(true);
  // Which read this is. Two can be open at once — the interval's and the one a review asks for
  // — so each takes a token and answers are published in TOKEN order, never arrival order.
  const newestReadRef = useRef(0);
  // The newest token that has ANSWERED. An older answer landing after it is dropped rather than
  // published: a poll that left BEFORE a review must not land after it and put the reviewed row
  // back on screen for a minute (the hazard useCliVersion.ts:50-53 names).
  const newestAnswerRef = useRef(0);

  const store = useCallback((next: MemoryPending) => {
    if (mountedRef.current) setPending(next);
  }, []);

  const refresh = useCallback(async () => {
    const token = ++newestReadRef.current;
    let next: MemoryPending;
    try {
      const response = await api.descent.memory.pending();
      next = (await response.json()) as MemoryPending;
    } catch {
      // The proxy answers 200 even when Descent is down, so a throw here is this app's own
      // network or a body that is not JSON. Either way the honest reading is "no picture".
      next = { reachable: false, reason: 'unreachable' };
    }
    // A reading, but not the newest one: the screen already shows something later than this.
    if (token < newestAnswerRef.current) return;
    newestAnswerRef.current = token;
    // Wholesale, never merged: the queue IS the answer, and a row kept from a previous reading
    // would be a card that is no longer waiting for anyone.
    store(next);
  }, [store]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, MEMORY_POLL_MS);
    // A backgrounded tab's interval is throttled to near-nothing, so coming back to the app is
    // its own reason to ask: what a person reads on return is a reading of now, not of whenever
    // the browser last let the timer through.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const value = useMemo<MemoryIntakeValue>(() => ({
    pending,
    // Zero when there is no picture: an unreachable Descent is not "four waiting", and a count
    // carried over from the last good reading would keep a tab up that nothing can fill.
    pendingCount: pending?.reachable ? pending.candidates.length : 0,
    refresh,
  }), [pending, refresh]);

  return <MemoryIntakeContext.Provider value={value}>{children}</MemoryIntakeContext.Provider>;
}

/** The pending picture, for the tab gates, the command palette and the panel. */
export function useMemoryIntake(): MemoryIntakeValue {
  const value = useContext(MemoryIntakeContext);
  if (!value) {
    throw new Error('useMemoryIntake must be used within a MemoryIntakeProvider');
  }
  return value;
}
