import { useEffect, useRef, useState } from 'react';

import { useMemoryIntake } from '@/modules/memory-intake/context/MemoryIntakeContext';
import { api } from '@/shared/api';
import type { MemoryPending } from '@/shared/types';

/**
 * The recently filed memories, read beside the review queue.
 *
 * THE PROVIDER'S POLL IS THE ONE CLOCK. This hook owns no timer: it reads once on mount and again
 * whenever `useMemoryIntake().pending` changes identity, which is exactly when the provider has
 * answered — so a new reading of the queue is also a new reading of what has been filed, and two
 * surfaces of the same lane never drift a minute apart.
 *
 * TOKEN ORDERING, the provider's own shape (`MemoryIntakeContext.tsx`): two reads can be open at
 * once and a slower earlier answer must never overwrite a newer one, so each read takes a token and
 * only a token newer than the newest ANSWER lands. Answers arriving after unmount are dropped too.
 *
 * `null` is "not asked yet" and is a different sentence on screen from `{reachable: false}` — the
 * one is a spinner, the other is words about Descent being out of reach.
 */
export function useApprovedMemories(): MemoryPending | null {
  const { pending } = useMemoryIntake();

  // The last filed list the proxy answered with. Essential rather than derived: it is the only copy
  // of that picture between reads, and `null` has to look different from each real answer.
  const [approved, setApproved] = useState<MemoryPending | null>(null);

  // Mount flag: an answer that lands after this body is gone must not set state.
  const mountedRef = useRef(true);
  // Which read this is, counted up per request. Two can be open at once, so the answers are
  // published in TOKEN order rather than in arrival order.
  const newestReadRef = useRef(0);
  // The newest token that has ANSWERED. An older answer landing after it is dropped rather than
  // published: a read that left before a newer one must not land after it and put the older list on
  // screen.
  const newestAnswerRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const token = ++newestReadRef.current;
    void (async () => {
      let next: MemoryPending;
      try {
        const response = await api.descent.memory.approved();
        next = (await response.json()) as MemoryPending;
      } catch {
        // The proxy answers 200 even when Descent is down, so a throw here is this app's own
        // network or a body that is not JSON. Either way the honest reading is "no picture".
        next = { reachable: false, reason: 'unreachable' };
      }
      if (token < newestAnswerRef.current) return;
      newestAnswerRef.current = token;
      if (mountedRef.current) setApproved(next);
    })();
  }, [pending]);

  return approved;
}
