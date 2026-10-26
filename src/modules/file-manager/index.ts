import { lazy } from 'react';

// Lazy, and used by the project-workspace module's WorkspaceMain as the Files pane: the view is its tab's
// whole tree and loads on the tab's first open, so importing this barrel for anything else never pulls
// it into the first page load.
export const FilesView = lazy(() => import('@/modules/file-manager/FilesView').then((m) => ({ default: m.FilesView })));

// Used by the project-workspace module's state provider, which matches each pin to a registered project
// to build the Files strip's roots. Plain, not lazy: it is a few lines over the preference store.
export { useFilesPins } from '@/modules/file-manager/hooks/useFilesPins';
