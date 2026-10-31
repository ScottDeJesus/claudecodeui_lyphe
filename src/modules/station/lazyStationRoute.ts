import { lazy } from 'react';

/** The one import of the station's chunk: the lazy component and the early fetch share it, so the browser loads the chunk once. */
const loadStationRoute = () => import('@/modules/station/StationRoute').then((m) => ({ default: m.StationRoute }));

/**
 * The station's page, loaded on its first visit and never before: the station is a page of its own (the stage, the dispatcher's cards, the
 * roadmap's facts), so the workspace's first load must not pull it. The ONE definition of that door: `StationLayer` stands it in a `Suspense`.
 */
export const StationRoute = lazy(loadStationRoute);

/**
 * Starts the chunk's fetch without mounting anything, so the first visit finds it already here. Called once by `StationLayer`, when the browser is idle. A fetch
 * that fails (a hashed file a deploy removed, a dropped connection) is not this call's to report: the first visit asks for the same chunk, meets the same
 * failure, and `StationLayer`'s boundary says so there, where he is waiting for it.
 */
export function preloadStationRoute(): void {
  loadStationRoute().catch(() => undefined);
}
