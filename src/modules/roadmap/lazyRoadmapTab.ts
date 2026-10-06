import { lazy } from 'react';

/**
 * The Roadmap tab's pane, loaded on its first render and never before: the pane is its tab's whole tree
 * (the face, its cards, the In flight panel), so nothing that only imports this module's barrel pulls it
 * into the first page load. The ONE definition of that door: the barrel re-exports it for `WorkspaceMain`
 * (project-workspace, the `runner` tab's pane), and `RoadmapWidgetFullscreenBody` draws it inside the chat
 * gutter's Roadmap widget at full screen — both get the same lazy component and so the same chunk.
 */
export const RoadmapTab = lazy(() => import('@/modules/roadmap/RoadmapTab').then((m) => ({ default: m.RoadmapTab })));
