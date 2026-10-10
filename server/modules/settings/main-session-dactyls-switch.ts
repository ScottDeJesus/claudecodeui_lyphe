import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { userFacingEnv } from '@/shared/child-env.js';
import { AppError, expandHome } from '@/shared/utils.js';

import { readFlagFile, writeFlagFile } from './deepseek-flash-switch.js';

/**
 * The HOST-WIDE Dactyls-for-the-main-session switch, as a file — the operator's switch for having a main
 * session (a chat here or a terminal session) change a repository file only through a dactyl, and hand a
 * file to one to read. It is not the Dactyls switch (`dactyls-switch.ts`): that one takes a builder's hands,
 * and this one takes a session's.
 *
 * The house reads this exact path itself — `plan_runner/dactyls/main_session.py`, through
 * `plan_runner.state.reads_on` — at each session's SessionStart and UserPromptSubmit (the hook that tells
 * a session its dactyls are on) and in the session rails' gate. A flip therefore reaches each session at its
 * next message with nothing restarted on either side. Nothing queues on this switch, so a flip kicks no
 * dispatcher.
 *
 * THE FILE IS THE OPERATOR'S. CloudCLI writes it through the two routes in `settings.routes.ts`; no soul
 * writes it by hand. The row and the transport under it live in `RunnerMainSessionDactylsRow.tsx`,
 * `src/shared/hooks/useMainSessionDactylsSwitch.ts` and `src/shared/api.ts`.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS. The position is the file. The readiness is the installed
 * Claude Code's — whether it can serve the dactyl's model — and only `dactyl --session-status` derives it;
 * it is asked of that verb, never re-derived here (INV-5703: CloudCLI parses no launch table). The same
 * line carries the week's hand ledger, which the row says beside the switch.
 *
 * The write and the read are `deepseek-flash-switch.ts`'s own pair — one mechanism, another path.
 */

const execFileAsync = promisify(execFile);

/** Where the file lives, absent any override: the house's own default (`main_session.FLAG`). */
const SWITCH_PATH = path.join(os.homedir(), '.claude', 'state', 'main_session_dactyls.flag');

/** The verb whose `--session-status` answers the words, the readiness and the ledger. Absolute, so `PATH` is not consulted. */
const DACTYL_VERB = path.join(os.homedir(), '.claude', 'scripts', 'dactyl');

/** The status call's ceiling: it scans the installed binary and folds a week's ledger, so seconds is already wrong. */
const STATUS_TIMEOUT_MS = 15_000;

/**
 * The dactyls launched by hand (under no plan's launch) over the last `days` days — the verb's
 * `place.hand_fold`, less the token counts the row does not draw. `spend` is the verb's own rendering
 * (`212.4k in · 9.8k out`), "" when no token was counted; tokens, never dollars.
 */
type HandFold = { days: number; count: number; reads: number; edits: number; spend: string };

/** What `dactyl --session-status` says that this row draws; `cli` and `switch` are the status's, not the row's. */
type SessionDactylsStatus = {
  model: string;
  effort: string;
  ready: boolean;
  why: string;
  hand: HandFold;
};

/**
 * The file's path, this call: `MAIN_SESSION_DACTYLS_FLAG_PATH` when set, else the default above.
 *
 * A FUNCTION, with the override made ABSOLUTE, exactly as the house's reader makes it
 * (`main_session.flag_path`): a switch is read live, so a probe that points the seam at a scratch file must
 * reach the next read, and a relative override must not name two files from two working directories.
 */
function mainSessionDactylsSwitchPath(): string {
  const override = process.env.MAIN_SESSION_DACTYLS_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return SWITCH_PATH;
}

/** A count the ledger can hold: a whole number, never negative. `Number.isInteger` is false for any non-number. */
function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * Narrow one parsed JSON value to `SessionDactylsStatus`, or `null` when any field is missing or mistyped —
 * `hand` included. A partly-typed answer is not trusted field by field: "could not ask" is the one honest
 * reading of a status that cannot be read whole.
 */
function parseSessionDactylsStatus(parsed: unknown): SessionDactylsStatus | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { model, effort, ready, why, hand } = parsed as Record<string, unknown>;
  if (typeof hand !== 'object' || hand === null) return null;
  const { days, count, reads, edits, spend } = hand as Record<string, unknown>;
  if (
    typeof model !== 'string' || typeof effort !== 'string'
    || typeof ready !== 'boolean' || typeof why !== 'string'
    || !isCount(days) || !isCount(count) || !isCount(reads) || !isCount(edits)
    || typeof spend !== 'string'
  ) {
    return null;
  }
  return { model, effort, ready, why, hand: { days, count, reads, edits, spend } };
}

/**
 * Ask the verb for the dactyl's model, effort, readiness and the week's ledger; `null` on any failure.
 *
 * `dactyl --session-status` prints ONE JSON line and exits 0. The environment is `userFacingEnv()` WHOLE,
 * on purpose: it carries `LAUNCH_TABLE_PATH`, `PLAN_RUNNER_CLAUDE_BIN`, `DISPATCHER_HOME` and the flag
 * seam, so a probe server pointed at scratch copies gets a status derived from those same copies. A
 * failure is never cached and never read as "not ready": no script, a timeout, a non-zero exit, a line that
 * is not JSON, or a line that is not the shape all answer `null`, logged with the cause.
 */
async function sessionDactylsStatus(): Promise<SessionDactylsStatus | null> {
  try {
    const { stdout } = await execFileAsync(DACTYL_VERB, ['--session-status'], {
      timeout: STATUS_TIMEOUT_MS,
      env: userFacingEnv(),
      cwd: os.homedir(),
    });
    const line = String(stdout).trim().split('\n').pop() ?? '';
    const status = parseSessionDactylsStatus(JSON.parse(line));
    if (status === null) throw new Error('status lacks a typed model, effort, ready, why or hand');
    return status;
  } catch (error) {
    console.error('dactyl --session-status failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** The shape both routes answer with: the file's position, and the five details (`null` = could not ask). */
type MainSessionDactylsState = {
  enabled: boolean;
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
  hand: HandFold | null;
};

/**
 * The switch in the shape the two routes answer with — `settings.service.ts`'s `getMainSessionDactyls` and
 * `setMainSessionDactyls` delegate to these verbatim, because that file is over its ceiling and takes
 * call-in lines only. `enabled` is the file's position; the five details are the status's.
 */
export async function getMainSessionDactylsState(): Promise<MainSessionDactylsState> {
  const [enabled, status] = await Promise.all([
    readFlagFile(mainSessionDactylsSwitchPath()),
    sessionDactylsStatus(),
  ]);
  return {
    enabled,
    model: status?.model ?? null,
    effort: status?.effort ?? null,
    ready: status?.ready ?? null,
    why: status?.why ?? null,
    hand: status?.hand ?? null,
  };
}

/**
 * Set the switch, and answer with what the file reads back — never with the input, because the position the
 * toggle draws should be the one on disk. A non-boolean is a 400 rather than a coercion: the only two things
 * this route can say are on and off. Nothing is written before the check, and nothing kicks the dispatcher.
 */
export async function setMainSessionDactylsState(enabledInput: unknown): Promise<MainSessionDactylsState> {
  if (typeof enabledInput !== 'boolean') {
    throw new AppError('enabled must be a boolean', {
      code: 'INVALID_MAIN_SESSION_DACTYLS_STATE',
      statusCode: 400,
    });
  }
  await writeFlagFile(mainSessionDactylsSwitchPath(), enabledInput);
  return getMainSessionDactylsState();
}
