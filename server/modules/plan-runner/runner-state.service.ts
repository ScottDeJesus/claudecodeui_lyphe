import fs from 'node:fs';

import type {
  RunnerLaneRow,
  RunnerPhaseRow,
  RunnerPhaseState,
  RunnerPosition,
  RunnerRepair,
  RunnerRunSnapshot,
  RunnerRunState,
  RunnerTimelineEntry,
} from '@/shared/types.js';
import { isHiddenProjectPath } from '@/shared/hidden-project-paths.js';
import { readRunnerModelChoice } from '@/shared/utils.js';

import {
  listRunDirs,
  readRunFiles,
  readRunLockBeat,
  readStringOrNull,
  readPlanLedger,
  type PlanLedger,
  type RunnerRunFiles,
} from './runner-state.transport.js';

/**
 * What the runner's four files MEAN: which runs this lane carries, how each one is classified,
 * and what its stage history reads as.
 *
 * Nothing here touches a socket, an HTTP request or the runner itself. Given the bytes on disk
 * and a clock, it answers with snapshots — which is what lets a fixture run prove the whole
 * classification without a runner process existing. One field is the exception: `repair.live`
 * probes the process table (`pidAlive`), and a fixture pins it by carrying a real pid or none.
 */

/** One `runner.log` line: a local ISO stamp, the ◆ line, and the stage word with its optional detail. */
const TIMELINE_LINE =
  /^(\S+) ◆ (\d+) of (\d+) · Phase ([\w.]+) — .*? · stage: (\S+)(?: (.*))?$/;
/** The suffix `progress.py` adds while more than one lane is live — ids today, a bare count in older logs. */
const LANES_TAIL = / · lanes: [\w., ]+$/;

/** How long an ENDED run stays on the lane after its receipt, when a caller names no window. The composition root names one (`plan-runner.module.ts`); this default only keeps a bare call honest. */
const DEFAULT_ENDED_KEEP_S = 24 * 60 * 60;

/** How many stage changes a snapshot carries. A long run's log outgrows any panel; the recent end is the useful one. */
const TIMELINE_LIMIT = 200;

/** The five words `hooks/plan_runner/progress.py:_rows` can write, and the only ones this lane accepts. */
const PHASE_STATES: readonly RunnerPhaseState[] = ['shipped', 'running', 'blocked', 'deferred', 'pending'];

/** A finite number, or the fallback. `typeof` alone admits `NaN`, which renders as "NaN" all the way to the DOM. */
function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A finite number, or `null` — for the fields where "not set" is a real answer (`stopped_at`, `pid`). */
function readNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A string, or `''`. Free text from the runner: it reaches the DOM as a text node, never as markup. */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * How a run ended, off its receipt: the runner's own status word and the second it wrote it.
 *
 * The runner writes receipts atomically and `hasReceipt` is derived from the read, so a receipt
 * here is always a whole record; `unknown` covers one whose `status` is not a string, and a
 * missing `ended_at` falls back to the run's last written beat. Never a throw.
 */
function readEnding(receipt: unknown, fallbackAt: number): { outcome: string; at: number } {
  return {
    outcome: readString(field(receipt, 'status')) || 'unknown',
    at: readNumber(field(receipt, 'ended_at'), fallbackAt),
  };
}

/**
 * The receipt's `blocked` map — phase id → cause — keeping string causes only. It is the one record of a
 * phase the walk left standing on a crash or on the run's budget, whose `progress.json` row never turns `blocked`.
 */
