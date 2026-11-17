import { lazy } from 'react';

// The notes module's whole public surface: the provider App mounts and the tab's pane. The contexts,
// the drafts and the cards stay inside the module — each file there imports its siblings by path,
// never through this barrel.
export { NotesProvider } from '@/modules/notes/context/NotesProvider';

// The Notes tab's pane, mounted by src/modules/project-workspace (WorkspaceMain): the wall of
// cards under the header the Roadmap tab's In flight face and the Memory pane wear.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const NotesPanel = lazy(() => import('@/modules/notes/NotesPanel').then((m) => ({ default: m.NotesPanel })));
