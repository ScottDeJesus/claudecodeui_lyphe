import { lazy } from 'react';

// The Analytics module's public surface: the area's pane, and nothing else. The frame, the registry and the sections
// stay inside the module: each file there imports its siblings by path, never through this barrel.

// The Analytics area's pane, mounted by src/modules/project-workspace (WorkspaceMain): the strip of sections and the
// chosen section's windows at its head, the chosen section under them.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this barrel for anything else
// never pulls the panel into the first page load.
export const AnalyticsPanel = lazy(() => import('@/modules/analytics/AnalyticsPanel').then((m) => ({ default: m.AnalyticsPanel })));
