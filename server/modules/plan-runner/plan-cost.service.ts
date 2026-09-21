import fs from 'node:fs';
import path from 'node:path';

import { expandHome } from '@/shared/utils.js';

import { listRunDirs, readPlanLedger, readRunFiles } from './runner-state.transport.js';

/**
 * What a whole PLAN cost — the reading behind the card drawer's cost line.
 *
 * It is a READ of books that already exist, and there is no fourth source. The plan's own ledger
 * (`readPlanLedger`) carries the spend OUTSIDE the runs — the planner, the reviewer, the scout
 * waves — and each run directory's `receipt.json` carries that run's own `cost_usd`. Every row in
 * both is ALREADY PRICED: a `claude -p` child reports its own bill, and a ledger row was priced
 * from its transcript when its outing stopped. So nothing here prices a token and nothing here
 * writes a ledger: a second ledger of our own would be a second answer to "what did this cost",
 * and two answers drift. `costs.py:376` (`summary`) is the program this reads the same way.
 *
 * A plan is its PATH, and matching a run to a plan is the one place a bare string comparison is
 * WRONG. A card stores `~/.claude/plans/foo.md`; a receipt stores whatever absolute path the
 * runner was launched with. `costs.py:327-330` records what that cost: `~` expanded AFTER a
 * `realpath` resolves under the CALLER's cwd, a different answer per process. So the home is
 * expanded FIRST and resolved second, and both sides of the comparison go through that one door.
 *
 * Three sources, one number:
 *
 * - `planning`, `review`, `scouts` — the ledger's sums, which are the live truth while the file is
 *   there and are read on every call.
 * - `build` — every matching run's own `cost_usd`, summed: a receipted run from its receipt, a
 *   live run (no receipt yet) from its `progress.json`. That is `costs._scan_runs`'s rule.
 * - the NEWEST matching receipt's own `plan_cost` — the runner's precomputed whole-plan reading,
 *   taken at close by the same code, and the only copy that survives the ledger's pruning. It is
 *   read as a FLOOR under all four kinds, and it is the third source rather than a curiosity: a run
 *   directory that leaves the state root, a pruned ledger, a run scanned while its own file is
 *   mid-rewrite — each of those would silently shrink a sum, and the receipt still holds what was
 *   spent. Spend only grows, so of two readings of one quantity the larger is the later, and a
 *   floor can never double-count: it either agrees with the sum or replaces a reading that has
 *   lost ground. Its own `total_usd` is not read on its own — it is the sum of the four kinds these
 *   floors are taken of.
 *
 * The result is CACHED per plan for 20 seconds — opening a drawer must
 * not walk two hundred run directories on every click, and a cost that is twenty seconds stale on
 * a surface that reports dollars is not a lie. The reading never throws: a plan with nothing
 * behind it answers `null`, which is what the route hands the drawer, so a card whose plan was
 * never run reads "no cost yet" rather than "$0.00" (`planCostFor` on a missing plan is why the
 * card may not answer a zero).
 */

/** Where the runner keeps its runs unless the operator moved it. The lane's composition root reads the same variable (`plan-runner.module.ts`). */
const DEFAULT_STATE_DIR = '~/.claude/state/runner';

/** How long one plan's reading is held. `costs.RUNS_INDEX_TTL_S` is the same 20 s. */
const COST_TTL_MS = 20_000;

/** Four places, like every priced figure the runner writes (`costs.py` rounds its own sums there). */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** The four kinds a plan's spend is reported in — `costs.KINDS`, in its order. */
export type PlanCostByKind = { planning: number; review: number; scouts: number; build: number };

/** What a whole plan cost, or `null` when nothing has ever been booked against it. */
export type PlanCost = {
  totalUsd: number;
  byKind: PlanCostByKind;
  /** How many runner runs of this plan the reading found — receipted and live together. */
  runs: number;
};

/** One plan's reading and the moment it was taken. */
type CachedCost = { at: number; value: PlanCost | null };

const costCache = new Map<string, CachedCost>();

/** The runs state root, read at CALL time so a probe's env reaches this read rather than a captured one. */
function runsStateDir(): string {
  return expandHome(process.env.PLAN_RUNNER_STATE_DIR || DEFAULT_STATE_DIR);
}

/**
 * The key a plan path is matched by: trimmed, `~` expanded, `realpath` (`costs._plan_key`).
 *
 * The TRIM is the port's own reading and not a courtesy: `costs.slug` opens with
 * `str(plan_path or "").strip()`, and the values this compares are strings a person or an agent
 * wrote into a card's `plan` column — where the route stores what it was given, newline and all. A
 * trailing `\n` is a different path to `realpath`, so an untrimmed comparison answers `null` for a
 * plan whose cost is fully booked: measured, one plan read `250.1238` clean and `null` with a
 * newline on the end.
 *
 * A path left RELATIVE is resolved against this process's cwd, which is also what `costs._plan_key`
 * does with one: a relative plan path means whatever it means to whoever reads it, and nothing in
 * the board's columns says which directory that was. Named, not fixed — anchoring it would need a
 * rule (the board's project directory?) the plan does not carry.
 *
 * `realpathSync` throws where Python's `realpath` merely resolves what it can, so a path that does
 * not exist falls back to its absolute spelling — which is the same answer Python gives for a
 * missing file, and the honest one here: a plan that is not on disk cannot match a run directory.
 */
function planKey(planPath: string): string {
  const expanded = expandHome(planPath.trim());
  try {
    return fs.realpathSync(expanded);
  } catch {
    return path.resolve(expanded);
  }
}