function readBlockedCauses(receipt: unknown): Record<string, string> {
  const raw = field(receipt, 'blocked');
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** A record's field, without asserting the record is one. */
function field(record: unknown, name: string): unknown {
  return record !== null && typeof record === 'object' ? (record as Record<string, unknown>)[name] : undefined;
}

/**
 * One `progress.json` phase row.
 *
 * A `state` outside the five is a file this lane does not understand. The row is still carried,
 * as `pending`, rather than dropped: a missing row would silently shorten the phase count a
 * reader is counting progress against, while an unrecognised one merely fails to be counted as
 * shipped — the conservative direction.
 */
function readPhaseRow(raw: unknown, index: number): RunnerPhaseRow {
  const state = readString(field(raw, 'state')) as RunnerPhaseState;
  return {
    rank: readNumber(field(raw, 'rank'), index + 1),
    id: readString(field(raw, 'id')),
    title: readString(field(raw, 'title')),
    state: PHASE_STATES.includes(state) ? state : 'pending',
    note: readString(field(raw, 'note')),
    // Absent is `null`, the boundary rule `lanes` follows: a file from before the field, or a
    // phase the plan's wave map could not place.
    wave: readNumberOrNull(field(raw, 'wave')),
  };
}

/**
 * One `progress.json` lane row, or `null` for a record nothing can be drawn from.
 *
 * `lane` and `phase_id` are the row's identity — the lane id IS the phase id, a phase running on
 * exactly one lane — so a row missing either is DROPPED: a lane with no id has no key to render
 * under and a lane with no phase has no name to show. Everything else falls back the way the
 * neighbouring readers do, so one field the runner grew later costs that field and not the row.
 */
function readLaneRow(raw: unknown): RunnerLaneRow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const lane = readStringOrNull(field(raw, 'lane'));
  const phaseId = readStringOrNull(field(raw, 'phase_id'));
  if (lane === null || phaseId === null) return null;
  return {
    lane,
    phase_id: phaseId,
    rank: readNumber(field(raw, 'rank'), 0),
    title: readString(field(raw, 'title')),
    stage: readString(field(raw, 'stage')),
    stage_detail: readString(field(raw, 'stage_detail')),
    stage_since: readNumber(field(raw, 'stage_since'), 0),
  };
}

/**
 * The run's live lanes, lowest rank first — what the runner wrote, or `[]`.
 *
 * An absent key is not a defect: a `progress.json` written before lanes shipped has none, while
 * today's writer always spells the table out — `[]` on a serial run, one row per live lane. A
 * `lanes` that is not an array is `[]` too rather than a throw, the same direction `phases` reads
 * in and the one that keeps the card drawn: a malformed lane table may cost the lane rows, never
 * the run.
 */
function readLanes(raw: unknown): RunnerLaneRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readLaneRow).filter((row): row is RunnerLaneRow => row !== null);
}

/**
 * The `position` block, or `null`.
 *
 * `null` is a real state and not a defect: the runner composes a position only once it has a
 * phase in flight, so a run that just started genuinely has none for its first seconds.
 */
function readPosition(raw: unknown): RunnerPosition | null {
  if (raw === null || typeof raw !== 'object') return null;
  return {
    rank: readNumber(field(raw, 'rank'), 0),
    total: readNumber(field(raw, 'total'), 0),
    phase_id: readString(field(raw, 'phase_id')),
    title: readString(field(raw, 'title')),
    remain: readNumber(field(raw, 'remain'), 0),
    pipeline: readString(field(raw, 'pipeline')),
    stage: readString(field(raw, 'stage')),
    stage_detail: readString(field(raw, 'stage_detail')),
    stage_since: readNumber(field(raw, 'stage_since'), 0),
  };
}

/** The prefix every probe-made run carries (`.verify/lib/runner-fixture.mjs`'s one fence). */
const FIXTURE_RUN_PREFIX = 'fixture-';

/**
 * A run a test made rather than the operator: one of the runner's own fixtures (a plan minted in a
 * scratch root, `shared/hidden-project-paths.ts`) or a browser probe's fake run (a `fixture-` id,
 * its plan under the repo's `.verify/`). ONE rule for both, read by the notifications and by every
 * runs list: on 2026-09-18 a probe's fake run blinked onto the operator's widgets and pushed
 * "Plan blocked · Fixture — live widgets" to the phone twice, because only the first kind was known.
 */
