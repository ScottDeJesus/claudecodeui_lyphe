// The runner's door into the live bus. App mounts it once, inside LiveBusProvider.
export { RunnerFeed } from '@/modules/plan-runner/RunnerFeed';
// One run, whole. The Runner tab's panel is its one and only caller — never over the chat
// transcript (operator ruling 2026-09-09; docs/plan-runner.md, "The runner card").
export { RunCard } from '@/modules/plan-runner/RunCard';
// The Runner tab's pane: every run on the lane, each card open.
export { RunnerPanel } from '@/modules/plan-runner/RunnerPanel';
// The lane's read side, for a consumer that needs the runs rather than a card of one. The panel
// above reads it for the list; `useWorkspaceTabGates` reads it for the count that gates the tab.
export { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
