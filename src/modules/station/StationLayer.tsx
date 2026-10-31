import { Suspense, useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { preloadStationRoute, StationRoute } from '@/modules/station/lazyStationRoute';
import { backToCloudcli } from '@/shared/cloudcliDoors';
import { useStationDoors, useStationShowing } from '@/shared/context/StationLayerContext';
import { Banner, Button } from '@/shared/ui';

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
 * What the page shows where the station cannot be: its chunk would not load (a hashed file a deploy removed, a dropped connection: a `lazy` import that
 * failed stays failed until the page loads again) or it threw while drawing. A warn banner over the page, only while the station is on screen, with the way back to
 * the workspace and a reload; the workspace under it is untouched, where without this boundary the failure climbs to the app's own and replaces the rail, the open chat
 * and every draft with its error screen.
 */
function StationFailed({ showing }: { showing: boolean }) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  if (!showing) return null;
  return (
    <div role="alert" className="fixed inset-0 grid place-items-center overflow-auto bg-background p-4" data-station-failed="">
      <Banner
        tone="warn"
        action={(
          <div className="flex flex-none gap-2">
            <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs finger:h-11" onClick={() => backToCloudcli(doors.navigate, doors.workspacePath())}>
              {t('station.bar.back', { defaultValue: 'CloudCLI' })}
            </Button>
            <Button variant="tonal" size="sm" className="h-8 px-2.5 text-xs finger:h-11" onClick={() => window.location.reload()}>
              {t('viewBoundary.reload')}
            </Button>
          </div>
        )}
      >
        <p className="text-sm font-medium">{t('viewBoundary.failed', { view: 'Kaylee Station' })}</p>
        <p className="mt-0.5 text-xs">{t('viewBoundary.failedDetail', { view: 'Kaylee Station' })}</p>
      </Banner>
    </div>
  );
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
 * before the chunk arrives is never covered by it. A chunk that cannot load, or a station that throws, is `StationFailed`'s page and nothing more: the
 * boundary stands between the station and the workspace's own.
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
  return (
    <ErrorBoundary
      onError={(error) => console.error('Kaylee Station failed to load', error)}
      fallbackRender={() => <StationFailed showing={showing} />}
    >
      <Suspense fallback={showing ? <StationPlaceholder /> : null}>{route}</Suspense>
    </ErrorBoundary>
  );
}
