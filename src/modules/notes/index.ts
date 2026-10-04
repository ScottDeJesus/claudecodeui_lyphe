import { lazy } from 'react';

// The notes module's whole public surface: the provider App mounts, the reading the module's
// outside consumers ask for, the tab's pane and the chat gutter's widget body. The contexts, the
// drafts and the cards stay inside the module — each file there imports its siblings by path,
// never through this barrel.
export { NotesProvider } from '@/modules/notes/context/NotesProvider';

// Read by src/modules/chat-gutters (ChatGutterLayout) for the Notes widget's count. The module's
// own list and cards read the context by path, so this export serves the gutter and nothing else.
export { useNotes } from '@/modules/notes/context/NotesContext';

// The Notes tab's pane, mounted by src/modules/project-workspace (WorkspaceMain): the wall of
// cards under the header the Roadmap tab's In flight face and the Memory pane wear.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const NotesPanel = lazy(() => import('@/modules/notes/NotesPanel').then((m) => ({ default: m.NotesPanel })));

// The wall as the desktop chat gutter draws it, the Notes widget's body. Its consumer is
// src/modules/chat-gutters, which mounts it beside the transcript.
export { NotesWidgetBody } from '@/modules/notes/NotesWidgetBody';