function isTestRun(runId: string, planPath: string): boolean {
  return runId.startsWith(FIXTURE_RUN_PREFIX) || isHiddenProjectPath(planPath);
}

const REPAIR_STATES: readonly RunnerRepair['state'][] = ['repairing', 'paused', 'fixed', 'failed'];

/** Is this process alive? Signal 0 delivers nothing; EPERM still means it exists. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The fix-it session on a blocked phase, or `null` when the run never sent one. An unknown state
 * word is `null` too: a card must never say "repairing" over something it cannot read.
 *
 * A `heal` repair is the item a run FILED when a block's ⚒ ladder was spent; the run never presses or
 * waits on it (a run reports what to heal, operator ruling 2026-09-24), and the heal side's own clock
 * drains it. So the run's own liveness says nothing about it: `live` is read off the drain's pid, which
 * the stamp carries, and a heal no drain is working reads as filed — never as waiting on anything.
 */
function readRepair(raw: unknown): RunnerRepair | null {
  if (raw === null || typeof raw !== 'object') return null;
  const state = readString(field(raw, 'state')) as RunnerRepair['state'];
  if (!REPAIR_STATES.includes(state)) return null;
  const named = readString(field(raw, 'by'));
  const by: RunnerRepair['by'] = named === 'heal' || named === 'replan' ? named : 'unblock';
  const pid = readNumberOrNull(field(raw, 'pid'));
  return {
    phase_id: readString(field(raw, 'phase_id')),
    state,
    by,
    live: by === 'heal' && state === 'repairing' && pid !== null && pid > 0 && pidAlive(pid),
    // A cleared unblock always re-walked its phase, and blocks written before `resumed` existed say
    // nothing; an unknown is carried as `null`, never inverted into a claim.
    resumed: by !== 'heal' ? state === 'fixed'
      : typeof field(raw, 'resumed') === 'boolean' ? (field(raw, 'resumed') as boolean) : null,
    step: readString(field(raw, 'step')),
    k: readNumber(field(raw, 'k'), 0),
    limit: readNumber(field(raw, 'limit'), 0),
    since: readNumberOrNull(field(raw, 'since')),
    ended_at: readNumberOrNull(field(raw, 'ended_at')),
    reason: readString(field(raw, 'reason')),
  };
}

/**
 * The stage history of one run, newest last, capped at the most recent {@link TIMELINE_LIMIT}.
 *
 * A line that does not match is SKIPPED rather than guessed at: the log is append-only and its
 * last line can be half-written when we read it, and a partial line parsed leniently would put
 * a phantom stage on the wall. The timestamp is kept as the runner's own local ISO string — it
 * carries no zone, so re-parsing it into an epoch would invent an offset.
 *
 * An event that repeats the one KEPT BEFORE IT — same second, same phase, same stage, same detail
 * — collapses into it. A second is the runner's own resolution, and a sibling lane's stage change
 * used to re-print the current phase's line, so a phase read `08:16:35 builder` four times over one
 * unchanged stage (heal-reflex run, 2026-09-22). The writer no longer appends those, and this keeps
 * every log ALREADY on disk clean without a rewrite. CONSECUTIVE rows only: a stage re-entered
 * after another in the same second is a real event, and an identical stage at a LATER second is
 * kept for the same reason — a builder re-spawned after a retry.
 */
export function parseTimeline(lines: string[]): RunnerTimelineEntry[] {
  const entries: RunnerTimelineEntry[] = [];
  // Walked from the END, so the work is bounded by the cap rather than by the log's total
  // length. A run hours long has thousands of lines and only the last 200 can survive; matching
  // the earlier ones every time the file changes buys a result that is thrown away.
  for (let index = lines.length - 1; index >= 0 && entries.length < TIMELINE_LIMIT; index -= 1) {
    // The ◆ line's ` · lanes: 5, 6` tail names the run's lanes, not this stage's detail: cut first.
    const match = TIMELINE_LINE.exec(lines[index].replace(LANES_TAIL, ''));
    if (!match) continue;
    const entry = { at: match[1], phase_id: match[4], stage: match[5], detail: match[6] ?? '' };
    // Newest-first: the entry pushed LAST is this one's predecessor in the log.
    const previous = entries[entries.length - 1];
    if (previous && previous.at === entry.at && previous.phase_id === entry.phase_id
      && previous.stage === entry.stage && previous.detail === entry.detail) continue;
    entries.push(entry);
  }
  return entries.reverse();
}

