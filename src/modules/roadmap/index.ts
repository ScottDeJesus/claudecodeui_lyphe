// The roadmap lane's door into the live bus: `src/App.tsx` mounts it once, inside `UniverseFeed` and
// beside every other lane's feed, so the roadmap's picture is on the bus before any tab asks for it.
export { RoadmapFeed } from '@/modules/roadmap/RoadmapFeed';
// The Roadmap tab's pane: the roadmap as a path to its goal, and the live cards of what is in flight.
// Lazy (defined once, in `lazyRoadmapTab`): the pane is its tab's whole tree and loads on the tab's first open, so
// importing this barrel for the feed never pulls the face, its cards or the In flight panel into the first page
// load. (The widget below is eager: the chat gutter draws it open from the first paint, and its pieces come with
// it; only its full-screen body below reaches the pane, through the same lazy door.) Its consumer is
// src/modules/project-workspace (`WorkspaceMain`, as the `runner` tab's pane).
export { RoadmapTab } from '@/modules/roadmap/lazyRoadmapTab';
// The Roadmap widget's body: the roadmap the tab shows, at a column's width, drawn from the tab's own pieces.
// Its consumer is src/modules/chat-gutters (`ChatGutterLayout`, as the Roadmap widget's body).
export { RoadmapWidgetBody } from '@/modules/roadmap/RoadmapWidgetBody';
// The same widget at full screen: the tab itself (both faces behind the one switch), drawn in the card that has the
// viewport. Its consumer is src/modules/chat-gutters (`ChatGutterLayout`, as the Roadmap widget's full-screen body).
export { RoadmapWidgetFullscreenBody } from '@/modules/roadmap/RoadmapWidgetFullscreenBody';
// The roadmap lane's read side: the picture and the ONE roadmap on screen. Its consumer is
// src/modules/chat-gutters (`ChatGutterLayout`, which reads the selected roadmap's standing for the widget's badge).
export { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
