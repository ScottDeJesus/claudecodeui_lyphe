import { lazy } from 'react';

// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const StandaloneShell = lazy(() => import('@/modules/standalone-shell/StandaloneShell'));
