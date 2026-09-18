import { lazy } from 'react';

// The runner's door into the live bus. App mounts it once, inside LiveBusProvider.
export { RunnerFeed } from '@/modules/plan-runner/RunnerFeed';
// One run, whole. The card has two homes: the Runner tab, and the desktop chat gutter
// (src/modules/chat-gutters) — beside the transcript, never over it.
export { RunCard } from '@/modules/plan-runner/RunCard';
// The Runner tab's pane: every run on the lane, each card open.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const RunnerPanel = lazy(() => import('@/modules/plan-runner/RunnerPanel').then((m) => ({ default: m.RunnerPanel })));
// The lane as the desktop chat gutter draws it — the open chat's runs first, every card folded.
// Its consumer is src/modules/chat-gutters, which mounts it beside the transcript.
export { RunnerWidgetBody } from '@/modules/plan-runner/RunnerWidgetBody';
// The lane's read side, for a consumer that needs the runs rather than a card of one. The panel
// above reads it for the list; `useWorkspaceTabGates` reads it for the count that gates the tab.
export { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