/**
 * One run directory's snapshot, or `null` when this lane does not carry that run.
 *
 * The rules mirror `scripts/runner_statusline.py` — `read_run` for what is skipped, `segment`
 * for the staleness cut at `STALE_AFTER_S` — plus one rule of the reaper's
 * (`hooks/plan_runner/cmd/observe.py:210-212`): a run whose plan file is gone is RETIRED there,
 * so carrying it here would flood the tab with runs nothing can ever continue (`resume` refuses
 * them, exit 4). Existence is the whole test; the plan's CONTENT is never read.
 *
 * There is exactly ONE deliberate difference from the statusline, and it is not a bug to fix:
 * `read_run` returns `None` for a parked run because the bar is for what is moving, while this
 * lane CARRIES it so the tab can list it and offer Resume. Paused therefore wins over stale — a
 * run parked for a day has a lapsed heartbeat by definition, and reading that as "stale" would
 * offer the operator a recovery for a state they chose.
 *
 * A QUEUED run is that same park, written by the runner's own `start` rather than by an
 * operator's `stop`: it is classified BEFORE `paused` (after `ended`), because the two carry
 * different words on the card — Start is offered for one and Resume for the other — and a run
 * that has never walked must not be reported as one that was stopped mid-walk. Its
 * `queued_until` rides the snapshot so the card can name the window it waits for.
 *
 * `endedKeepS` is how long a receipted run is still carried, as `ended` with its outcome, before it
 * is omitted — the operator dismisses it from the tab before then, or the window does.
 *
 * `now` and `staleAfterS` are both SECONDS, because `heartbeat_at` is what the runner's Python
 * wrote with `time.time()`. Hand this `Date.now()` and every run on the host reads live forever.
 *
 * `lockBeatFor` supplies the LIVENESS BEAT and is what rule 5 is actually aged against: the beat
 * of the lock held for this run when one names it, and the progress file's own `heartbeat_at`
 * when none does. Omitting it is the documented fallback and not a degraded mode — the snapshot
 * is then judged by the run's last write, which is exactly right for anything nothing is beating
 * for (a fixture, a crashed daemon). See `readRunLockBeat` for why the progress file alone reads
 * a healthy long phase as stale. The effective beat is what `heartbeat_at` carries out of here.
 */
