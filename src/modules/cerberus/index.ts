import { lazy } from 'react';

// The Cerberus module's public surface: the provider App mounts, the one count the workspace
// strip reads, and the tab's pane. The context's verbs, the views, the sheet and the dialogs stay
// inside the module — each file there imports its siblings by path, never through this barrel.

// Mounted by src/App.tsx beside HealProvider, ABOVE the Router and inside the auth gate: the tab's
// views, its header and the strip's count pill all read the one overview it keeps, so it cannot live
// inside the tab's own tree.
export { CerberusProvider } from '@/modules/cerberus/context/CerberusProvider';

// Read by src/modules/project-workspace (useWorkspaceTabGates) for the Cerberus tab's count pill:
// how many checks need a person right now, `0` until the first read answers.
export { useCerberusNeeds } from '@/modules/cerberus/context/CerberusContext';

// The Cerberus tab's pane, mounted by src/modules/project-workspace (WorkspaceMain): the fleet's
// health under its header, Fleet and History beneath, with the check sheet and the Mute and Enroll
// dialogs over them.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const CerberusPanel = lazy(() => import('@/modules/cerberus/CerberusPanel').then((m) => ({ default: m.CerberusPanel })));
