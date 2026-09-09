import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMemoryIntake } from '@/modules/memory-intake/context/MemoryIntakeContext';
import { api } from '@/shared/api';
import type { MemoryReviewOutcome } from '@/shared/types';

/**
 * What to say when a write did not land at all.
 *
 * Descent's own `error` is preferred whenever it sent one — it names the actual refusal in
 * words a person can act on. Only when the proxy answered FOR Descent (503 `{reachable:false,
 * reason}`) does this translate the one word itself.
 */
function writeRefusalInWords(body: unknown): string {
  const answer = (body ?? {}) as { error?: unknown; reason?: unknown };
  if (typeof answer.error === 'string' && answer.error.trim()) return answer.error.trim();
  if (answer.reason === 'timeout') return 'Descent did not answer in time.';
  if (answer.reason === 'bad-response') return 'Descent answered with something this app could not read.';
  return 'Descent is not reachable.';
}

/** A write's verdict is Descent's own body, so it is read before the status is judged — and a body that is not JSON must not throw over the status. */
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The two review verbs and their lifecycle. Module-private, with ONE caller: MemoryIntakePanel.
 *
 * It lives here rather than in MemoryIntakeContext on purpose. The context is read by the two
 * workspace tab gates and the command palette as well as the panel; a value that also carried
 * the in-flight id and the held refusals would change on every button press and re-render all
 * of them for a fact only the panel can see.
 *
 * A refused write is NOT a failure: the cap guard answers in plain English, the card stays
 * pending, and that text is what the person needs in order to trim the memory and try again.
 * It is held here per id for THIS tab's next paint, and the refresh that follows also picks up
 * the copy Descent recorded on the row for every other tab.
 */
export function useMemoryReview() {
  const { refresh } = useMemoryIntake();
  const { t } = useTranslation();

  // This tab's freshest refusal per candidate id. Essential because the refusal arrives in a
  // response body that is read once and then gone — nothing else in the app holds it, and the
  // row it belongs to is still on screen waiting to be fixed.
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  // The candidate whose write is in flight, so its two buttons can refuse a second press.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Mount flag: a write that resolves after the panel closed must not set state.
  const mountedRef = useRef(true);
  // The in-flight guard, read synchronously — `busyId` is a render value and lands too late to
  // stop a second press in the same tick.
  const writingRef = useRef(false);
  // That same write, carrying the identity of what it is writing. A press joins it ONLY when it
  // asks for the same card and the same verb: handed another card's promise, a caller would be
  // told a memory was filed that was never touched.
  const inFlightRef = useRef<{ id: string; approve: boolean; running: Promise<MemoryReviewOutcome> } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Drops a held refusal once its candidate has been written or discarded — it described one attempt, not the card. */
  const forget = useCallback((id: string) => {
    setRefusals((held) => {
      if (!(id in held)) return held;
      const next = { ...held };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * One write, from the press to the re-read queue. `busyId` brackets exactly this span, so the
   * buttons stay refused until the list a person is looking at is the list after the write.
   */
  const runWrite = useCallback(async (id: string, approve: boolean): Promise<MemoryReviewOutcome> => {
    setBusyId(id);
    let outcome: MemoryReviewOutcome;
    try {
      const response = await api.descent.memory[approve ? 'approve' : 'reject'](id);
      const body = await readBody(response);
      if (response.ok) {
        forget(id);
        outcome = { kind: approve ? 'filed' : 'discarded' };
      } else if (response.status === 422) {
        // Descent's OWN words, verbatim — the cap guard naming what to trim. A generic
        // sentence in their place would leave the person with a pending card and no reason.
        const said = (body ?? {}) as { error?: unknown };
        const reason = typeof said.error === 'string' && said.error.trim()
          ? said.error.trim()
          : t('memory.toast.refused');
        setRefusals((held) => ({ ...held, [id]: reason }));
        outcome = { kind: 'refused', reason };
      } else if (response.status === 404) {
        outcome = { kind: 'gone' };
      } else {
        outcome = { kind: 'unreachable', reason: writeRefusalInWords(body) };
      }
    } catch {
      outcome = { kind: 'unreachable', reason: writeRefusalInWords(null) };
    } finally {
      // After EVERY outcome, whatever it was: on a write the row leaves the queue, on a refusal
      // it stays and picks up the text Descent recorded, and on a gone it was already gone.
      //
      // In a `finally`, and holding the re-read's own failure, because the one thing that must
      // not happen here is the buttons staying refused for the panel's life. `refresh()` swallows
      // its fetch and JSON throws today (MemoryIntakeContext.tsx:65-72) — this release is not a
      // bet on that staying true, which is the house shape (useDescentAccounts.ts:129-133).
      try {
        await refresh();
      } catch {
        // The queue keeps the picture it had; the next poll is a minute away at most, and the
        // write's own verdict is already decided and about to be spoken.
      }
      if (mountedRef.current) setBusyId(null);
    }
    return outcome;
  }, [forget, refresh, t]);

  const review = useCallback((id: string, approve: boolean): Promise<MemoryReviewOutcome> => {
    const previous = inFlightRef.current;
    // The same card and the same verb pressed twice before the paint caught up: join the write
    // already going rather than open a second one — `busyId` is a render value and lands too
    // late to stop it (useDescentAccounts.ts:68-70).
    if (writingRef.current && previous && previous.id === id && previous.approve === approve) {
      return previous.running;
    }
    writingRef.current = true;
    // Any OTHER press takes its turn behind the write in flight. It is never handed that
    // write's answer, and it is never dropped: a press that waits still HAPPENS, on the card it
    // was aimed at — the one thing a silently swallowed press can never claim.
    const running = previous
      ? previous.running.then(() => runWrite(id, approve), () => runWrite(id, approve))
      : runWrite(id, approve);
    const entry = { id, approve, running };
    inFlightRef.current = entry;
    // Released only once the queue has been re-read, so the synchronous guard and `busyId` stop
    // being free at the same moment rather than a whole refresh apart.
    void running.finally(() => {
      if (inFlightRef.current !== entry) return;
      inFlightRef.current = null;
      writingRef.current = false;
    });
    return running;
  }, [runWrite]);

  return { review, refusals, busyId };
}
