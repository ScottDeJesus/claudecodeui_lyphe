import { useCallback, useEffect, useRef, useState } from 'react';

import { useHeal } from '@/modules/heal/context/HealContext';
import { useMemoryReview } from '@/modules/memory-intake';

/** What the two presses need: the candidate whose write is out, this tab's held refusals by candidate, and the press. */
export type RuleReview = { busyId: string | null; refusals: Record<string, string>; onReview: (candidate: string, approve: boolean) => void };

/** The held words with one candidate's entry gone: a reason describes one attempt, never the card. */
function forget(held: Record<string, string>, candidate: string): Record<string, string> {
  if (!(candidate in held)) return held;
  const next = { ...held };
  delete next[candidate];
  return next;
}

/**
 * The Memory door's two presses for the Rules section's cards — `file it` and `discard` on a rule waiting under a
 * candidate — and the heal summary re-read the cards are drawn from. Used by HealRuleList, which hands the result to
 * every card.
 *
 * THE WRITE IS THE MEMORY MODULE'S OWN (`useMemoryReview`, through its barrel): the same press the Memory panel
 * makes, so approval stays his press alone and a refusal speaks in the door's own words. What this adds is what a card
 * needs and the door cannot know:
 *
 * THE SUMMARY IS RE-READ after every press, whatever its outcome — a card is drawn from the heal summary's decision,
 * which the press just changed (or, on a refusal, just annotated).
 *
 * THE CARD STAYS BUSY UNTIL THAT READ LANDS. The door lets go of its candidate once the Memory queue is re-read, but the
 * heal summary takes about a second more, and in that gap the card still reads `pending` for a candidate already
 * decided: both presses would come back on, for a second press the queue can only answer `gone`.
 *
 * A WRITE THAT NEVER REACHED THE QUEUE SAYS SO. The door holds only a 422's words and resolves any other failed write as
 * `unreachable` with its reason, which nothing else keeps — the card would look like a press that did nothing. The
 * reason is held here per candidate, beside the door's own refusals, and cleared by that candidate's next press.
 */
export function useRuleReview(): RuleReview {
  const { refresh } = useHeal();
  const { review, refusals, busyId } = useMemoryReview();
  // The candidate pressed and not yet settled: from the press until the heal summary has answered. Essential because the
  // door's `busyId` ends one read before the summary the card is drawn from does. One id, as the door's own is.
  const [settling, setSettling] = useState<string | null>(null);
  // Why a write never reached the queue, per candidate. Essential because the door's `refusals` holds only a 422's
  // words, and the response that said otherwise is read once and gone.
  const [unreached, setUnreached] = useState<Record<string, string>>({});
  // Mount flag: a press that resolves after the panel closed must not set state.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const press = useCallback(async (candidate: string, approve: boolean): Promise<void> => {
    setSettling(candidate);
    setUnreached((held) => forget(held, candidate));
    try {
      const outcome = await review(candidate, approve);
      if (outcome.kind === 'unreachable' && mountedRef.current) {
        setUnreached((held) => ({ ...held, [candidate]: outcome.reason }));
      }
    } finally {
      // After EVERY outcome: a refusal leaves the candidate pending but annotated, a `gone` means it was decided
      // elsewhere, and either way the summary is what tells the card. The release is in a `finally` of its own, so a
      // read that throws can never leave the presses off for the panel's life.
      try {
        await refresh();
      } finally {
        // Only this candidate's hold: a press on another card while this one settled owns the slot now.
        if (mountedRef.current) setSettling((current) => (current === candidate ? null : current));
      }
    }
  }, [refresh, review]);

  const onReview = useCallback((candidate: string, approve: boolean) => {
    void press(candidate, approve);
  }, [press]);

  return { busyId: busyId ?? settling, refusals: { ...refusals, ...unreached }, onReview };
}
