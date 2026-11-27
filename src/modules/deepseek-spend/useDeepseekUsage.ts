import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import { useServerFrame } from '@/shared/hooks/useServerFrame';
import type { DeepseekRange, DeepseekUsageSummary } from '@/shared/types';

/** The frame a moved transcript sends (MAN-453): the ledger may have a new row. */
const DEEPSEEK_USAGE_FRAMES = ['deepseek_usage_changed'] as const;

/** How many feed rows the view asks for. The feed is the newest-first tail, not the whole ledger. */
const DEEPSEEK_USAGE_FEED = 50;

/** What the panel draws and the one press it owns: the last reading, whether one is out, and the fault. */
export type DeepseekUsageRead = {
  data: DeepseekUsageSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * The last reading that SETTLED, tagged with the window it answered.
 *
 * The tag is the whole reason this is one value rather than three: a reading of another window is not
 * this window's numbers, so the moment the range moves the data is absent without anyone having to
 * clear it — no frame draws yesterday's totals under a `30d` label. `data` is likewise the reading
 * kept ACROSS a failed read, because a fault beside real numbers is a true screen while a blank one
 * is not.
 */
type SettledReading = { range: DeepseekRange; data: DeepseekUsageSummary | null; error: string | null };

/**
 * The DeepSeek view's whole read: `api.deepseek.usage` on mount, on each `deepseek_usage_changed`
 * (paced by the server to one per 10 s) and on a reconnect while the tab is shown, and when the tab is
 * shown again — in the shape of `useJevPanel`.
 *
 * ONE question per window at a time and the newest answer wins, which is what the two tokens are
 * for: a frame's read issued before a press must not land after the press's own read and put the
 * pre-press numbers back on screen. Each read spawns the ledger's reader, a process this host pays
 * for, which is why a frame heard while the tab is hidden is let pass and `visibilitychange` is what
 * asks the moment the operator comes back.
 */
export function useDeepseekUsage(range: DeepseekRange): DeepseekUsageRead {
  const [settled, setSettled] = useState<SettledReading | null>(null);

  // Mount flag: a read that resolves after this panel is gone must not set state on the run that
  // replaced it.
  const mountedRef = useRef(true);
  // Which read this is. Two can be open at once — a frame's and the one the refresh press asks for —
  // so each takes a token.
  const newestReadRef = useRef(0);
  // The newest token that has ANSWERED. An older answer landing after it is dropped rather than
  // published: a read that left BEFORE a press must not land after it and put the pre-press numbers
  // back on screen.
  const newestAnswerRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const token = ++newestReadRef.current;
    let next: DeepseekUsageSummary | null = null;
    let failure: string | null = null;
    try {
      // `readApiJson` and not `response.json()`: it throws on a non-2xx with the SERVER's own
      // sentence in hand, and that sentence is the reason the reader is shown below.
      next = await readApiJson<DeepseekUsageSummary>(await api.deepseek.usage(range, DEEPSEEK_USAGE_FEED));
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
      // Kept only from a reading of THIS window: last week's totals are not a stand-in for a
      // month's, and drawing them beside the fault would be two answers to one question.
      data: failure === null ? next : previous !== null && previous.range === range ? previous.data : null,
      error: failure,
    }));
  }, [range]);

  useEffect(() => {
    mountedRef.current = true;
    // A new window is a new question and it is asked AT ONCE: the press that moved the range is
    // answered in the same breath as the label that moved with it.
    void refresh();

    // Coming back to the tab is the one moment the ledger may have been written under a screen that
    // let its frames pass while hidden — what a person reads on return is a reading of now.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  // Told, not ticked: a moved transcript is the only thing that can add a row. A hidden tab lets the
  // frame pass, since showing the tab reads anyway and the reader is a process this host pays for.
  useServerFrame(DEEPSEEK_USAGE_FRAMES, () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  // A reading of another window is absent, not stale: the data is derived from the window it
  // answered, so the range moving empties the screen before any effect can run. That absence is also
  // what "loading" means here — the panel is waiting on a reading of the window it is showing,
  // whether that is the first one or the one a moved range just asked for.
  const current = settled !== null && settled.range === range ? settled : null;
  const data = current !== null ? current.data : null;
  const error = current !== null ? current.error : null;

  return { data, loading: current === null, error, refresh };
}
