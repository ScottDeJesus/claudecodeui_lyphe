import { lazy } from 'react';

/**
 * The station's route, loaded on its first visit and never before: the station is a page of its own (the stage, the
 * dispatcher's cards, the roadmap's facts), so the workspace's first load must not pull it. The ONE definition of that
 * door: the barrel re-exports it for `src/App.tsx`, which stands it in a `Suspense`.
 */
export const StationRoute = lazy(() => import('@/modules/station/StationRoute').then((m) => ({ default: m.StationRoute })));
