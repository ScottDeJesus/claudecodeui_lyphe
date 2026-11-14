import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/**
 * A call that many events ask for and one makes. The first request arms a single timeout of `windowMs`; requests that come
 * while it is armed are absorbed; when it fires, the LATEST `run` is called once. So a run that writes five frames in a
 * second is read once, a second after the first of them.
 *
 * This is not a poll. The timeout is armed only by an event and fires once, and nothing re-arms it: with no event there is
 * no timer. It is cleared when `active` goes false (the view is hidden) and when the caller goes, so nothing is read after
 * the view is put away.
 *
 * Returns the request. It is a new function when `active` changes, so a caller that reads it from a listener holds it by ref.
 *
 * Used by this module's `useUploadsRead` and `useRunSheet`.
 */
export function useCoalescedCall(run: () => void, windowMs: number, active: boolean): () => void {
  const hostWindow = useHostWindow();
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  // The armed timeout, if any. A ref: it steers when `run` is called and nothing draws from it.
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current === null) return;
    hostWindow.clearTimeout(timer.current);
    timer.current = null;
  }, [hostWindow]);

  useEffect(() => {
    if (!active) cancel();
    return cancel;
  }, [active, cancel]);

  return useCallback(() => {
    if (!active || timer.current !== null) return;
    timer.current = hostWindow.setTimeout(() => {
      timer.current = null;
      latest.current();
    }, windowMs);
  }, [active, hostWindow, windowMs]);
}
