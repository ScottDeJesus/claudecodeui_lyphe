import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/**
 * A call that is made at once when it is first asked for and then at most once in `gapMs`: asked again inside the gap, it is
 * made ONCE more when the gap ends. So the first press of a button does its work now, and a person who presses it five times
 * in a second gets that work twice (now, and at the end of the second) and not five times over.
 *
 * It is not a poll. The timeout is armed by a call and ends by itself; with no call there is no timer, and it is cleared when
 * the caller goes.
 *
 * Used by this module's `useUploadsRead`, for Refresh.
 */
export function useThrottledCall(run: () => void, gapMs: number): () => void {
  const hostWindow = useHostWindow();
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  // The armed gap, if any, and whether a call was asked for inside it. Refs: they steer when `run` is called and nothing draws from them.
  const gap = useRef<number | null>(null);
  const waiting = useRef(false);

  useEffect(() => () => {
    if (gap.current !== null) hostWindow.clearTimeout(gap.current);
    gap.current = null;
    waiting.current = false;
  }, [hostWindow]);

  return useCallback(() => {
    if (gap.current !== null) {
      waiting.current = true;
      return;
    }
    const openGap = () => {
      gap.current = hostWindow.setTimeout(() => {
        gap.current = null;
        if (!waiting.current) return;
        waiting.current = false;
        latest.current();
        // The call made at the end of a gap opens the next one, so a press that follows it is held back too.
        openGap();
      }, gapMs);
    };
    latest.current();
    openGap();
  }, [hostWindow, gapMs]);
}
