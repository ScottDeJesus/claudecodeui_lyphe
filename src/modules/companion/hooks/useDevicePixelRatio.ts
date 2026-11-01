import { useCallback, useSyncExternalStore } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/**
 * Used by this module's useFaceAtlas (which tier of her atlas covers the pixels a portrait is drawn at) and useCanvasBackingSide
 * (the pixels a canvas's backing store holds): how many device pixels the window she is drawn in has to one CSS pixel, now and
 * whenever it changes (page zoom, or the window moving to a screen of another density). An event, never a poll.
 */
export function useDevicePixelRatio(): number {
  const hostWindow = useHostWindow();
  const subscribe = useCallback((onChange: () => void) => {
    // `(resolution: Ndppx)` stops matching exactly when the ratio leaves N, so one query is armed for the ratio as it is and armed
    // again for the new ratio each time it fires.
    let query: MediaQueryList | null = null;
    const arm = (): void => {
      query = hostWindow.matchMedia(`(resolution: ${hostWindow.devicePixelRatio}dppx)`);
      query.addEventListener('change', onRatioChange, { once: true });
    };
    const onRatioChange = (): void => {
      onChange();
      arm();
    };
    arm();
    return () => query?.removeEventListener('change', onRatioChange);
  }, [hostWindow]);
  return useSyncExternalStore(subscribe, () => hostWindow.devicePixelRatio || 1);
}
