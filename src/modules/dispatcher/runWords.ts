import type { DispatcherStage, Tone } from '@/shared/types';

/** What kind of run a stage was: the builder's first pass, a fix after a failed review, or the review itself. Null for a stage of another name, which is read as written. */
export type RunKind = 'build' | 'fix' | 'review';

/** The dispatcher's own stage names: `builder`, `fix-pass` and a later round's `fix-pass-r<N>` are the builder's seats; a review is `athena-<N>`. */
const BUILD = /^builder$/;
const FIX = /^fix-pass(?:-r\d+)?$/;
const REVIEW = /^athena(?:-\d+)?$/;

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
 * The tone of a soul's verdict. It is free text and is drawn as written; only how it opens is read: `PASS` is positive,
 * `FAIL` is danger, and any other word is plain.
 */
export function verdictTone(verdict: string): Tone {
  const word = verdict.trim().toUpperCase();
  if (word.startsWith('PASS')) return 'positive';
  if (word.startsWith('FAIL')) return 'danger';
  return 'neutral';
}

/**
 * The round each stage belongs to, in the stages' own order, counted from 1: a review ends its round, so the stage after a
 * review opens the next. It is the same count `DispatcherPhase.rounds` makes of the reviews, read per stage so a row can
 * mark where each round starts.
 *
 * Used by `PlanPhaseRow`, with the two readings above.
 */
export function roundsOf(stages: readonly DispatcherStage[]): number[] {
  let round = 1;
  return stages.map((stage) => {
    const mine = round;
    if (runKindOf(stage.name) === 'review') round += 1;
    return mine;
  });
}
