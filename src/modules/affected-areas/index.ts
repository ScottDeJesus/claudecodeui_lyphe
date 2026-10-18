import { lazy } from 'react';

// The affected-areas module's public surface: the Tours view and the surround it is mounted in. Its screens, its
// utils and its hooks stay inside the module; each file there imports its siblings by path, never through this barrel.

// The Tours view, mounted by src/modules/cerberus (CerberusPanel) as the fourth view of the Cerberus tab's strip —
// the operator's ruling of 2026-10-13 that the UI lives in that tab — while its code stays its own module. Lazy: the
// view is its own chunk, loaded the first time Tours is shown, so opening the Cerberus tab never pulls it in.
export const AffectedAreasView = lazy(() => import('@/modules/affected-areas/AffectedAreasView').then((m) => ({ default: m.AffectedAreasView })));

// The waiting ring and the failure banner that stand around the lazy view, mounted by src/modules/cerberus
// (CerberusPanel) around `AffectedAreasView`: a chunk that cannot load stays a Tours-only message, never the whole
// tab's. Not lazy: it must be there to catch the failure of the chunk it surrounds.
export { ViewBoundary } from '@/modules/affected-areas/ViewBoundary';
