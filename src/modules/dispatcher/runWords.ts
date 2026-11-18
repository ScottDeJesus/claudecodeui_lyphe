import type { DispatcherStage, Tone } from '@/shared/types';

/** What kind of run a stage was: the builder's first pass, a fix after a failed review, or the review itself. Null for a stage of another name, which is read as written. */
export type RunKind = 'build' | 'fix' | 'review';

/**
 * The dispatcher's own stage names: `builder`, `fix-pass` and a later round's `fix-pass-r<N>` are the builder's seats; a review is
 * named for its round, after the reviewer (`athena-<N>`) or plainly (`review-<N>`, the name a review by another soul carries).
 */
const BUILD = /^builder$/;
const FIX = /^fix-pass(?:-r\d+)?$/;
const REVIEW = /^(?:athena|review)(?:-\d+)?$/;

/**
 * The kind of run a stage's name states, or null when it states none of the three (the name is then shown as it is).
 * The names are the dispatcher's (`dispatcher-build-flags.reader.ts` reads the same builder seats; `DispatcherPhase.rounds`
 * counts the `athena-*` ones).
 */
export function runKindOf(name: string): RunKind | null {
  if (BUILD.test(name)) return 'build';
  if (FIX.test(name)) return 'fix';
  if (REVIEW.test(name)) return 'review';
  return null;
}

/** The tone each kind of run wears: a build is info, a fix is warn (the task went round again), a review is plain: its verdict carries the colour. */
export const RUN_KIND_TONE: Record<RunKind, Tone> = { build: 'info', fix: 'warn', review: 'neutral' };

/**
 * The tone of each stage's verdict, in the stages' own order. A verdict is free text and is drawn as written; its colour says
 * how the run came out, read two ways:
 *
 * - BY ITS OWN WORD, where it has one: a verdict that opens `PASS` is positive and one that opens `FAIL` is danger.
 * - BY WHAT THE TASK DID NEXT, for a review whose verdict is a tally of findings (`B:0 H:1 M:2 L:5`) and says neither word: a
 *   review the builder's fix followed sent the task round again, so it is danger; the last review of a task that is done let
 *   it through, so it is positive. Nothing is read out of the tally's letters: which findings fail a task is the dispatcher's
 *   to decide, and the stages already record what it decided.
 *
 * Every other verdict is plain: a builder's, a sweep's counts (`DOCS: 4 · ROWS: 12`), a review still awaiting what follows it.
 * `done` is whether the task has finished (`DispatcherPhase.status`).
 *
 * Used by `PlanPhaseRow`, for the badge each run's verdict wears.
 */
export function verdictTones(stages: readonly DispatcherStage[], done: boolean): Tone[] {
  const kinds = stages.map((stage) => runKindOf(stage.name));
  const lastReview = kinds.lastIndexOf('review');
  return stages.map((stage, index) => {
    const word = (stage.verdict ?? '').trim().toUpperCase();
    if (word.startsWith('PASS')) return 'positive';
    if (word.startsWith('FAIL')) return 'danger';
    if (kinds[index] !== 'review' || word === '') return 'neutral';
    // The stage that follows a review, before the next review, says how the review came out.
    const next = kinds.slice(index + 1).find((kind) => kind !== null);
    if (next === 'fix') return 'danger';
    return index === lastReview && done ? 'positive' : 'neutral';
  });
}

/**
 * The round each stage belongs to, in the stages' own order, counted from 1: a review ends its round, so the stage after a
 * review opens the next. It is the same count `DispatcherPhase.rounds` makes of the reviews, read per stage so a row can
 * mark where each round starts.
 *
 * Used by `PlanPhaseRow`, with the two readings above. A review is either name `runKindOf` reads as one, so a task reviewed
 * under `review-<N>` counts its rounds as one reviewed under `athena-<N>` does.
 */
export function roundsOf(stages: readonly DispatcherStage[]): number[] {
  let round = 1;
  return stages.map((stage) => {
    const mine = round;
    if (runKindOf(stage.name) === 'review') round += 1;
    return mine;
  });
}