export function classifyRun(
  files: RunnerRunFiles,
  now: number,
  staleAfterS: number,
  lockBeatFor?: (planPath: string, runId: string) => number | null,
  endedKeepS: number = DEFAULT_ENDED_KEEP_S,
): RunnerRunSnapshot | null {
  const { progress } = files;
  if (progress === null) return null; // no picture ⇒ nothing honest to say about this directory

  const runId = readStringOrNull(field(progress, 'run_id'));
  const planPath = readStringOrNull(field(progress, 'plan_path'));
  if (runId === null || planPath === null) return null;
  if (!fs.existsSync(planPath)) return null;

  const writtenBeat = readNumberOrNull(field(progress, 'heartbeat_at'));
  if (writtenBeat === null) return null; // nothing to age against ⇒ nothing honest to say

  // ENDED is carried, not dropped: the operator asked to SEE a run finish and dismiss it
  // themselves (2026-09-09), so a receipt keeps the run on the lane for `endedKeepS` after its
  // `ended_at` and only then lets it go. A resume renames the receipt and the run returns to the
  // three moving states on the next tick — the classification is stateless per tick.
  const ending = files.hasReceipt ? readEnding(files.receipt, writtenBeat) : null;
  if (ending !== null && now - ending.at >= endedKeepS) return null;

  // The lock's beat when one names a MOVING run, the progress file's own otherwise. An ended run
  // is never aged, so its lock is never asked for — which is what lets the transport's lock cache
  // stop stat'ing a finished run's entry the moment its receipt lands.
  const heartbeatAt = ending !== null ? writtenBeat : (lockBeatFor?.(planPath, runId) ?? writtenBeat);

  const stoppedAt = readNumberOrNull(field(files.run, 'stopped_at'));
  // The one field that separates a QUEUED run from a STOPPED one, and it is `run.json`'s: the
  // runner writes `status: "queued"` when it creates the run parked (`start --queue`, or DeepSeek's
  // peak hours with the switch on) and clears it at Start. `progress.json` carries the word too,
  // but that is the runner's rendering of the run and this is the classification — read the record.
  const runStatus = readString(field(files.run, 'status'));
  const queuedUntil = readNumberOrNull(field(files.run, 'queued_until'));
  // Kept RAW: `run.json` carries a Claude transcript uuid, and translating it to an app session id
  // is the composition root's one job (`plan-runner.module.ts`). A disk reader that resolved ids
  // would need the database, and this lane is proven against a fixture directory with none.
  const launchedBySession = readStringOrNull(field(files.run, 'launched_by_session'));
  const state: RunnerRunState =
    ending !== null ? 'ended'
    : stoppedAt !== null && runStatus === 'queued' ? 'queued'
    : stoppedAt !== null ? 'paused'
    : now - heartbeatAt >= staleAfterS ? 'stale'
    : 'live';

  const phases = field(progress, 'phases');
  return {
    run_id: runId,
    plan_path: planPath,
    test_run: isTestRun(runId, planPath),
    plan_title: readString(field(progress, 'plan_title')),
    state,
    status: readString(field(progress, 'status')),
    // Falls back to the file's OWN beat, not the effective one: a missing `started_at` is best
    // approximated by another stamp from the same file, never by a lock a daemon wrote seconds ago.
    started_at: readNumber(field(progress, 'started_at'), writtenBeat),
    heartbeat_at: heartbeatAt,
    stopped_at: stoppedAt,
    // Carried raw, like `stopped_at`: the client renders it in the reader's own zone, and `null`
    // is a real answer — a queued run that named no window to wait for.
    queued_until: queuedUntil,
    // The operator's scheduled Start (`plan-runner schedule`), raw like `queued_until`; absent reads `null`.
    start_at: readNumberOrNull(field(files.run, 'start_at')),
    // The run's own model word as the runner stored it (`run_model.py`); a record with no word reads `null`.
    model: readRunnerModelChoice(field(files.run, 'model')),
    launched_by_session: launchedBySession,
    outcome: ending?.outcome ?? null,
    ended_at: ending?.at ?? null,
    blocked_causes: ending !== null ? readBlockedCauses(files.receipt) : {},
    // The receipt's own sentence over a ⛔ the run walked out on (`closing.doors_spent`, the runner's
    // `closing.py`): the phase, its cause, and the doors it spent — `''` on a receipt that carries
    // none. Read RAW, like every other field here: the ending's notification is where it is said.
    doors_spent: ending !== null ? readString(field(files.receipt, 'doors_spent')) : '',
    pid: readNumberOrNull(field(progress, 'pid')),
    position: readPosition(field(progress, 'position')),
    // The lane table, read with the same defences as every other block here: absent or malformed
    // is no lanes, never a dropped snapshot. This lane only READS `progress.json` — how the file
    // is found and parsed is the transport's, and nothing here asks for another read.
    lanes: readLanes(field(progress, 'lanes')),
    repair: readRepair(field(progress, 'repair')),
    phases: Array.isArray(phases) ? phases.map(readPhaseRow) : [],
    spawns: readNumber(field(progress, 'spawns'), 0),
    max_spawns: readNumber(field(progress, 'max_spawns'), 0),
    cost_usd: readNumber(field(progress, 'cost_usd'), 0),
    // Just this run; `snapshotRuns` folds in the plan's other runs (`withPlanTotals`).
    plan_runs: 1,
    plan_spawns: readNumber(field(progress, 'spawns'), 0),
    plan_cost_usd: readNumber(field(progress, 'cost_usd'), 0),
    // The ledger's kinds land in `withPlanTotals`; alone, a run's plan total is its own cost.
    plan_planning_usd: 0,
    plan_review_usd: 0,
    plan_scouts_usd: 0,
    plan_total_usd: readNumber(field(progress, 'cost_usd'), 0),
    tokens: readNumber(field(progress, 'tokens'), 0),
    plan_tokens: readNumber(field(progress, 'tokens'), 0),
    line: readString(field(progress, 'line')),
    timeline: parseTimeline(files.logLines),
  };
}

