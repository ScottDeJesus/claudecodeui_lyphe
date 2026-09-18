import { lazy } from 'react';

// The board's one door. Its consumer is src/modules/project-workspace/WorkspaceMain.tsx, which
// mounts it while the Kanban tab is active and unmounts it the moment another tab is.
//
// NOTHING ELSE LEAVES THIS MODULE — not the hooks, not the card drawer, not the lane policy. The
// panel is the whole public surface, and a second export is how a policy that must be decided in
// one place starts being read in two.

// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const KanbanPanel = lazy(() => import('@/modules/kanban/KanbanPanel').then((m) => ({ default: m.KanbanPanel })));
