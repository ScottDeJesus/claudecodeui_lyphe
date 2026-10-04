import { lazy } from 'react';

// The roadmap lane's door into the live bus: `src/App.tsx` mounts it once, inside `UniverseFeed` and
// beside every other lane's feed, so the roadmap's picture is on the bus before any tab asks for it.
export { RoadmapFeed } from '@/modules/roadmap/RoadmapFeed';
// The Roadmap tab's pane: the roadmap as a path to its goal, and the live cards of what is in flight.
// Lazy: the pane is its tab's whole tree and loads on the tab's first open, so importing this barrel
// for the feed never pulls the face, its cards or the In flight panel into the first page load. (The widget
// below is eager: the chat gutter draws it open from the first paint, and its pieces come with it.) Its
// consumer is src/modules/project-workspace (`WorkspaceMain`, as the `runner` tab's pane).
export const RoadmapTab = lazy(() => import('@/modules/roadmap/RoadmapTab').then((m) => ({ default: m.RoadmapTab })));
// The Roadmap widget's body: the roadmap the tab shows, at a column's width, drawn from the tab's own pieces.
// Its consumer is src/modules/chat-gutters (`ChatGutterLayout`, as the Roadmap widget's body).
export { RoadmapWidgetBody } from '@/modules/roadmap/RoadmapWidgetBody';
// The roadmap lane's read side: the picture and the ONE roadmap on screen. Its consumer is
// src/modules/chat-gutters (`ChatGutterLayout`, which reads the selected roadmap's standing for the widget's badge).
export { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
