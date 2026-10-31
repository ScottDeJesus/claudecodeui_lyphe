import { Suspense, useEffect, useMemo, useState } from 'react';

import { preloadStationRoute, StationRoute } from '@/modules/station/lazyStationRoute';
import { useStationShowing } from '@/shared/context/StationLayerContext';

/**
 * The station's chunk is fetched once the browser has nothing else to do, a few seconds after the app is up (`requestIdleCallback`; a browser without it
 * waits this long). One fetch, never repeated, so the first visit to the station finds its code already here and every later switch fetches nothing.
 */
const PRELOAD_FALLBACK_MS = 3_000;

/** What the page shows between the press and the station's first paint, when the chunk is not here yet: the app's own canvas, wearing whichever theme he chose. */
function StationPlaceholder() {
  return <div className="fixed inset-0 bg-background" data-station-loading="" />;
}

/**
 * Kaylee Station's door into the app, rendered by `src/App.tsx` as the workspace's `stationLayer`: the one entry of the station's lazy chunk.
 *
 * THE STATION MOUNTS ON ITS FIRST VISIT AND STAYS MOUNTED. Mounting it when `/station` is first on screen (and not before) keeps the workspace's own
 * load free of it and spends the station's reads (his chats, what needs him, the week's landings) only for a window that ever opens it; keeping it mounted after
 * is what makes every later switch instant, a change of `visibility` on a page that is already drawn, with nothing fetched and nothing built. The chunk is
 * fetched when the browser is idle (`preloadStationRoute`), so even the first visit is a mount and not a download.
 *
 * Until the chunk is here the placeholder stands over the workspace, only while the station is the page on screen: a press back to the workspace
 * before the chunk arrives is never covered by it.
 */
export function StationLayer() {
  const showing = useStationShowing();
  // Whether the station has ever been the page on screen. State, because mounting it is the one thing this does and a sticky flag is what keeps it mounted after the workspace comes back.
  const [visited, setVisited] = useState(showing);
  if (showing && !visited) setVisited(true);

  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preloadStationRoute);
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preloadStationRoute, PRELOAD_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // One element for the layer's life: this component re-renders on every switch of pages (it reads `showing`), and a fresh `<StationRoute />` each time would
  // re-render the whole station under it. The same element is a bail-out.
  const route = useMemo(() => <StationRoute />, []);

  if (!visited) return null;
  return <Suspense fallback={showing ? <StationPlaceholder /> : null}>{route}</Suspense>;
}
