import { lazy } from 'react';

// The Runner tab's pane: every plan-runner run and every dispatcher v3 plan, one list, each card open.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const RunnerPanel = lazy(() => import('@/modules/runner-tab/RunnerPanel').then((m) => ({ default: m.RunnerPanel })));
// The same list as the desktop chat gutter draws it — the arc deck above, then the open chat's
// plans and runs first, every card folded. Its consumer is src/modules/chat-gutters.
export { RunnerWidgetBody } from '@/modules/runner-tab/RunnerWidgetBody';
