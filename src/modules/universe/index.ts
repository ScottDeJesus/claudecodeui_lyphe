// The universe lane's public surface. The map and the activity hooks stay module-private: they are
// the panel's own readers, and the canvas's reader is the one the panel owns rather than a second
// one for others.

import { lazy } from 'react';

// The feed `App` mounts inside LiveBusProvider — the only thing here that names the
// `universe_activity` frame and publishes the `universe:*` topic.
export { UniverseFeed } from '@/modules/universe/UniverseFeed';
// The Universe tab's whole pane: the sky and its chrome. Its consumer is the project workspace
// (`src/modules/project-workspace/WorkspaceMain.tsx`), which mounts it as a tab.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const UniversePanel = lazy(() => import('@/modules/universe/UniversePanel').then((m) => ({ default: m.UniversePanel })));
