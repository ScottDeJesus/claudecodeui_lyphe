import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { userFacingEnv } from '../../../shared/child-env.js';

const execFileAsync = promisify(execFile);

const VERB_TIMEOUT_MS = 30_000;
const BYTES_PER_MIB = 1024 * 1024;
/** A 90-day answer passes execFile's own one megabyte; 16 MiB is stated so an overflow can be named. */
const OUTPUT_MAX_MIB = 16;
const OUTPUT_OVERFLOW_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/** How a reader's failure sentences name what it ran: the verb (`code-mode`) and the command (`code-mode analytics`). */
export type VerbWords = { verb: string; command: string };

/**
 * A HOUSE VERB'S ANSWER: runs `<bin> <args...>` and parses its LAST stdout line. Every section that reads a house verb
 * comes through here, so the timeout, the output cap and the failure sentences are said once. Every failure throws one
 * sentence, worded by `words`.
 */
export async function runVerbForJson(bin: string, args: readonly string[], words: VerbWords): Promise<unknown> {
  return lastJsonLine(await runVerb(bin, args, words), words);
}

/**
 * Runs the verb with the operator's environment, from the home folder — never this repository's,
 * whose `TSX_TSCONFIG_PATH` would follow the verb's descendants (`shared/child-env.ts`).
 */
async function runVerb(bin: string, args: readonly string[], words: VerbWords): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, [...args], {
      timeout: VERB_TIMEOUT_MS,
      maxBuffer: OUTPUT_MAX_MIB * BYTES_PER_MIB,
      env: userFacingEnv(),
      cwd: os.homedir(),
    });
    return stdout;
  } catch (error) {
    throw new Error(failureSentence(bin, error, words), { cause: error });
  }
}

function failureSentence(bin: string, error: unknown, { verb, command }: VerbWords): string {
  const failure = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown; killed?: unknown; stderr?: unknown;
  };
  if (failure.code === OUTPUT_OVERFLOW_CODE) return `${command} said more than the ${OUTPUT_MAX_MIB} MiB this reader carries`;
  if (failure.code === 'ENOENT') return `the ${verb} verb is not at ${bin}`;
  if (failure.killed === true) return `${command} did not answer within ${VERB_TIMEOUT_MS / 1000} s`;
  // A string code is the spawn's own errno (EACCES, ENOTDIR, …): the verb never ran, so there is no stderr to quote.
  if (typeof failure.code === 'string') return `the ${verb} verb at ${bin} could not be run (${failure.code})`;
  const said = typeof failure.stderr === 'string' ? failure.stderr.trim().split('\n').pop() ?? '' : '';
  return `${command} failed${said ? `: ${said}` : ''}`;
}

/** The verb's answer is its LAST stdout line; anything it says before that is not the answer. */
function lastJsonLine(stdout: string, { command }: VerbWords): unknown {
  const line = stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`${command} printed no JSON object on its last line`);
  }
}
