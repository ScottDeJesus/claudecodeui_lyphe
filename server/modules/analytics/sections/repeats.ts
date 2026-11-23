import type { RepeatsAnalytics } from '../../../shared/analytics-types.js';

import { runVerbForJson } from './verb.js';
import type { VerbWords } from './verb.js';

const REPEATS_WORDS: VerbWords = { verb: 'heal-repeats', command: 'heal-repeats reading' };

/**
 * The Repeats section: the house verb's `heal-repeats reading --days N` (hooks/heal_repeats/answer.py), carried as printed.
 *
 * The verb holds every number, the families and their sentences; this reader computes none. It builds the small objects
 * (`thresholds`, `totals`, `steps`) key by key, so a key the screen reads that went missing is a sentence here, and
 * carries the rows of `series`, `families` and `steps.by_helper` untouched. Every failure throws one sentence.
 */
export function createRepeatsReader(bin: string): (days: number) => Promise<RepeatsAnalytics> {
  return async (days) => narrowAnswer(await runVerbForJson(bin, ['reading', '--days', String(days)], REPEATS_WORDS));
}

type Answer = Record<string, unknown>;

function isRecord(value: unknown): value is Answer {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function misshapen(key: string): Error {
  return new Error(`heal-repeats reading answered without ${key} of the type the screen reads`);
}

function recordAt(answer: Answer, key: string): Answer {
  const value = answer[key];
  if (!isRecord(value)) throw misshapen(key);
  return value;
}

function numberAt(answer: Answer, key: string): number {
  const value = answer[key];
  if (typeof value !== 'number') throw misshapen(key);
  return value;
}

/**
 * The rows under one key, carried as the verb printed them: the verb is the one statement of a row and the screen
 * narrows what it draws, so this is the reader's single unchecked step from "a list of objects" to the row type.
 */
function rowsAt<Row>(answer: Answer, key: string): Row[] {
  const value = answer[key];
  if (!Array.isArray(value) || !value.every(isRecord)) throw misshapen(key);
  return value as Row[];
}

function thresholdsOf(answer: Answer): RepeatsAnalytics['thresholds'] {
  const thresholds = recordAt(answer, 'thresholds');
  return { launches: numberAt(thresholds, 'launches'), chars: numberAt(thresholds, 'chars') };
}

function totalsOf(answer: Answer): RepeatsAnalytics['totals'] {
  const totals = recordAt(answer, 'totals');
  return {
    launches: numberAt(totals, 'launches'),
    launches_writing: numberAt(totals, 'launches_writing'),
    programs: numberAt(totals, 'programs'),
    chars: numberAt(totals, 'chars'),
    chars_in_families: numberAt(totals, 'chars_in_families'),
  };
}

function stepsOf(answer: Answer): RepeatsAnalytics['steps'] {
  const steps = recordAt(answer, 'steps');
  return {
    uses: numberAt(steps, 'uses'),
    worked: numberAt(steps, 'worked'),
    launches: numberAt(steps, 'launches'),
    by_helper: rowsAt(steps, 'by_helper'),
  };
}

function narrowAnswer(answer: unknown): RepeatsAnalytics {
  if (!isRecord(answer)) throw new Error('heal-repeats reading answered something other than one JSON object');
  const firstDay = answer.first_day;
  if (firstDay !== null && typeof firstDay !== 'string') throw misshapen('first_day');
  const today = answer.today;
  if (typeof today !== 'string') throw misshapen('today');
  return {
    days: numberAt(answer, 'days'),
    generated_at: numberAt(answer, 'generated_at'),
    today,
    first_day: firstDay,
    window_days: numberAt(answer, 'window_days'),
    thresholds: thresholdsOf(answer),
    totals: totalsOf(answer),
    steps: stepsOf(answer),
    series: rowsAt(answer, 'series'),
    families: rowsAt(answer, 'families'),
  };
}
