// createPlanRunnerModule: used by the server entrypoint to mount the authenticated plan-runner lane at
// `/api/plan-runner` — the poll behind the `runner_state` frame, and the relay for the runner's own stop/resume.
export { createPlanRunnerModule } from './plan-runner.module.js';

// What a whole plan cost, read from the ledgers the runner already keeps. It is not the runner's
// own lane and no route of it serves this: the board hands it a card's plan path and draws the
// answer in the card drawer, so the server entrypoint composes the two — the board never imports
// this module, and this module never learns that a board exists.
export { planCostFor } from './plan-cost.service.js';
export type { PlanCost, PlanCostByKind } from './plan-cost.service.js';

// The plans-archive sweep: the four clauses that decide a finished plan may leave the corpus, and
// what one pass did. `createPlanRunnerModule` runs it on the archive watcher's cadence; this export
// is for a caller that wants one pass of its own (a probe, or a report), so it names the service
// once instead of reaching into the file.
export { sweepPlanArchive } from './plan-archive.service.js';
export type { PlanArchiveSweep } from './plan-archive.service.js';

// The next DeepSeek off-peak moment, off a command that prints one line. Two lanes want the same
// clock and there is deliberately only one of it: the v3 dispatcher's `offpeak` verb prints
// `plan-runner offpeak`'s line byte for byte (`hooks/dispatcher/cmd/schedule.py:16`), so the clock
// is TOLD which binary to ask rather than owning one. A second copy of this file would be a second
// cache to keep in step with the one the card's `Start at …` button reads.
export { createOffpeakClock } from './runner-offpeak.service.js';