/** One field off a decoded JSON record, or `undefined` for anything that is not one. */
function field(record: unknown, key: string): unknown {
  return record !== null && typeof record === 'object'
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

/** A non-empty string, or `null` — the lane's own spelling of "absent" (`runner-state.transport.ts`). */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * A money figure off one file, in USD: anything that is not a finite positive number reads 0.
 *
 * A missing `cost_usd`, a `null` from a dry run and a `NaN` out of a hand-edited file are all "this
 * contributed nothing", which is what keeps one bad receipt from turning a plan's total into `NaN`
 * — a figure that would render as `$NaN` all the way to the drawer.
 */
function readCost(value: unknown): number {
  const cost = Number(value);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/** One run of this plan: what it cost, and its receipt when it has one (a live run has none). */
type MatchedRun = { costUsd: number; receipt: Record<string, unknown> | null };

/**
 * Every run directory that belongs to `wantedKey`, in the order `listRunDirs` lists them.
 *
 * A run's plan path is its receipt's while it has a receipt and its `progress.json`'s while it is
 * live — never both, and never the run's own `run.json`, which carries counters rather than the
 * plan (`costs._scan_runs`). A directory with neither file is not a run of anything and is skipped
 * rather than counted as one of this plan's.
 *
 * A run that names NO plan is skipped too, and that guard is ours rather than the port's: an empty
 * path resolves to the current working directory, which would silently book a stranger's run
 * against whatever plan lives in the process's cwd.
 */
function matchingRuns(wantedKey: string): MatchedRun[] {
  const matched: MatchedRun[] = [];

  for (const dir of listRunDirs(runsStateDir())) {
    const files = readRunFiles(dir);
    const receipt =
      files.receipt !== null ? (files.receipt as Record<string, unknown>) : null;
    const source = receipt ?? (files.progress !== null ? (files.progress as Record<string, unknown>) : null);
    if (source === null) continue;

    const named = stringOrNull(field(source, 'plan_path')) ?? stringOrNull(field(source, 'plan'));
    if (named === null || planKey(named) !== wantedKey) continue;

    matched.push({ costUsd: readCost(field(source, 'cost_usd')), receipt });
  }

  return matched;
}

/**
 * The newest matching receipt's own `plan_cost`, or `null` when none carries one.
 *
 * `listRunDirs` sorts by directory name, and the runner names a run directory
 * `<slug>-plan-<stamp>-<hash>` — so for ONE plan the order is chronological and the last entry
 * that carries the record is the newest. An older receipt's reading is never preferred to a newer
 * one: the fields are merged kind by kind by the caller, and a receipt from a run that closed in
 * June says nothing about what the plan has spent since.
 */
function newestReceiptPlanCost(runs: MatchedRun[]): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;

  for (const run of runs) {
    const planCost = field(run.receipt, 'plan_cost');
    if (planCost !== null && typeof planCost === 'object' && !Array.isArray(planCost)) {
      found = planCost as Record<string, unknown>;
    }
  }

  return found;
}

/** The reading itself, with the cache already missed. Never throws and never returns a zero total. */
function readPlanCost(planPath: string, key: string): PlanCost | null {
  const ledger = readPlanLedger(planPath);
  const runs = matchingRuns(key);
  const receiptPlanCost = newestReceiptPlanCost(runs);

  /**
   * The larger of a live sum and the newest receipt's snapshot of the same spend.
   *
   * The same rule for all FOUR kinds, because it is one rule: spend only grows, so the larger of
   * two readings is the later one. For `build` it is what keeps the figure honest when the runs
   * themselves cannot account for it — a run directory archived out of the state root, or one
   * caught mid-rewrite by the scan — where the receipt still remembers what that plan spent.
   */
  const floor = (live: number, kind: string): number =>
    Math.max(live, readCost(field(receiptPlanCost, kind)));

  const build = runs.reduce((sum, run) => sum + run.costUsd, 0);
  const byKind: PlanCostByKind = {
    planning: round4(floor(ledger.planning, 'planning')),
    review: round4(floor(ledger.review, 'review')),
    scouts: round4(floor(ledger.scouts, 'scouts')),
    build: round4(floor(build, 'build')),
  };

  const totalUsd = round4(byKind.planning + byKind.review + byKind.scouts + byKind.build);
  // Nothing booked anywhere is "not known", never "free": a plan nobody has run has no cost, and a
  // zero would be the drawer claiming a build cost nothing.
  if (totalUsd <= 0) return null;

  return { totalUsd, byKind, runs: runs.length };
}

/**
 * What `planPath` cost end to end, or `null` when nothing is booked against it.
 *
 * Cached per plan for {@link COST_TTL_MS}, keyed by the resolved plan path so two spellings of one
 * plan (`~/.claude/plans/x.md` and `/home/…/.claude/plans/x.md`) share one entry. Entries that
 * have aged out are dropped on the way past, so the map holds the plans being asked about now
 * rather than every plan ever asked about in this process's life.
 */
export function planCostFor(planPath: string): PlanCost | null {
  if (typeof planPath !== 'string') return null;

  // ONE normalization at the door, so the cache key, the ledger's slug and the run matching all
  // judge the same string — see `planKey` for why the trim is load-bearing.
  const wanted = planPath.trim();
  if (wanted.length === 0) return null;

  const key = planKey(wanted);
  const now = Date.now();
  const held = costCache.get(key);
  if (held !== undefined && now - held.at < COST_TTL_MS) return held.value;

  const value = readPlanCost(wanted, key);
  for (const [other, entry] of costCache) {
    if (now - entry.at >= COST_TTL_MS) costCache.delete(other);
  }
  costCache.set(key, { at: now, value });

  return value;
}
