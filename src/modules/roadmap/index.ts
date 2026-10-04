import { lazy } from 'react';

// The roadmap lane's door into the live bus: `src/App.tsx` mounts it once, inside `UniverseFeed` and
// beside every other lane's feed, so the roadmap's picture is on the bus before any tab asks for it.
export { RoadmapFeed } from '@/modules/roadmap/RoadmapFeed';
// The Roadmap tab's pane: the roadmap as a path to its goal, and the live cards of what is in flight.
// Lazy: the pane is its tab's whole tree and loads on the tab's first open, so importing this barrel
// for the feed never pulls the screen into the first page load. Its consumer is
// src/modules/project-workspace (`WorkspaceMain`, as the `runner` tab's pane).
export const RoadmapTab = lazy(() => import('@/modules/roadmap/RoadmapTab').then((m) => ({ default: m.RoadmapTab })));