/**
 * Every run this lane carries, oldest first.
 *
 * `started_at` ascending is the terminal bar's own order (`runner_statusline.py:collect`), and
 * `listRunDirs` already sorted by name, so two runs that started in the same second keep a
 * stable order rather than swapping places between ticks — which would broadcast a change that
 * is not one.
 *
 * `now` is epoch SECONDS, like every timestamp the runner writes.
 *
 * This is where the LIVENESS BEAT is wired: `readRunLockBeat` is handed to every run in the sweep,
 * so each is aged against the lock held for it when one names it. It is passed as-is rather than
 * wrapped, because a lock's location does not depend on this function's `stateDir` — the runner
 * hardcodes the lock directory and honours no state-root env for it (`state_lock.py:36-37`).
 *
 * DIVERGENCE, deliberate and named: the plan's Interfaces R declares `snapshotRuns(stateDir,
 * now)`, two arguments. It also declares `classifyRun(files, now, staleAfterS)` and requires
 * `STALE_AFTER_S = 900` to live at the top of `plan-runner.module.ts` with the lane's other
 * reversible knobs. Both cannot hold at once; the third argument here is what keeps the constant
 * in the composition root, and it also lets a probe age a run without waiting a quarter of an
 * hour. Nothing outside this module consumes the function.
 *
 * `onRunError` is optional and defaults to saying nothing, so a caller that only wants the
 * picture is not forced to hold a logger it has no use for.
 */
export function snapshotRuns(
  stateDir: string,
  now: number,
  staleAfterS: number,
  onRunError?: (dir: string, message: string) => void,
  endedKeepS: number = DEFAULT_ENDED_KEEP_S,
): RunnerRunSnapshot[] {
  const runs: RunnerRunSnapshot[] = [];
  const books = new Map<string, PlanBooks>();
  ledgers.clear();   // a fresh read of every plan's ledger, once per sweep

  for (const dir of listRunDirs(stateDir)) {
    try {
      const files = readRunFiles(dir);
      tally(books, files.run);
      const snapshot = classifyRun(files, now, staleAfterS, readRunLockBeat, endedKeepS);
      if (snapshot !== null) runs.push(snapshot);
    } catch (error) {
      // ONE bad directory never costs the others their reading: a single permanently-unreadable
      // run must not freeze the whole picture on an old one. But it must not vanish in silence
      // either — a run missing from both the list and the frame with nothing written anywhere is
      // indistinguishable from a run that ended. The composition root owns the saying of it, so
      // it hands down the door; this function only decides that there is something to say.
      onRunError?.(dir, error instanceof Error ? error.message : String(error));
    }
  }
  return supersedeEnded(runs.map((run) => withPlanTotals(run, books)))
    .sort((left, right) => left.started_at - right.started_at);
}

/** One plan's spend, summed over the `run.json` of every run of it. */
type PlanBooks = { runs: number; spawns: number; cost: number; tokens: number };

