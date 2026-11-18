// The roadmap lane's door into the live bus: `src/App.tsx` mounts it once, inside `UniverseFeed` and
// beside every other lane's feed, so the roadmap's picture is on the bus before any tab asks for it.
export { RoadmapFeed } from '@/modules/roadmap/RoadmapFeed';
// The Roadmap tab's pane: the roadmap as a tree from its goal, and the live cards of what is in flight.
// Lazy (defined once, in `lazyRoadmapTab`): the pane is its tab's whole tree and loads on the tab's first open, so
// importing this barrel for the feed never pulls the tree, its panel or the In flight panel into the first page
// load. Its consumer is src/modules/project-workspace (`WorkspaceMain`, as the `runner` tab's pane).
export { RoadmapTab } from '@/modules/roadmap/lazyRoadmapTab';
// The roadmap lane's read side: the picture and the ONE roadmap on screen. Its consumer is
// src/modules/station (`CardStage`, which names a card by its title in the picture).
export { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
// The roadmap's own facts of a feature (the feature dialog's body) and of an epic (the tree's epic panel), the
// existing drawings and never a second one. Their consumer is src/modules/station (`CardStage`), which draws them on
// the stage for a feature or an epic the dispatcher no longer holds.
export { FeatureFacts } from '@/modules/roadmap/modals/FeatureFacts';
export { EpicPanel } from '@/modules/roadmap/panel/EpicPanel';
// What the roadmap holds under one name, shaped for those two drawings (the feature with its Cases section; the epic with
// its milestone's place and its features' dots). Its consumer is src/modules/station (`CardStage`).
export { useRoadmapCard } from '@/modules/roadmap/hooks/useRoadmapCard';
export type { RoadmapCardFacts } from '@/modules/roadmap/hooks/useRoadmapCard';
// The roadmap's dialogs on a page with no Roadmap face: the presses of the two above (an epic's menu and Add a
// feature, a feature's empty goal) open the roadmap's own dialogs under it. Its consumer is src/modules/station
// (`CardStage`, around the stage's roadmap facts).
export { RoadmapDialogHost } from '@/modules/roadmap/RoadmapDialogHost';
// The roadmap as one small circle that stands up as the whole stack when pressed, for a page that is not the roadmap's: project-workspace's sessions
// home (`WorkspaceHome`) draws it at its head, and the station's scene (`StationShell`) over the companion's column while a thing is on the panel.
export { RoadmapCircle } from '@/modules/roadmap/RoadmapCircle';
// The same roadmap already standing as the whole stack, for a page with the room for it: the station's scene (`StationShell`) draws it over the companion
// while nothing is on the panel, and the circle above in its place while something is.
export { RoadmapStanding } from '@/modules/roadmap/RoadmapStanding';
