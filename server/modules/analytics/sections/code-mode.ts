import type { CodeModeAnalytics, CodeModeFaultTotals } from '../../../shared/analytics-types.js';

import { runVerbForJson } from './verb.js';
import type { VerbWords } from './verb.js';

const CODE_MODE_WORDS: VerbWords = { verb: 'code-mode', command: 'code-mode analytics' };

/**
 * The Code Mode section: the house verb's `code-mode analytics --days N`, carried as printed.
 *
 * The verb holds the numbers and the list of kinds; this reader holds neither. It checks that each
 * top-level key has the type the wire promises and carries every row untouched, so a kind or a figure
 * the house adds reaches the screen with no change here. Every failure throws one sentence.
 */
export function createCodeModeReader(bin: string): (days: number) => Promise<CodeModeAnalytics> {
  return async (days) => narrowAnswer(await runVerbForJson(bin, ['analytics', '--days', String(days)], CODE_MODE_WORDS));
}

type Answer = Record<string, unknown>;

function isRecord(value: unknown): value is Answer {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function misshapen(key: string): Error {
  return new Error(`code-mode analytics answered without ${key} of the type the screen reads`);
}

function numberAt(answer: Answer, key: string): number {
  const value = answer[key];
  if (typeof value !== 'number') throw misshapen(key);
  return value;
}

function stringAt(answer: Answer, key: string): string {
  const value = answer[key];
  if (typeof value !== 'string') throw misshapen(key);
  return value;
}

/**
 * The rows under one key, carried as the verb printed them. The verb is the one statement of a row,
 * and the screen narrows what it draws, so this is the area's single unchecked step from "a list of
 * objects" to the row type — kept here, in one place, rather than re-deriving the house's shapes.
 */
function rowsAt<Row>(answer: Answer, key: string): Row[] {
  const value = answer[key];
  if (!Array.isArray(value) || !value.every(isRecord)) throw misshapen(key);
  return value as Row[];
}

function countsAt(answer: Answer, key: string): Record<string, number> {
  const value = answer[key];
  if (!isRecord(value) || !Object.values(value).every((count) => typeof count === 'number')) throw misshapen(key);
  return value as Record<string, number>;
}

function faultTotalsAt(answer: Answer): CodeModeFaultTotals {
  const faults = answer.faults;
  if (!isRecord(faults)) throw misshapen('faults');
  return { total: numberAt(faults, 'total'), by_fault: countsAt(faults, 'by_fault') };
}

function narrowAnswer(answer: unknown): CodeModeAnalytics {
  if (!isRecord(answer)) throw new Error('code-mode analytics answered something other than one JSON object');
  const firstDay = answer.first_day;
  if (firstDay !== null && typeof firstDay !== 'string') throw misshapen('first_day');
  return {
    days: numberAt(answer, 'days'),
    generated_at: numberAt(answer, 'generated_at'),
    today: stringAt(answer, 'today'),
    first_day: firstDay,
    kinds: rowsAt(answer, 'kinds'),
    uncounted: rowsAt(answer, 'uncounted'),
    groups: rowsAt(answer, 'groups'),
    rollups: rowsAt(answer, 'rollups'),
    series: rowsAt(answer, 'series'),
    faults: faultTotalsAt(answer),
    causes: rowsAt(answer, 'causes'),
  };
}
