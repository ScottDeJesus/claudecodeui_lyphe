import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import type { CodeModeAnalytics, CodeModeFaultTotals } from '../../../shared/analytics-types.js';
import { userFacingEnv } from '../../../shared/child-env.js';

const execFileAsync = promisify(execFile);

const VERB_TIMEOUT_MS = 30_000;
const BYTES_PER_MIB = 1024 * 1024;
/** A 90-day answer passes execFile's own one megabyte; 16 MiB is stated so an overflow can be named. */
const OUTPUT_MAX_MIB = 16;
const OUTPUT_OVERFLOW_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/**
 * The Code Mode section: the house verb's `code-mode analytics --days N`, carried as printed.
 *
 * The verb holds the numbers and the list of kinds; this reader holds neither. It checks that each
 * top-level key has the type the wire promises and carries every row untouched, so a kind or a figure
 * the house adds reaches the screen with no change here. Every failure throws one sentence.
 */
export function createCodeModeReader(bin: string): (days: number) => Promise<CodeModeAnalytics> {
  return async (days) => narrowAnswer(lastJsonLine(await runVerb(bin, days)));
}

/**
 * Runs the verb with the operator's environment, from the home folder — never this repository's,
 * whose `TSX_TSCONFIG_PATH` would follow the verb's descendants (`shared/child-env.ts`).
 */
async function runVerb(bin: string, days: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, ['analytics', '--days', String(days)], {
      timeout: VERB_TIMEOUT_MS,
      maxBuffer: OUTPUT_MAX_MIB * BYTES_PER_MIB,
      env: userFacingEnv(),
      cwd: os.homedir(),
    });
    return stdout;
  } catch (error) {
    throw new Error(failureSentence(bin, error), { cause: error });
  }
}

function failureSentence(bin: string, error: unknown): string {
  const failure = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown; killed?: unknown; stderr?: unknown;
  };
  if (failure.code === OUTPUT_OVERFLOW_CODE) return `code-mode analytics said more than the ${OUTPUT_MAX_MIB} MiB this reader carries`;
  if (failure.code === 'ENOENT') return `the code-mode verb is not at ${bin}`;
  if (failure.killed === true) return `code-mode analytics did not answer within ${VERB_TIMEOUT_MS / 1000} s`;
  // A string code is the spawn's own errno (EACCES, ENOTDIR, …): the verb never ran, so there is no stderr to quote.
  if (typeof failure.code === 'string') return `the code-mode verb at ${bin} could not be run (${failure.code})`;
  const said = typeof failure.stderr === 'string' ? failure.stderr.trim().split('\n').pop() ?? '' : '';
  return `code-mode analytics failed${said ? `: ${said}` : ''}`;
}

/** The verb's answer is its LAST stdout line; anything it says before that is not the answer. */
function lastJsonLine(stdout: string): unknown {
  const line = stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(line);
  } catch {
    throw new Error('code-mode analytics printed no JSON object on its last line');
  }
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
