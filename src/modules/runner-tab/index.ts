import { lazy } from 'react';

// The Runner tab's pane: every plan the dispatcher carries, arcs as decks and the rest as cards.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const RunnerPanel = lazy(() => import('@/modules/runner-tab/RunnerPanel').then((m) => ({ default: m.RunnerPanel })));
// The same cards as the desktop chat gutter draws them — the arc decks above, then the plans of no
// arc with the open chat's first. Its consumer is src/modules/chat-gutters.
export { RunnerWidgetBody } from '@/modules/runner-tab/RunnerWidgetBody';