/** One plan's ledger, read once per sweep however many of its runs are on the lane. */
const ledgers = new Map<string, PlanLedger>();
function ledgerFor(planPath: string): PlanLedger {
  const held = ledgers.get(planPath);
  if (held !== undefined) return held;
  const read = readPlanLedger(planPath);
  ledgers.set(planPath, read);
  return read;
}

/**
 * One run's books into its plan's totals.
 *
 * `run.json` is the runner's own record, and it is read for EVERY run directory: ended,
 * superseded, and long past the lane's window. A restart opens a new run at 0, and the run's
 * counters alone read as a reset (operator, 2026-09-11: "You should never reset the counter").
 *
 * A plan is its PATH. A moved plan starts a new total, and a new plan written at a retired one's
 * path inherits its history. A dry run spawns nothing and is not a run. A count that is not a
 * finite, non-negative number adds nothing rather than poisoning the sum.
 */
function tally(books: Map<string, PlanBooks>, run: unknown): void {
  const planPath = readStringOrNull(field(run, 'plan_path'));
  if (planPath === null || field(run, 'status') === 'dry-run') return;
  const held = books.get(planPath) ?? { runs: 0, spawns: 0, cost: 0, tokens: 0 };
  books.set(planPath, {
    runs: held.runs + 1,
    spawns: held.spawns + Math.max(0, readNumber(field(run, 'spawns'), 0)),
    cost: held.cost + Math.max(0, readNumber(field(run, 'cost_usd'), 0)),
    tokens: held.tokens + Math.max(0, readNumber(field(run, 'tokens'), 0)),
  });
}

/** The snapshot with its plan's totals, or with its own counters when no book of its plan was read. */
function withPlanTotals(run: RunnerRunSnapshot, books: Map<string, PlanBooks>): RunnerRunSnapshot {
  const plan = books.get(run.plan_path);
  const build = plan === undefined ? run.plan_cost_usd : plan.cost;
  const ledger = ledgerFor(run.plan_path);
  const outside = ledger.planning + ledger.review + ledger.scouts;
  return {
    ...run,
    ...(plan === undefined ? {} : { plan_runs: plan.runs, plan_spawns: plan.spawns, plan_cost_usd: plan.cost }),
    plan_planning_usd: ledger.planning,
    plan_review_usd: ledger.review,
    plan_scouts_usd: ledger.scouts,
    plan_total_usd: build + outside,
    plan_tokens: (plan === undefined ? run.tokens : plan.tokens) + ledger.tokens,
  };
}

/**
 * One ended card per plan, and none while that plan is moving again.
 *
 * A plan re-walked eight times in a day leaves eight receipts inside the window, and a tab that
 * listed all eight would bury the one ending the operator came to see under seven it already knows.
 * So an ended run is carried only while it is the NEWEST run of its plan: a later run of the same
 * plan — ended or still moving — supersedes it. Moving runs are never touched by this; the rule
 * only ever drops ENDED ones. Newest is by `ended_at`, then `started_at` for two that ended in the
 * same second.
 */
export function supersedeEnded(runs: RunnerRunSnapshot[]): RunnerRunSnapshot[] {
  const newestEndedByPlan = new Map<string, RunnerRunSnapshot>();
  const movingPlans = new Set<string>();
  for (const run of runs) {
    if (run.state !== 'ended') {
      movingPlans.add(run.plan_path);
      continue;
    }
    const held = newestEndedByPlan.get(run.plan_path);
    const newer = held === undefined
      || (run.ended_at ?? 0) > (held.ended_at ?? 0)
      || ((run.ended_at ?? 0) === (held.ended_at ?? 0) && run.started_at > held.started_at);
    if (newer) newestEndedByPlan.set(run.plan_path, run);
  }
  return runs.filter((run) =>
    run.state !== 'ended' || (!movingPlans.has(run.plan_path) && newestEndedByPlan.get(run.plan_path) === run));
}
