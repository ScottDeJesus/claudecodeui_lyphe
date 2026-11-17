import { lazy } from 'react';

// The Roadmap tab's In flight face: every plan the dispatcher carries, arcs as decks and the rest as cards.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const RunnerPanel = lazy(() => import('@/modules/runner-tab/RunnerPanel').then((m) => ({ default: m.RunnerPanel })));
