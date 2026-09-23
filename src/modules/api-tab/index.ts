import { lazy } from 'react';

// The api-tab module's public surface: the panel the API tab renders, and nothing else. Lazy, the way
// the Heal, Memory and Runner panels are: the panel is its tab's whole tree and loads on the tab's
// first open, so importing this barrel never pulls it into the first page load.
export const ApiPanel = lazy(() => import('@/modules/api-tab/ApiPanel').then((m) => ({ default: m.ApiPanel })));
