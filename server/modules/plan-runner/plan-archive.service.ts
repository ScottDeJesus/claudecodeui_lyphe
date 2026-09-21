import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expandHome } from '@/shared/utils.js';

/**
 * Archive FINISHED plans out of the plans corpus into its `archive/` subdirectory, called by the
 * plan-runner module on its own cadence.
 *
 * The plans corpus grows unbounded — every `/plan` session and every runner plan lands in it, and
 * nothing prunes it — so the finished ones are moved aside. This is the WHOLE of the selection
 * rule, and it is one function: four clauses, all of which must hold AFFIRMATIVELY. Anything else
 * STAYS PUT, because every doubt here costs a kept file and a wrong answer costs a plan:
 *
 *   1. COLD — the file's mtime is older than 48 h, which protects the plan being written now.
 *   2. ZERO UNSHIPPED PHASES — per the runner's own classifier, which protects a paused build.
 *   3. NO LIVE LEASE — the plan is not one the board's cards are holding (see below).
 *   4. POSITIVE DONE-EVIDENCE — the file carries a ship-log stamp. Without it a notes file that
 *      happens to be `.md` and happens to be old would be swept away from a person still reading
 *      it; cold and unshipped are absences, and this clause is the one PRESENCE the sweep requires.
 *
 * CLAUSE 2 IS NOT IMPLEMENTED HERE. The count comes from `~/.claude/hooks/auto_execute_plan.py`'s
 * `_count_unshipped_phases` — the exact reader `/execute` trusts — run in a child process against
 * the plan's text. That reader changes whenever the plan format changes, and a TypeScript copy of
 * it would answer differently from the thing that walks the file. When the child cannot be
 * reached at all, this sweep moves NOTHING: an unanswerable clause 2 keeps every plan, which is the
 * fail-safe this sweep is built on.
 *
 * CLAUSE 3 ARRIVES AS A PARAMETER, and this file never learns where it came from. A card's plan or
 * build lease is the sole mid-build guard on a plan already cold by clause 1 — a build can hold a
 * fresh lease on a plan nobody has touched for a week — so the paths a board's leases hold are
 * handed in, read afresh by the caller on every pass. This module opens no database, reads no
 * table, and imports nothing from the board: the arrow points one way and the composition root
 * joins it.
 *
 * THE ONLY WRITE IS THE MOVE, and it is REVERSIBLE — never a delete. `archive/<name>` that already
 * exists is HELD rather than clobbered, so a second copy of a plan is never lost to a name
 * collision. A dry run (`apply: false`) writes nothing at all, not even the destination directory.
 *
 * Consumers: `plan-runner.module.ts` (the daily pass), and probes.
 */

/** Where the corpus lives unless the operator moved it. Read at CALL time, so a probe's env reaches the sweep rather than a captured one. */
const DEFAULT_PLANS_DIR = '~/.claude/plans';

/** The directory holding the runner's own phase reader. The one home for clause 2's rule. */
const CLASSIFIER_DIR = '~/.claude/hooks';

/** How old a plan must be before the sweep may touch it, in hours. */
const COLD_HOURS = 48;

/** The same window in milliseconds, derived so the two spellings cannot drift. */
const COLD_MS = COLD_HOURS * 60 * 60 * 1000;

/** Wall-clock ceiling for one classifier call. A plan is a text file; a child that has not answered in seconds is not going to. */
const CLASSIFIER_TIMEOUT_MS = 20_000;

/**
 * The classifier call itself, as the child process reads it: the hooks directory goes in as argv,
 * never interpolated into the program, and the plan text arrives on stdin — so a plan containing
 * quotes, backticks or a `#!` line is data and never code.
 */
const CLASSIFIER_SCRIPT = [
  'import sys',
  'sys.path.insert(0, sys.argv[1])',
  'import auto_execute_plan',
  'print(auto_execute_plan._count_unshipped_phases(sys.stdin.read())[0])',
].join('\n');

/** A date, in the shape the runner stamps (`_SHIPPED_DATE_RE`). */
const SHIPPED_DATE_RE = /\d{4}-\d{2}-\d{2}/;

