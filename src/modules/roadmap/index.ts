// The roadmap lane's door into the live bus: `src/App.tsx` mounts it once, inside `UniverseFeed` and
// beside every other lane's feed, so the roadmap's picture is on the bus before any tab asks for it.
export { RoadmapFeed } from '@/modules/roadmap/RoadmapFeed';
// The Roadmap tab's pane: the roadmap as a tree from its goal, and the live cards of what is in flight.
// Lazy (defined once, in `lazyRoadmapTab`): the pane is its tab's whole tree and loads on the tab's first open, so
// importing this barrel for the feed never pulls the tree, its panel or the In flight panel into the first page
// load. (The widget below is eager: the chat gutter draws it open from the first paint, and its pieces come with
// it; only its full-screen body below reaches the pane, through the same lazy door.) Its consumer is
// src/modules/project-workspace (`WorkspaceMain`, as the `runner` tab's pane).
export { RoadmapTab } from '@/modules/roadmap/lazyRoadmapTab';
// The Roadmap widget's body: the tab's own roadmap face (the tree and its panel), in its column fit, with the
// way to the whole roadmap at its foot. Its consumer is src/modules/chat-gutters (`ChatGutterLayout`, as the
// Roadmap widget's body).
export { RoadmapWidgetBody } from '@/modules/roadmap/RoadmapWidgetBody';
// The same widget at full screen: the tab itself (both faces behind the one switch), drawn in the card that has the
// viewport. Its consumer is src/modules/chat-gutters (`ChatGutterLayout`, as the Roadmap widget's full-screen body).
export { RoadmapWidgetFullscreenBody } from '@/modules/roadmap/RoadmapWidgetFullscreenBody';
// The roadmap lane's read side: the picture and the ONE roadmap on screen. Its consumers are
// src/modules/chat-gutters (`ChatGutterLayout`, which reads the selected roadmap's standing for the widget's badge) and
// src/modules/station (`CardStage`, which names a card by its title in the picture, and the left rail's region, which draws
// the roadmap he selected).
export { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
// A feature's step in the roadmap's own words ("being designed", "waiting on you: Accept", "shipped Oct 27"), read off the
// live picture. Its consumer is src/modules/station (`RoadmapRows`, the left rail's feature rows), which says each feature's
// step exactly as the Roadmap tab says it.
export { useStepPhrase } from '@/modules/roadmap/hooks/useStepPhrase';
// A feature's dot as the tree paints it: its state (`dotStateOf`, blocked by the nearest reason above it) and the panel's own
// drawing of that state (`PanelDot`). Their consumer is src/modules/station (`RoadmapRows`), so a feature's dot on the rail and
// on the tree never disagree.
export { dotStateOf } from '@/modules/roadmap/utils/treeLayout';
export { PanelDot } from '@/modules/roadmap/panel/PanelRows';
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
