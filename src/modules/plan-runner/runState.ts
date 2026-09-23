import type { RunnerPhaseState, RunnerRunSnapshot, RunnerRunState, Tone } from '@/shared/types';

/**
 * The pure vocabulary of a run, in one file with no React in it.
 *
 * Everything here is a total function of a snapshot the server already sent. Nothing polls,
 * nothing fetches and nothing remembers: a card that needs a fact about a run asks one of these,
 * so two screens reading the same run can never disagree about what colour it is or how far it
 * has got. The elapsed clocks are the one exception and they live in `@/shared/hooks/useElapsed`,
 * because a clock is the only thing here that changes without the data changing.
 */

/** How a run's state reaches the eye. Never `danger`: a stale or parked run is a warning, not a denial. An ended run's badge is its OUTCOME's — see {@link runOutcomeTone}. A QUEUED run is `neutral` with PAUSED and ENDED: it is parked on purpose, nothing is wrong, and amber would read as a hand wanted. */
export function runStateTone(state: RunnerRunState): Tone {
  if (state === 'live') return 'positive';
  if (state === 'paused' || state === 'queued' || state === 'ended') return 'neutral';
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
 * One live lane of a run: `lane` is the lane's id — the phase id it carries, a phase running on
 * exactly one lane — `rank` the phase's place in the census, `stage`/`stage_detail` the runner's
 * own stage words and `stage_since` epoch SECONDS, like every timestamp in a snapshot.
 *
 * Declared here rather than imported: the server's `RunnerRunSnapshot` gained this array in the
 * swarm work, and the client's mirror of that shape has not been widened yet, so the card reads
 * the rows defensively (see {@link runLanes}) instead of naming a field the mirror does not have.
 * When the mirror catches up this type is the one to replace with the shared import.
 */
export type RunnerLane = {
  lane: string;
  phase_id: string;
  rank: number;
  title: string;
  stage: string;
  stage_detail: string;
  stage_since: number;
};

/** One lane row as the card can draw it, or `null` for a record nothing can be drawn from. */
function asLane(raw: unknown): RunnerLane | null {
  if (raw === null || typeof raw !== 'object') return null;
  const held = raw as Record<string, unknown>;
  // The id pair is the row's identity: a lane with no id has no key to render under, and a lane
  // with no phase has no name to show, so either missing is the whole row dropped.
  if (typeof held.lane !== 'string' || typeof held.phase_id !== 'string') return null;
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    lane: held.lane,
    phase_id: held.phase_id,
    rank: number(held.rank),
    title: text(held.title),
    stage: text(held.stage),
    stage_detail: text(held.stage_detail),
    stage_since: number(held.stage_since),
  };
}

/**
 * The lanes the run is walking right now — the array to map over, `[]` on everything else.
 *
 * EMPTY IS THE ORDINARY ANSWER, not a failure, and it has two causes at once: a serial run writes
 * an empty table, and a snapshot from a server older than this shape carries no such field at all.
 * A malformed table is `[]` too — the lane rows are one more thing the card may lose, never the
 * card itself — and rows are carried as they arrive, lowest rank first, which is the order the
 * runner wrote them in (`hooks/plan_runner/progress.py::_lanes`).
 */
export function runLanes(run: RunnerRunSnapshot): RunnerLane[] {
  // The narrowing is the mirror's gap, not a guess: the field is genuinely absent from the client's
  // `RunnerRunSnapshot` today, so it is read off the value rather than through the type.
  const raw: unknown = (run as RunnerRunSnapshot & { lanes?: unknown }).lanes;
  if (!Array.isArray(raw)) return [];
  return raw.map(asLane).filter((lane): lane is RunnerLane => lane !== null);
}

/**
 * Each phase that SHARES its wave → the ids it shares it with, in plan order: the swarm mark's input.
 *
 * `wave` is the runner's own number (`hooks/plan_runner/progress.py::_waves`, the map `plan-runner
 * swarm <plan>` prints); this only groups the rows by it and never re-derives it. A phase alone in
 * its wave, or with no wave at all (`null`, or a frame from before the field), is absent — no
 * companions, so no mark: the absence is the statement.
 */
export function waveCompanions(run: RunnerRunSnapshot): Map<string, string[]> {
  const byWave = new Map<number, string[]>();
  for (const phase of run.phases ?? []) {
    if (typeof phase.wave === 'number') byWave.set(phase.wave, [...(byWave.get(phase.wave) ?? []), phase.id]);
  }
  const alongside = new Map<string, string[]>();
  for (const ids of byWave.values()) {
    if (ids.length > 1) for (const id of ids) alongside.set(id, ids.filter((other) => other !== id));
  }
  return alongside;
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

/**
 * Where a run is ranked in the list, and it is a reading of URGENCY rather than of recency.
 *
 * LIVE first because something is happening to it right now. STALE second because a lapsed
 * heartbeat is the one state that may want a hand — it is the reason a person opens this tab
 * unprompted. QUEUED third, above PAUSED: both are parks the operator chose, but a queued run has
 * not started at all and its Start is the card's whole point, while a paused run was stopped
 * mid-walk and can wait. PAUSED fourth because a parked run is parked on purpose: the operator
 * stopped it, and a list that raised their own decision above a run in trouble would be the app
 * arguing with them. ENDED last of all — nothing more will happen to it; it is there to be read
 * and dismissed — and within ENDED the most recent ending first, since that is the one the
 * operator came to see.
 *
 * Reversible in one place, by design (the plan's own reversible default): change these numbers and
 * the order changes, with nothing else to find.
 */
export const STATE_ORDER: Record<RunnerRunState, number> = { live: 0, stale: 1, queued: 2, paused: 3, ended: 4 };

/** State first, then newest first inside each state — by its ending for an ended run, its start otherwise. */
export function byUrgencyThenNewest(a: RunnerRunSnapshot, b: RunnerRunSnapshot): number {
  const recency = (run: RunnerRunSnapshot) => run.ended_at ?? run.started_at;
  return STATE_ORDER[a.state] - STATE_ORDER[b.state] || recency(b) - recency(a);
}

/**
 * A scheduled moment in the reader's own clock: `3:00 AM` today, `Sep 23, 3:00 AM` any other day. The date
 * rides whenever the moment is not today, because DeepSeek's off-peak lifts at 3 AM Pacific — past the
 * operator's midnight — and a bare `3:00 AM` read in the evening names a time that has already passed. Used by
 * `RunCard`'s queued note and `ScheduleControl`'s `Start at …`, so the note and the button name one time one way.
 */
export function scheduleClock(epochSeconds: number, now: number = Date.now()): string {
  const moment = new Date(epochSeconds * 1000);
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (moment.toDateString() === new Date(now).toDateString()) return moment.toLocaleTimeString([], time);
  return moment.toLocaleString([], { month: 'short', day: 'numeric', ...time });
}
