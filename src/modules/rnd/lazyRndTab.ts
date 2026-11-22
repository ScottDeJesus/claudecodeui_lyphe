import { lazy } from 'react';

/**
 * The R&D place's pane, loaded on its first render and never before: the panel, its Opening, dialogs and settings sheet are the
 * tab's whole tree, so nothing that only imports this module's barrel (App.tsx for the feed, PlacesProvider for the mark) pulls it
 * into the first page load. The ONE definition of that door: the barrel re-exports it for WorkspaceMain.
 */
export const RndTab = lazy(() => import('@/modules/rnd/RndPanel').then((m) => ({ default: m.RndPanel })));
