import type { RunnerPhaseState, RunnerRunSnapshot, RunnerRunState, Tone } from '@/shared/types';

/**
 * The pure vocabulary of a run, in one file with no React in it.
 *
 * Everything here is a total function of a snapshot the server already sent. Nothing polls,
 * nothing fetches and nothing remembers: a card that needs a fact about a run asks one of these,
 * so two screens reading the same run can never disagree about what colour it is or how far it
 * has got. The elapsed clocks are the one exception and they live in `hooks/useElapsed.ts`,
 * because a clock is the only thing here that changes without the data changing.
 */

/** How a run's state reaches the eye. Never `danger`: a stale or parked run is a warning, not a denial. An ended run's badge is its OUTCOME's — see {@link runOutcomeTone}. */
export function runStateTone(state: RunnerRunState): Tone {
  if (state === 'live') return 'positive';
  if (state === 'paused' || state === 'ended') return 'neutral';
  return 'warn';
}

/**
 * Whether an ended run left work on the table: any phase still `blocked` or `pending`.
 *
 * Read from the PHASES and never from the receipt's word. The runner's `complete` means "the walk
 * ended and something shipped" (`pipeline.py:116` initialises the status to `complete` and only
 * downgrades it to `all-blocked` when NOTHING shipped), so 14 of the 21 `complete` receipts on
 * this host carried blocked phases. `deferred` is a phase the plan chose not to walk and counts
 * as finished; `shipped` is finished. `running` is deliberately NOT unfinished: the runner writes
 * the receipt before its final progress write (`pipeline.py::_finish`), so for one poll tick a
 * genuinely complete run is an `ended` snapshot whose last phase still reads `running`, and
 * counting it would flash INCOMPLETE over a run that finished.
 */
export function runUnfinished(run: RunnerRunSnapshot): boolean {
  return (run.phases ?? []).some((phase) => phase.state === 'blocked' || phase.state === 'pending');
}

/**
 * The word an ended run's badge carries. The runner's own outcome word, except that a `complete`
 * ending with phases still blocked or pending reads `incomplete` — the runner's `complete` is not
 * "nothing left to do" (see {@link runUnfinished}), and a green COMPLETE over five blocked phases
 * would be the card saying the ending was good when the runner wrote a resume brief for it.
 */
export function runOutcomeWord(run: RunnerRunSnapshot): string {
  const outcome = run.outcome ?? 'unknown';
  return outcome === 'complete' && runUnfinished(run) ? 'incomplete' : outcome;
}

/**
 * How an ended run's outcome reaches the eye. Positive only for a `complete` ending with nothing
 * left; every other ending (`halted`, `all-blocked`, `budget`, `flag-off`, or `complete` with
 * blocked phases) is a run that stopped short and wants a look — amber, never red (design
 * doctrine :145): nothing was denied.
 */
export function runOutcomeTone(run: RunnerRunSnapshot): Tone {
  return runOutcomeWord(run) === 'complete' ? 'positive' : 'warn';
}

/**
 * The same for one phase. `blocked` is amber rather than red on purpose (design doctrine :145 —
 * red is destructive or denied, and a blocked phase is neither; it is a phase asking for a hand).
 */
export function phaseStateTone(state: RunnerPhaseState): Tone {
  if (state === 'shipped') return 'positive';
  if (state === 'running') return 'info';
  if (state === 'blocked') return 'warn';
  return 'neutral';
}

/**
 * The runner's own five phase marks, so a state never reaches a reader as colour alone
 * (design doctrine :147-149). These are the glyphs `PLAN_FORMAT_V2.md` §8 renders in the
 * terminal progress block, and the terminal and this card deliberately read identically.
 */
export const PHASE_GLYPH: Record<RunnerPhaseState, string> = {
  shipped: '✅',
  running: '▶',
  blocked: '⛔',
  deferred: '≡',
  pending: '·',
};

/**
 * Every stage word the runner can be in, in the order it walks them.
 *
 * A MIRROR of the runner's own list — `hooks/plan_runner/state.py:90`, the comment on
 * `PhaseState.stage`: `builder|athena|fix-pass|checks|prometheus|shiplog`. It is copied rather
 * than derived because the runner is a separate program this app only ever reads; when the runner
 * grows a seventh stage, this line is what has to follow it.
 */
export const PIPELINE_STAGES = ['builder', 'athena', 'fix-pass', 'checks', 'prometheus', 'shiplog'] as const;

/** The three stages that exist only to review code. Dropped whole when a phase changes none. */
const REVIEW_STAGES: readonly string[] = ['athena', 'fix-pass', 'prometheus'];

/**
 * The stages THIS run's current phase will actually walk.
 *
 * The inverse of `hooks/plan_runner/progress.py::pipeline_chain`, which composes the `Pipeline:`
 * words by appending `athena` and `prometheus` to the builder's name only when the phase changes
 * code. So a pipeline string carrying `athena` is a reviewed phase and gets the full six; one
 * without it is a doc- or config-only phase, whose fix-pass and reviewers will never run and must
 * not be drawn as though they were merely still to come.
 */
export function pipelineForRun(run: RunnerRunSnapshot): string[] {
  const reviewed = (run.position?.pipeline ?? '').includes('athena');
  return PIPELINE_STAGES.filter((stage) => reviewed || !REVIEW_STAGES.includes(stage));
}

/**
 * The stage words the runner has ALREADY been through in the phase it is standing in.
 *
 * Read from the timeline it wrote — the entries whose `phase_id` is the current phase's, deduped,
 * in the order they first appeared. Never inferred from a stage's POSITION in the list: a
 * `fix-pass` the runner skipped because Athena found nothing sits left of `checks` and never ran,
 * and marking it done by position would report a review that never happened.
 */
export function seenStages(run: RunnerRunSnapshot): string[] {
  const phaseId = run.position?.phase_id;
  if (!phaseId) return [];

  const walked: string[] = [];
  for (const entry of run.timeline ?? []) {
    if (entry.phase_id !== phaseId) continue;
    if (!walked.includes(entry.stage)) walked.push(entry.stage);
  }
  return walked;
}

/**
 * How much of the plan is behind the run. Shipped phases only — `deferred` is a phase the run
 * decided not to walk, and counting it as progress would report a plan more finished than it is.
 */
export function phaseProgress(run: RunnerRunSnapshot): { shipped: number; total: number; percent: number } {
  const phases = run.phases ?? [];
  const total = phases.length;
  const shipped = phases.filter((phase) => phase.state === 'shipped').length;
  return { shipped, total, percent: total === 0 ? 0 : Math.round((shipped / total) * 100) };
}
