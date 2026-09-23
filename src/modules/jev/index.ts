import { lazy } from 'react';

// The jev module's public surface: the panel the Jev tab renders, and nothing else.
// Lazy, the way the Heal, Memory and Runner panels are: the panel is its tab's whole tree and loads
// on the tab's first open, so importing this barrel never pulls it into the first page load.
export const JevPanel = lazy(() => import('@/modules/jev/JevPanel').then((m) => ({ default: m.JevPanel })));
