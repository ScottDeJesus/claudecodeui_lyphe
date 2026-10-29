import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { sessionlessEnv } from '@/shared/child-env.js';
import { relayRecord } from '@/shared/relay-record.js';
import type { RelayAnswer, ResumeRunOrder } from '@/shared/relayed-press-types.js';
import { expandHome } from '@/shared/utils.js';

/**
 * A run resumed with his rulings, on his spoken word — the one door a chain's resume goes through from this server, and the owner
 * of runs here is dispatch-souls.
 *
 * `plan-runner chain --resume <chain id> --rulings <file> --relay <record>` is the runner's own door (kaylee--press): the file
 * holds his rulings verbatim (the companion wrote it to her scratch; this file only passes the path on), the record is his press
 * with the chain id as its target, and the runner keeps the record in the chain's own `chain.json` before it forks the walker.
 * The runner decides what a resume means and prints its own refusal (a chain that is still running, a `done` one, a malformed
 * record); its first line comes back untouched as `said`. Nothing here throws, and exit 0 is the only `took`.
 *
 * The command runs under the lane's environment rule (`sessionlessEnv`): no `CLAUDE_CODE_SESSION_ID` and no `DISPATCHER_SESSION`,
 * because the runner's door refuses Kaylee's relay inside a Claude session — only this server and his own terminal may write
 * "the operator said". The argv is the whole command; no shell parses it, and a chain id or rulings path of a shape the runner
 * would read as a path or an option is refused before the spawn. The record carries no `token` — the door takes one on an Accept alone.
 */

/** The plan-runner's entry point, unless the operator moved it (`PLAN_RUNNER_BIN`, the seam a probe points at a stand-in). */
const DEFAULT_PLAN_RUNNER_BIN = '~/.claude/scripts/plan-runner';

/**
 * Wall-clock ceiling for the resume. The runner forks its walker and returns after one printed line — seconds, not minutes —
 * so a command still out at this bound is wedged, and the order is `refused` rather than awaited.
 */
const RESUME_TIMEOUT_MS = 30_000;

/** Plenty for the runner's one line; a traceback's tail is cut by the same cap `firstLine` applies. */
const OUTPUT_MAX_BUFFER = 1024 * 1024;

/** How much of the runner's own line a refusal carries: one line names the cause. */
const SAID_LINE_CHARS = 200;

/**
 * A chain id as the launcher writes it: letters, digits, dashes and underscores (`state_lock.SAFE_ID_RE`), a letter or digit first. The runner joins
 * the id onto its record root without a check of its own, so `../../x` would read another folder's `chain.json`, and a leading dash
 * is an option (`-h` prints its usage and exits 0, which would read as `took`). The door holds the shape, so a bad id never spawns.
 */
const CHAIN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The rulings file the companion wrote: an absolute path (so it cannot be read as an option), with no NUL (which `execFile` throws on). */
function isRulingsPath(value: string): boolean {
  return path.isAbsolute(value) && !value.includes('\0');
}

/** A child stream as a string. `execFile` answers `string` here, but a Buffer would render as "[object Object]". */
function readStream(value: unknown): string {
  return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/** The first non-blank line of a child's output, trimmed and capped. */
function firstLineOf(value: string): string {
  const line = value.split('\n').map((entry) => entry.trim()).find((entry) => entry.length > 0) ?? '';
  return line.slice(0, SAID_LINE_CHARS);
}

// Used by `dispatch-souls.module.ts`, which hands it to the server entrypoint as `resumeRun` — the companion's house
// calls it from her `take_action` for a `resume_run`.
export function resumeChainOnHisWord(
  order: ResumeRunOrder,
  say: (message: string) => void,
): Promise<RelayAnswer> {
  if (!CHAIN_ID.test(order.chainId) || !isRulingsPath(order.rulingsFile)) {
    say("[DispatchSouls] Kaylee's resume on his word named no chain id or rulings file the runner could take — nothing was run");
    return Promise.resolve({ outcome: 'refused', said: 'that is not a chain id with a rulings file; name the run again' });
  }
  const bin = expandHome(process.env.PLAN_RUNNER_BIN || DEFAULT_PLAN_RUNNER_BIN);
  const args = ['chain', '--resume', order.chainId, '--rulings', order.rulingsFile, '--relay', relayRecord({ ...order.press, token: null }, order.chainId)];
  return new Promise((resolve) => {
    execFile(bin, args, {
      timeout: RESUME_TIMEOUT_MS,
      maxBuffer: OUTPUT_MAX_BUFFER,
      env: sessionlessEnv(),
      cwd: os.homedir(),
    }, (error, stdout, stderr) => {
      const code = (error as { code?: unknown } | null)?.code;
      const exit = error === null ? 0 : typeof code === 'number' && Number.isFinite(code) ? code : null;
      // A runner that never exited (killed at its bound, or never started) has no line of its own: Node's `Command failed: <bin> <argv>`
      // would carry the record — his account and his words — so the lane's sentence stands in, in the journal and in `said`. And it
      // does not claim the resume failed: the runner forks its walker and returns, so one killed at its bound may have resumed the run.
      const line = exit === null
        ? `the plan-runner did not answer within ${RESUME_TIMEOUT_MS / 1000} s or could not be started; the run may have resumed, so read its status before asking again`
        : firstLineOf(readStream(stdout)) || firstLineOf(readStream(stderr));
      // The record is named, not copied: his words are in the chain's own record, and the journal stays one line.
      say(`[DispatchSouls] ${order.chainId}: Kaylee's resume on his word ran \`plan-runner chain --resume ${order.chainId} --rulings <file> --relay <record>\` → exit ${exit ?? 'none'}: ${line || '(nothing)'}`);
      if (exit === 0) {
        resolve({ outcome: 'took', said: line });
        return;
      }
      resolve({ outcome: 'refused', said: line || `the plan-runner exited ${exit} and said nothing` });
    });
  });
}
