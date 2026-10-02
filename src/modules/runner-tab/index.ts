import { lazy } from 'react';

// The Runner tab's pane: every plan the dispatcher carries, arcs as decks and the rest as cards.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const RunnerPanel = lazy(() => import('@/modules/runner-tab/RunnerPanel').then((m) => ({ default: m.RunnerPanel })));
// The same lane as the desktop chat gutter draws it — one list of every arc deck and every plan of no
// arc, in the operator's own order. Its consumer is src/modules/chat-gutters.
export { RunnerWidgetBody } from '@/modules/runner-tab/RunnerWidgetBody';
