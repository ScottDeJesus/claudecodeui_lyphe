import type {
  WebWalkAnalytics,
  WebWalkBars,
  WebWalkDoors,
  WebWalkSettled,
  WebWalkTotals,
} from '../../../shared/analytics-types.js';

import { runVerbForJson } from './verb.js';
import type { VerbWords } from './verb.js';

const WEB_WALK_WORDS: VerbWords = { verb: 'web-walk', command: 'web-walk reading' };

/**
 * The Web walks section: the house command's `web-walk reading --days N` (hooks/web_walk/answer.py), carried as printed.
 *
 * The command holds every number; this reader computes none. It builds the three small objects (`settled` with its
 * `bars`, `totals`, `doors`) key by key, so a key the screen reads that went missing is a sentence here, and carries
 * the rows of `series`, `checks` and `apps` untouched. Every failure throws one sentence.
 */
export function createWebWalkReader(bin: string): (days: number) => Promise<WebWalkAnalytics> {
  return async (days) => narrowAnswer(await runVerbForJson(bin, ['reading', '--days', String(days)], WEB_WALK_WORDS));
}

type Answer = Record<string, unknown>;

function isRecord(value: unknown): value is Answer {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function misshapen(key: string): Error {
  return new Error(`web-walk reading answered without ${key} of the type the screen reads`);
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

function numberOrNullAt(answer: Answer, key: string): number | null {
  const value = answer[key];
  if (value !== null && typeof value !== 'number') throw misshapen(key);
  return value;
}

/**
 * The rows under one key, carried as the command printed them: the command is the one statement of a row and the screen
 * narrows what it draws, so this is the reader's single unchecked step from "a list of objects" to the row type.
 */
function rowsAt<Row>(answer: Answer, key: string): Row[] {
  const value = answer[key];
  if (!Array.isArray(value) || !value.every(isRecord)) throw misshapen(key);
  return value as Row[];
}

function barsOf(settled: Answer): WebWalkBars {
  const bars = recordAt(settled, 'bars');
  return {
    min_launches: numberAt(bars, 'min_launches'),
    share: numberAt(bars, 'share'),
    min_walks: numberAt(bars, 'min_walks'),
    fault_share: numberAt(bars, 'fault_share'),
    release_min_walks: numberAt(bars, 'release_min_walks'),
    release_fault_share: numberAt(bars, 'release_fault_share'),
  };
}

function settledOf(answer: Answer): WebWalkSettled {
  const settled = recordAt(answer, 'settled');
  if (typeof settled.refusing !== 'boolean') throw misshapen('settled.refusing');
  return {
    refusing: settled.refusing,
    since: numberOrNullAt(settled, 'since'),
    window_days: numberAt(settled, 'window_days'),
    launches_walking: numberAt(settled, 'launches_walking'),
    launches_by_hand: numberAt(settled, 'launches_by_hand'),
    share: numberOrNullAt(settled, 'share'),
    walks: numberAt(settled, 'walks'),
    faults: numberAt(settled, 'faults'),
    bars: barsOf(settled),
  };
}

function totalsOf(answer: Answer): WebWalkTotals {
  const totals = recordAt(answer, 'totals');
  return {
    walks: numberAt(totals, 'walks'),
    launches_walking: numberAt(totals, 'launches_walking'),
    launches_by_hand: numberAt(totals, 'launches_by_hand'),
    custom_steps: numberAt(totals, 'custom_steps'),
    walks_with_custom: numberAt(totals, 'walks_with_custom'),
    checks_false: numberAt(totals, 'checks_false'),
    faults: numberAt(totals, 'faults'),
    unreached: numberAt(totals, 'unreached'),
  };
}

function doorsOf(answer: Answer): WebWalkDoors {
  const doors = recordAt(answer, 'doors');
  return { execute: numberAt(doors, 'execute'), command: numberAt(doors, 'command') };
}

function narrowAnswer(answer: unknown): WebWalkAnalytics {
  if (!isRecord(answer)) throw new Error('web-walk reading answered something other than one JSON object');
  const firstDay = answer.first_day;
  if (firstDay !== null && typeof firstDay !== 'string') throw misshapen('first_day');
  const today = answer.today;
  if (typeof today !== 'string') throw misshapen('today');
  return {
    days: numberAt(answer, 'days'),
    generated_at: numberAt(answer, 'generated_at'),
    today,
    first_day: firstDay,
    settled: settledOf(answer),
    totals: totalsOf(answer),
    series: rowsAt(answer, 'series'),
    checks: rowsAt(answer, 'checks'),
    doors: doorsOf(answer),
    apps: rowsAt(answer, 'apps'),
  };
}
