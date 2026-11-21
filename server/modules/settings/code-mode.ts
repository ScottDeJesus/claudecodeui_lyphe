import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { userFacingEnv } from '@/shared/child-env.js';
import { AppError } from '@/shared/utils.js';

/**
 * The Code Mode switches are the operator's: one flag file per kind under `~/.claude/state/code_mode/`. The
 * verb `~/.claude/scripts/code-mode` is their ONE reader and writer. `set` is the only writer, and it refuses
 * a soul or a chat at the real flag directory, which is why the card passes `--by app:card` as its door.
 *
 * This module reads and writes NO flag file and holds NO list of kinds. It asks the verb and answers what the
 * verb printed, so a kind a later plan adds reaches the card with no change here. The verb's environment is
 * `userFacingEnv()` whole, so a probe server started with `CODE_MODE_FLAG_DIR` on a scratch folder flips the
 * scratch flags.
 *
 * `settings.service.ts` delegates `getCodeMode` and `setCodeMode` here verbatim, the routes are GET and PUT
 * `/api/settings/code-mode` in `settings.routes.ts`, and the card is `RunnerCodeModeRow.tsx` over
 * `src/shared/hooks/useCodeMode.ts`.
 */

const execFileAsync = promisify(execFile);

/** The verb that owns every Code Mode flag. Absolute, so `PATH` is not consulted. */
const CODE_MODE_VERB = path.join(os.homedir(), '.claude', 'scripts', 'code-mode');

/** The ceiling for one verb call: the status runs the sandbox's selfcheck and folds a week of launch records. */
const VERB_TIMEOUT_MS = 15_000;

/** The `--by` value the card passes to `set`. */
const OPERATOR_DOOR = 'app:card';

/** The verb's exit code for a kind it does not know. It refuses before writing, so nothing moved. */
const UNKNOWN_KIND_EXIT = 2;

/** One kind as the verb states it: its label, its own words, its position, and its report line. */
export type CodeModeKindStatus = { kind: string; label: string; says: string; enabled: boolean; report: string };

/**
 * The card's whole answer. All three `null` means the verb could not be asked, which is neither off nor
 * not ready.
 */
export type CodeModeState = { ready: boolean | null; why: string | null; kinds: CodeModeKindStatus[] | null };

/** The answer when the verb could not be asked: all three fields `null`, never a guessed position. */
const UNASKED: CodeModeState = { ready: null, why: null, kinds: null };

/**
 * Narrow one entry of `kinds` to `CodeModeKindStatus`, or `null` when any of its five fields is missing or
 * mistyped.
 */
function parseKindStatus(entry: unknown): CodeModeKindStatus | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { kind, label, says, enabled, report } = entry as Record<string, unknown>;
  if (
    typeof kind !== 'string' || typeof label !== 'string' || typeof says !== 'string'
    || typeof enabled !== 'boolean' || typeof report !== 'string'
  ) {
    return null;
  }
  return { kind, label, says, enabled, report };
}

/**
 * Narrow one parsed JSON value to `CodeModeState`, or `null` when any field is missing or mistyped, in any
 * kind entry too. A partly-typed answer is not trusted field by field. Each kind is rebuilt from its five
 * fields alone, so an extra key the verb prints never reaches the card.
 */
function parseCodeModeStatus(parsed: unknown): CodeModeState | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { ready, why, kinds } = parsed as Record<string, unknown>;
  if (typeof ready !== 'boolean' || typeof why !== 'string' || !Array.isArray(kinds)) return null;
  const list: CodeModeKindStatus[] = [];
  for (const entry of kinds) {
    const kind = parseKindStatus(entry);
    if (kind === null) return null;
    list.push(kind);
  }
  return { ready, why, kinds: list };
}

/**
 * Read the verb's typed answer, which is its last line, parsed and narrowed. Anything that is not a typed
 * status throws, and the caller decides what the failure means.
 */
function lastStatusLine(stdout: string | Buffer): CodeModeState {
  const line = String(stdout).trim().split('\n').pop() ?? '';
  const state = parseCodeModeStatus(JSON.parse(line));
  if (state === null) throw new Error('code-mode printed no typed status line');
  return state;
}

/**
 * Run the verb with `args` under the timeout and the whole user-facing environment, and answer its typed
 * status line. Any failure rejects, and the callers decide what it means.
 */
async function runVerb(args: string[]): Promise<CodeModeState> {
  const { stdout } = await execFileAsync(CODE_MODE_VERB, args, {
    timeout: VERB_TIMEOUT_MS,
    env: userFacingEnv(),
    cwd: os.homedir(),
  });
  return lastStatusLine(stdout);
}

/**
 * The exit code and stderr of a failed verb run, read off the error object with each field narrowed by type.
 * `code` is a number only when the child exited with one. `stderr` is text whether execFile handed it over
 * as a string or a Buffer.
 */
function verbExit(error: unknown): { code: number | null; stderr: string } {
  if (typeof error !== 'object' || error === null) return { code: null, stderr: '' };
  const { code, stderr } = error as Record<string, unknown>;
  let text = '';
  if (typeof stderr === 'string') text = stderr;
  else if (Buffer.isBuffer(stderr)) text = stderr.toString();
  return { code: typeof code === 'number' ? code : null, stderr: text };
}

/**
 * The Code Mode state for the card, from `code-mode --status`. Never throws and never caches. A failure is
 * logged and answered as `UNASKED`, a fresh copy each time, so it is never read as off or not ready.
 */
export async function getCodeModeState(): Promise<CodeModeState> {
  try {
    return await runVerb(['--status']);
  } catch (error) {
    console.error('code-mode --status failed:', error instanceof Error ? error.message : error);
    return { ...UNASKED };
  }
}

/**
 * Set one kind on or off through `code-mode set`, and answer with the status the verb printed after the
 * write, never with the input, so the position the card draws is the one on disk. A kind the verb does not
 * know is a 400 carrying the verb's own words, and nothing moved. Any other failure is a 502 and is logged
 * with the kind.
 */
export async function setCodeModeState(kindInput: unknown, enabledInput: unknown): Promise<CodeModeState> {
  if (typeof kindInput !== 'string' || kindInput === '' || typeof enabledInput !== 'boolean') {
    throw new AppError('kind must be a non-empty string and enabled a boolean', {
      code: 'INVALID_CODE_MODE_STATE',
      statusCode: 400,
    });
  }
  try {
    // `--` ends the options: a kind spelled like a flag (`--status`) is read by the verb as a kind it does
    // not know, never as an option.
    return await runVerb(['set', '--by', OPERATOR_DOOR, '--', kindInput, enabledInput ? 'on' : 'off']);
  } catch (error) {
    const exit = verbExit(error);
    if (exit.code === UNKNOWN_KIND_EXIT) {
      throw new AppError(exit.stderr.trim() || `unknown Code Mode kind: ${kindInput}`, {
        code: 'UNKNOWN_CODE_MODE_KIND',
        statusCode: 400,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`code-mode set ${kindInput} failed:`, message);
    throw new AppError(`code-mode set ${kindInput} failed: ${message}`, {
      code: 'CODE_MODE_VERB_FAILED',
      statusCode: 502,
    });
  }
}
