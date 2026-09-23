import { lazy } from 'react';

// The runner's door into the live bus. App mounts it once, inside LiveBusProvider.
export { RunnerFeed } from '@/modules/plan-runner/RunnerFeed';
// The arc deck's door into the live bus, mounted by App nested directly inside RunnerFeed.
export { ArcFeed } from '@/modules/plan-runner/ArcFeed';
// The Runner tab's pane: every run on the lane, each card open.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const RunnerPanel = lazy(() => import('@/modules/plan-runner/RunnerPanel').then((m) => ({ default: m.RunnerPanel })));
// The lane as the desktop chat gutter draws it — the arc deck above, then the open chat's runs
// first, every card folded. The run card and the arc deck each have two homes, the Runner tab and
// this widget; both stay private to this module, reached only through the tab and the widget.
// Its consumer is src/modules/chat-gutters, which mounts it beside the transcript.
export { RunnerWidgetBody } from '@/modules/plan-runner/RunnerWidgetBody';
// The lane's read side, for a consumer that needs the runs rather than a card of one. The panel
// above reads it for the list; `useWorkspaceTabGates` reads it for the count that gates the tab.
export { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
// The arc deck's read side, for the gallery, for `useWorkspaceTabGates`' at-least-one-arc rule, and
// for the chat gutter's Runner badge (runs plus unfinished arcs).
export { useArcs } from '@/modules/plan-runner/hooks/useArcs';
