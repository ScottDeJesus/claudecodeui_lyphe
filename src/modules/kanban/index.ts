// The board's one door. Its consumer is src/modules/project-workspace/WorkspaceMain.tsx, which
// mounts it while the Kanban tab is active and unmounts it the moment another tab is.
//
// NOTHING ELSE LEAVES THIS MODULE — not the hooks, not the card drawer, not the lane policy. The
// panel is the whole public surface, and a second export is how a policy that must be decided in
// one place starts being read in two.
export { KanbanPanel } from '@/modules/kanban/KanbanPanel';
