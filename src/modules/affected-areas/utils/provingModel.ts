import type { TFunction } from 'i18next';

import type { ProvingClass } from '@/shared/affected-areas-types';
import { formatShortDate } from '@/shared/utils';

/*
 * HOW THE TABLES SAY THE ENGINE'S NUMBERS: a line, whether a share stands on enough judgments to be a percentage, and
 * when two lines are the same line. Nothing here computes a figure. Every number is `GET /proving`'s; these decide only
 * how it reads, or whether it reads at all. Read by the affected-areas module's `ProvingTable`, `ProvingDetail` and
 * `ThresholdControl`.
 */

/** Fewer judgments than this behind a share, and the share is a dash: a precision of 2 of 3 reads like knowledge it is not. */
const FEWEST_FOR_A_PERCENT = 10;

/**
 * Whether a share stands on too few judgments to be said as a percentage, given the count it is over (the engine's
 * `_score`): a precision is over the judged regions at or above its line (`nAt`, or a sweep point's `n`), a coverage
 * over the kind's confirmed (`right`). The engine leaves this to the viewer, and returns a share from one judgment up.
 * A share the engine could not give (null) is over none, so it is a dash on the same rule.
 */
export function tooFew(count: number): boolean {
  return count < FEWEST_FOR_A_PERCENT;
}

/**
 * Whether a kind is judged fewer than ten times on the random slice. Every share it has is then a dash, and its line can
 * still be set: the control says the operator may set it on his own judgment.
 */
export function isThin(kind: ProvingClass): boolean {
  return tooFew(kind.randomSlice.n);
}

/**
 * A line in the unit a region's confidence is said in ("72% sure", "threshold 65%" on the Mark screen): "65%". The
 * stepper's 0.05 steps are five points.
 */
export function lineWords(line: number, t: TFunction): string {
  return t('affectedAreas.tables.percent', { percent: Math.round(line * 100) });
}

/**
 * Whether two lines are the same line. A line the stepper built from 0.05 steps and one the engine sent are compared
 * within a hair, never with `===`: a sum of tenths is not always the tenth it reads as.
 */
export function sameLine(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/**
 * The line in force in words: "Threshold 65% · set Oct 15", or "Threshold 50% · default" for a line nobody has set on
 * this model and contract (the engine's 0.5).
 */
export function thresholdWords(kind: ProvingClass, t: TFunction): string {
  const value = lineWords(kind.threshold, t);
  if (kind.isDefault) return t('affectedAreas.tables.thresholdDefault', { value });
  return t('affectedAreas.tables.thresholdSet', { value, date: formatShortDate(kind.thresholdSetAt) ?? '—' });
}