/** What one sweep did: the plans it selected, and every plan it left where it was, with the clause that kept it. */
export type PlanArchiveSweep = { moved: string[]; held: Record<string, string> };

/** A caught value as one line of prose. The server has no logger and this file has no logger either. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The corpus directory, `~` expanded. */
function plansDir(): string {
  return expandHome(process.env.CLOUDCLI_PLANS_DIR || DEFAULT_PLANS_DIR);
}

/** Its archive subdirectory — a sibling of the plans, never a second corpus. */
function archiveDir(): string {
  return path.join(plansDir(), 'archive');
}

/**
 * The key a plan path is compared by: `~` expanded, then resolved.
 *
 * A card stores a plan path as a person or an agent typed it (`~/.claude/plans/x.md`) while the
 * sweep holds the corpus's own absolute spelling. Two spellings of one path are one plan, and a
 * comparison that missed that would move a leased plan — so both sides go through this door, and a
 * plan that is not on disk (a card still holding a plan already moved) falls back to its absolute
 * form rather than throwing.
 */
function normalizePath(planPath: string): string {
  const expanded = expandHome(planPath.trim());
  try {
    return fs.realpathSync(expanded);
  } catch {
    return path.resolve(expanded);
  }
}

/**
 * Clause 2's answer for one plan: how many phases it has not shipped, or `null` when the runner's
 * reader could not be asked.
 *
 * The child is synchronous and short: `auto_execute_plan` imports no heavy module, so a plan costs
 * tens of milliseconds. A non-answer — a missing interpreter, an import failure, a timeout, a
 * traceback — is `null`, and every caller treats that as "cannot say", never as "zero".
 */
