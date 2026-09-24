// The runner's door into the live bus. App mounts it once, inside LiveBusProvider.
export { RunnerFeed } from '@/modules/plan-runner/RunnerFeed';
// The arc deck's door into the live bus, mounted by App nested directly inside RunnerFeed.
export { ArcFeed } from '@/modules/plan-runner/ArcFeed';
// The run card and the pieces the Runner tab's two lists compose it with. The lists themselves live
// in src/modules/runner-tab, which draws this lane's runs and the dispatcher's v3 plans in ONE list:
// a host above both lanes, so neither lane imports the other.
export { RunCard } from '@/modules/plan-runner/RunCard';
export { ArcGallery } from '@/modules/plan-runner/ArcGallery';
export { SessionPin } from '@/modules/plan-runner/SessionPin';
export { useArcRunIds } from '@/modules/plan-runner/hooks/useArcRunIds';
export { byUrgencyThenNewest } from '@/modules/plan-runner/runState';
// What a run, a plan and a soul have spent, in the one spelling every card draws it in: paid dollars
// labelled by the vendor that billed them (`$0.41 DeepSeek`, and nothing at all when nothing was
// billed — Claude work is counted in tokens, never dollars), and the CLAUDE records' tokens, which
// are nothing at all where a vendor billed the work. DOLLARS **OR** TOKENS, BY WHO WAS USED. Exported
// because THREE lanes draw this figure off three different records — the run card here, the
// dispatcher's plan card and the chat strip's launcher-soul pin — and a per-lane copy of it is how
// one app says `$0.41` on one screen and `0.41 USD` on the next.
export { humanizeTokens, paidText, planKindsText, planPaidText, spendText, usageText } from '@/modules/plan-runner/spend';
export type { PlanKindSpend } from '@/modules/plan-runner/spend';
// `Start at …` / `Cancel`, for the run card, the arc deck and the dispatcher's plan card (scope `plan`).
export { ScheduleControl } from '@/modules/plan-runner/ScheduleControl';
// The lane's read side, for a consumer that needs the runs rather than a card of one. The Runner
// tab's panel reads it for the list; `useWorkspaceTabGates` reads it for the count that gates the tab.
export { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
// The arc deck's read side, for the gallery, for `useWorkspaceTabGates`' at-least-one-arc rule, and
// for the chat gutter's Runner badge (runs plus unfinished arcs).
export { useArcs } from '@/modules/plan-runner/hooks/useArcs';
// The one rendering of a scheduled moment, for a card outside this module that names one (the
// dispatcher's plan card reads it through its own barrel, which re-exports this): the runner lane
// owns the clock, and a second copy of it would be a second opinion about the same hour.
export { scheduleClock } from '@/modules/plan-runner/runState';
// Which endings the operator has waved away, and the one way to add to that list. Exported because
// the dismissal list is PER USER, not per lane: a v3 plan's card is dismissed into the same list
// the run cards use (its id is the `v3:<name>` form), so the plan card reads and writes it here
// rather than growing a second store that could disagree about what the operator has seen.
// `DISPATCHER_ENDING_PREFIX` is that form itself, exported for the same reason: the store owns the
// half of its own address space that belongs to the plan lane, and the plan lane reads it here.
export { DISPATCHER_ENDING_PREFIX, dismissRun, useDismissedEndings } from '@/modules/plan-runner/dismissedRuns';
export type { DismissedEnding } from '@/modules/plan-runner/dismissedRuns';
