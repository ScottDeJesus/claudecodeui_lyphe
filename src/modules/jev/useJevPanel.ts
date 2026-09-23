import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { JevRange, JevSummary } from '@/shared/types';

/**
 * How often the tab asks the reader again.
 *
 * Ten seconds because each poll spawns one Python process on this host — the reader is a command,
 * not a table the browser can query — and the screen is a ledger of what Jev has already done
 * rather than a live meter. Faster is a process a second for a number nobody acts on that fast.
 */
export const JEV_POLL_MS = 10_000;

/** How many feed rows the tab asks for. The feed is the newest-first tail, not the whole file. */
const JEV_FEED = 50;

/** What the panel draws and the one press it owns: the last reading, whether one is out, and the fault. */
export type JevPanelRead = {
  data: JevSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * The last reading that SETTLED, tagged with the window it answered.
 *
 * The tag is the whole reason this is one value rather than three: a reading of another window is
 * not this window's numbers, so the moment the range moves the data is absent without anyone having
 * to clear it — no frame draws the last week's ledger under a `30d` label. `data` is likewise the
 * reading kept ACROSS a failed poll, because a fault beside real numbers is a true screen while a
 * blank one is not.
 */
type SettledReading = { range: JevRange; data: JevSummary | null; error: string | null };

/**
 * The Jev view's whole read: `api.jev.summary` on a timer, in the shape of `HealContext.tsx:91-129`.
 *
 * ONE question per window at a time and the newest answer wins, which is what the two tokens are
 * for: a poll issued before a press must not land after the press's own read and put the pre-press
 * numbers back on screen for ten seconds. The interval stands down while the tab is hidden — a
 * backgrounded timer is throttled to near-nothing anyway, and the reader it would wake is a process
 * this host pays for — and `visibilitychange` is what asks the moment the operator comes back.
 */
export function useJevPanel(range: JevRange): JevPanelRead {
  const [settled, setSettled] = useState<SettledReading | null>(null);

  // Mount flag: a read that resolves after this panel is gone must not set state on the run that
  // replaced it.
  const mountedRef = useRef(true);
  // Which read this is. Two can be open at once — the interval's and the one the refresh press asks
  // for — so each takes a token.
  const newestReadRef = useRef(0);
  // The newest token that has ANSWERED. An older answer landing after it is dropped rather than
  // published: a poll that left BEFORE a press must not land after it and put the pre-press numbers
  // back on screen.
  const newestAnswerRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const token = ++newestReadRef.current;
    let next: JevSummary | null = null;
    let failure: string | null = null;
    try {
      // `readApiJson` and not `response.json()`: it throws on a non-2xx with the SERVER's own
      // sentence in hand, and that sentence is the reason the reader is shown below.
      next = await readApiJson<JevSummary>(await api.jev.summary(range, JEV_FEED));
    } catch (cause) {
      // The route answers the reader's own sentence on a refusal (`unreachable`, `unreadable`), so a
      // throw here is that sentence or this app's own network. Either way the reader is owed the
      // words: a ledger that cannot be read is neither a spinner nor the last reading still there.
      failure = cause instanceof Error ? cause.message : 'unreachable';
    }
    // A reading, but not the newest one: the screen already shows something later than this.
    if (token < newestAnswerRef.current) return;
    newestAnswerRef.current = token;
    if (!mountedRef.current) return;
    setSettled((previous) => ({
      range,
      // Kept only from a reading of THIS window: the last week's totals are not a stand-in for a
      // month's, and drawing them beside the fault would be two answers to one question.
      data: failure === null ? next : previous !== null && previous.range === range ? previous.data : null,
      error: failure,
    }));
  }, [range]);

  useEffect(() => {
    mountedRef.current = true;
    // A new window is a new question and it is asked AT ONCE rather than at the next tick: the
    // press that moved the range is answered in the same breath as the label that moved with it.
    void refresh();

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
    }, JEV_POLL_MS);

    // Coming back to the tab is the one moment the ledger has been written under a screen that would
    // otherwise never ask again — what a person reads on return is a reading of now, not of whenever
    // the browser last let the timer through.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  // A reading of another window is absent, not stale: the data is derived from the window it
  // answered, so the range moving empties the screen before any effect can run. That absence is
  // also what "loading" means here — the panel is waiting on a reading of the window it is showing,
  // whether that is the first one or the one a moved range just asked for.
  const current = settled !== null && settled.range === range ? settled : null;
  const data = current !== null ? current.data : null;
  const error = current !== null ? current.error : null;

  return { data, loading: current === null, error, refresh };
}