function countUnshippedPhases(text: string): number | null {
  try {
    const stdout = execFileSync('python3', ['-c', CLASSIFIER_SCRIPT, expandHome(CLASSIFIER_DIR)], {
      input: text,
      encoding: 'utf-8',
      timeout: CLASSIFIER_TIMEOUT_MS,
    });
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

/**
 * Clause 4's answer: does this file carry a ship-log stamp?
 *
 * The stamp the runner writes is a single line — `### Phase 4 Ship Log — ✅ SHIPPED 2026-09-17`,
 * and its older spelling `#### Phase 1 Ship Log — SHIPPED ✅ 2026-08-31` — so the test is that ONE
 * line carries all three parts: the tick, the word, and a date. Measured against the live corpus,
 * this agrees with the port's own shipped-phase count on every plan in it, including the two that
 * spell the tick after the word.
 *
 * It is deliberately NOT the port's phase-windowed walk (a heading plus its next five lines): that
 * walk is the runner's reader of a plan, clause 2 already asks the runner for its verdict on every
 * phase, and a second copy of the walk is the drift this file exists to avoid.
 */
function hasShipLogStamp(text: string): boolean {
  return text.split(/\r?\n/).some(
    (line) => line.includes('✅') && line.toUpperCase().includes('SHIPPED') && SHIPPED_DATE_RE.test(line)
  );
}

/** One plan's verdict: whether it may move, and the words a report can print either way. */
type PlanVerdict = { move: boolean; reason: string };

/**
 * The four clauses, applied to ONE plan. Every path out of here that is not an affirmative answer
 * is a keep, including the ones that are a fault rather than a judgement.
 */
function decidePlan(file: string, now: number, heldKeys: Set<string>): PlanVerdict {
  // Clause 1 — COLD. A stat that fails (a file vanished mid-sweep) or an mtime in the future
  // (clock skew) keeps the plan: neither is evidence that anyone is finished with it.
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch (error) {
    return { move: false, reason: `stat failed (${describe(error)}) — kept` };
  }

  // The gate is the millisecond window, so `COLD_MS` is the one place the ages are compared; the
  // hours are derived from the same difference for the words a report prints, and never re-derived
  // as a threshold.
  const ageMs = now - mtimeMs;
  const ageHours = ageMs / 3_600_000;
  if (ageMs < 0) return { move: false, reason: `future mtime (${ageHours.toFixed(1)}h) — clause 1 keep` };
  if (ageMs <= COLD_MS) {
    return { move: false, reason: `warm ${ageHours.toFixed(1)}h (≤${COLD_HOURS}h) — clause 1 keep` };
  }

  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (error) {
    return { move: false, reason: `unreadable (${describe(error)}) — kept` };
  }

  // Clause 2 — ZERO UNSHIPPED PHASES, as the runner itself reads them.
  const unshipped = countUnshippedPhases(text);
  if (unshipped === null) return { move: false, reason: "the runner's phase reader gave no answer — kept" };
  if (unshipped > 0) return { move: false, reason: `${unshipped} unshipped phase(s) — clause 2 keep` };

  // Clause 3 — NO LIVE LEASE.
  if (heldKeys.has(normalizePath(file))) {
    return { move: false, reason: 'a live plan or build lease holds this plan — clause 3 keep' };
  }

  // Clause 4 — POSITIVE DONE-EVIDENCE.
  if (!hasShipLogStamp(text)) return { move: false, reason: 'no ship-log stamp — clause 4 keep' };

  return { move: true, reason: 'cold, 0 unshipped phases, no lease, ship-log stamped — all four clauses' };
}

/**
 * One pass over the top-level corpus: decide every `.md` beside the archive directory and, when
 * `apply`, MOVE the selected ones into it.
 *
 * `now` is epoch MILLISECONDS, passed in rather than read here so a pass is reproducible. `held`
 * is every plan that stayed, keyed by its absolute path — the clause that kept it, or the reason a
 * move did not happen — so a dry run answers "why is this still here" for the whole corpus rather
 * than naming only the ones it would move.
 *
 * Nothing recurses and nothing outside the top level is touched: the archive directory is skipped
 * by construction (it is a directory among files, and only `*.md` files are candidates), so a
 * second sweep can never walk its own output back in.
 */
export function sweepPlanArchive(
  now: number,
  apply: boolean,
  heldPlanPaths: Set<string>
): PlanArchiveSweep {
  const sweep: PlanArchiveSweep = { moved: [], held: {} };

  // The fail-safe first: with no reader for clause 2, no plan can clear all four clauses, so the
  // pass ends here rather than moving a plan whose phases nobody counted.
  if (countUnshippedPhases('') === null) {
    sweep.held[plansDir()] = "the runner's phase reader could not be reached — nothing archived";
    return sweep;
  }

  const heldKeys = new Set<string>();
  for (const held of heldPlanPaths) {
    if (typeof held === 'string' && held.trim().length > 0) heldKeys.add(normalizePath(held));
  }

  let names: string[];
  try {
    names = fs
      .readdirSync(plansDir(), { withFileTypes: true })
      // A symlink is not a file to a directory entry, so it is never a candidate here — the port's
      // own "a symlink could break a relative target" guard, held structurally rather than tested.
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    sweep.held[plansDir()] = `plans directory unreadable (${describe(error)}) — nothing archived`;
    return sweep;
  }

  for (const name of names) {
    const file = path.join(plansDir(), name);

    let verdict: PlanVerdict;
    try {
      verdict = decidePlan(file, now, heldKeys);
    } catch (error) {
      // One unreadable plan is one kept plan. A sweep that threw here would end the interval.
      verdict = { move: false, reason: `unexpected error (${describe(error)}) — kept` };
    }

    if (!verdict.move) {
      sweep.held[file] = verdict.reason;
      continue;
    }

    if (!apply) {
      sweep.moved.push(file);
      continue;
    }

    const destination = path.join(archiveDir(), name);
    if (fs.existsSync(destination)) {
      sweep.held[file] = `archive/${name} already exists — not clobbered`;
      continue;
    }

    try {
      // The destination directory is made only on the pass that writes, so a dry run leaves no
      // trace at all. The move is a rename within one directory tree: atomic where it lands.
      fs.mkdirSync(archiveDir(), { recursive: true });
      fs.renameSync(file, destination);
    } catch (error) {
      sweep.held[file] = `move failed (${describe(error)}) — left in place`;
      continue;
    }

    sweep.moved.push(file);
  }

  return sweep;
}
