import path from 'node:path';

import type { RunnerPhaseState, RunnerRunSnapshot } from '@/shared/types.js';

/**
 * Which plan-runner endings earn a notification, and the memory that makes each one push once.
 *
 * An ending is a run the lane carries as `ended`. Three outcomes are never announced:
 * `rate-limited`, because nothing is wrong with the plan and `runner_watchdog.py` resumes the same
 * run when its window lifts; `dry-run`, a rehearsal that spawned nothing; and `unknown`, a receipt
 * the transport caught mid-write, which reads as its real word on the next tick.
 *
 * "Already announced" is a WATERMARK on `ended_at`, held by the caller in durable storage rather
 * than in this process. The dev server restarts on every edit through a handover that runs the old
 * and the new server side by side: a set held in memory would re-announce every ending of the last
 * day on each boot, or — seeded silently at boot — lose the ending that landed during the restart.
 * Read again just before anything is sent, the mark also keeps the two servers of a handover from
 * pushing one ending twice.
 */

export type RunnerEndingCode = 'runner.finished' | 'runner.blocked';

export type RunnerEndingMeta = {
  /** The plan's title, carried as the notification's session name so the title reads "Plan blocked · <plan>". */
  sessionName: string;
  outcome: string;
  shipped: number;
  total: number;
  blocked: number;
  /** Phases neither shipped, deferred nor blocked: never started, or cut off by the ending. */
  left: number;
  /** The first blocked phase in plan order and its cause, or `null` when nothing is blocked. */
  blockedPhase: string | null;
  blockCause: string | null;
  /** From the run's FIRST start: a resumed run keeps its original `started_at`, parked hours included. */
  durationMs: number;
  /** The plan's spend over every run of it — the counter the operator asked never to reset. */
  costUsd: number;
};

export type RunnerEnding = {
  /** `<run_id>:<ended_at>` — one ending of one run; a resumed run that ends again is a new one. */
  key: string;
  endedAt: number;
  code: RunnerEndingCode;
  meta: RunnerEndingMeta;
};

export type RunnerEndingsDependencies = {
  /** The newest `ended_at` already announced, in epoch seconds, or `null` when none was ever stored. */
  readMark: () => number | null;
  writeMark: (endedAt: number) => void;
  /** Tells the users about one ending. Synchronous; a throw leaves that ending and the ones after it due. */
  announce: (ending: RunnerEnding) => void;
};

export type RunnerEndingsNotifier = {
  /** Reads one picture of the lane. `now` is epoch SECONDS, like every timestamp in a snapshot. */
  observe(runs: RunnerRunSnapshot[], now: number): void;
};

const SILENT_OUTCOMES = new Set(['rate-limited', 'dry-run', 'unknown']);

function isDue(run: RunnerRunSnapshot, mark: number): run is RunnerRunSnapshot & { ended_at: number } {
  return run.state === 'ended'
    && run.ended_at !== null
    && run.ended_at > mark
    && !SILENT_OUTCOMES.has(run.outcome ?? 'unknown');
}

/**
 * One ended run as the notification it earns.
 *
 * Finished means the runner said `complete` AND no phase row is blocked or pending — the Runner
 * card's own `runUnfinished` rule (`src/modules/plan-runner/runState.ts`), because the runner's
 * `complete` means something shipped, not that nothing is left. Every other ending wants a hand.
 *
 * A phase counts as blocked when its row says so OR the receipt names it: a phase halted on a crash
 * or a budget is in the receipt's map with its row still `running` or `pending`.
 */
function endingOf(run: RunnerRunSnapshot & { ended_at: number }): RunnerEnding {
  const count = (state: RunnerPhaseState): number => run.phases.filter((phase) => phase.state === state).length;
  const blocked = run.phases
    .filter((phase) => phase.state === 'blocked' || (phase.state !== 'shipped' && Object.hasOwn(run.blocked_causes, phase.id)))
    .map((phase) => ({ id: phase.id, cause: run.blocked_causes[phase.id] || phase.note }));
  const shipped = count('shipped');
  const finished = run.outcome === 'complete' && count('blocked') === 0 && count('pending') === 0;

  return {
    key: `${run.run_id}:${run.ended_at}`,
    endedAt: run.ended_at,
    code: finished ? 'runner.finished' : 'runner.blocked',
    meta: {
      sessionName: run.plan_title || path.basename(run.plan_path, '.md'),
      outcome: run.outcome ?? 'unknown',
      shipped,
      total: run.phases.length,
      blocked: blocked.length,
      left: Math.max(0, run.phases.length - shipped - count('deferred') - blocked.length),
      blockedPhase: blocked[0]?.id || null,
      blockCause: blocked[0]?.cause || null,
      durationMs: Math.max(0, (run.ended_at - run.started_at) * 1000),
      costUsd: run.plan_cost_usd,
    },
  };
}

export function createRunnerEndingsNotifier(dependencies: RunnerEndingsDependencies): RunnerEndingsNotifier {
  /** The mark as this process last read or wrote it; `undefined` until the first picture loads it. */
  let knownMark: number | null | undefined;

  return {
    observe(runs, now) {
      if (knownMark === undefined) knownMark = dependencies.readMark();
      if (knownMark === null) {
        // First sight of the lane on this database: the receipts already on disk are history.
        dependencies.writeMark(now);
        knownMark = now;
        return;
      }

      const cached = knownMark;
      if (!runs.some((run) => isDue(run, cached))) return;

      const mark = dependencies.readMark() ?? cached;
      knownMark = mark;
      const due = runs.filter((run) => isDue(run, mark)).sort((left, right) => left.ended_at - right.ended_at);
      for (const run of due) {
        const ending = endingOf(run);
        dependencies.announce(ending);
        // Advanced after each announcement, never before: a throw leaves the rest due on the next
        // change and never marks a push that did not go out.
        dependencies.writeMark(ending.endedAt);
        knownMark = ending.endedAt;
      }
    },
  };
}
