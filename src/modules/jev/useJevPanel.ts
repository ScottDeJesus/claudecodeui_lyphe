import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import { useServerFrame } from '@/shared/hooks/useServerFrame';
import type { JevRange, JevSummary } from '@/shared/types';

/** How many feed rows the tab asks for. The feed is the newest-first tail, not the whole file. */
const JEV_FEED = 50;

/** The frame an append to the Jev ledger sends (MAN-453). */
const JEV_FRAMES = ['jev_changed'] as const;

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
 * reading kept ACROSS a failed read, because a fault beside real numbers is a true screen while a
 * blank one is not.
 */
type SettledReading = { range: JevRange; data: JevSummary | null; error: string | null };

/**
 * The Jev view's whole read: `api.jev.summary` on mount, on each `jev_changed` (an append to the
 * ledger, paced by the server to one frame per ten seconds) and on a reconnect, in the shape of
 * `HealContext.tsx`.
 *
 * ONE question per window at a time and the newest answer wins, which is what the two tokens are
 * for: a read issued before a press must not land after the press's own read and put the pre-press
 * numbers back on screen. A frame heard while the tab is hidden is let pass — the reader it would wake
 * is a process this host pays for — and `visibilitychange` is what asks the moment the operator comes back.
 */
export function useJevPanel(range: JevRange): JevPanelRead {
  const [settled, setSettled] = useState<SettledReading | null>(null);

  // Mount flag: a read that resolves after this panel is gone must not set state on the run that
  // replaced it.
  const mountedRef = useRef(true);
  // Which read this is. Two can be open at once — a frame's and the one the refresh press asks
  // for — so each takes a token.
  const newestReadRef = useRef(0);
  // The newest token that has ANSWERED. An older answer landing after it is dropped rather than
  // published: a read that left BEFORE a press must not land after it and put the pre-press numbers
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

  // An append to the ledger is told by `jev_changed`. A hidden tab lets the frame pass: coming back to
  // the tab reads anyway (below), so what was heard while hidden is read the moment it is shown.
  useServerFrame(JEV_FRAMES, () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  useEffect(() => {
    mountedRef.current = true;
    // A new window is a new question and it is asked AT ONCE: the press that moved the range is
    // answered in the same breath as the label that moved with it.
    void refresh();

    // Coming back to the tab reads once: the frames heard while it was hidden were let pass (above).
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mountedRef.current = false;
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
