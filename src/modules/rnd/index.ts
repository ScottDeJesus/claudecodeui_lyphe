// The R&D lane's door into the live bus: src/App.tsx mounts it once, beside RoadmapFeed, so the picture is on the bus before
// the place is opened and the wheel's mark is lit from any page.
export { RndFeed } from '@/modules/rnd/RndFeed';
// The R&D place's pane, lazy (lazyRndTab): its consumer is src/modules/project-workspace (WorkspaceMain, the rnd tab's pane).
export { RndTab } from '@/modules/rnd/lazyRndTab';
// The place's mark on the wheel: a proved candidate, or one filed since he last stood there. Its consumer is project-workspace's
// PlacesProvider.
export { useRndMark } from '@/modules/rnd/hooks/useRndSeen';
