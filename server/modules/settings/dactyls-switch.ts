import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { userFacingEnv } from '@/shared/child-env.js';
import { AppError, expandHome } from '@/shared/utils.js';

import { readFlagFile, writeFlagFile } from './deepseek-flash-switch.js';

/**
 * The plan runner's HOST-WIDE Dactyls switch, as a file — the operator's switch for handing Hephaestus's
 * code edits to dactyls (one-file children on the launch table's `[dactyl]` words). His alone: Iris is a
 * builder too and builds by hand, and the runner's gate (`switch.AGENT`) names him by shim.
 *
 * The runner reads this exact path at every Hephaestus launch (`hooks/plan_runner/dactyls/switch.py`,
 * through `plan_runner.state.reads_on` — the DeepSeek switch's own predicate), so a flip takes effect on
 * his next launch with nothing restarted on either side. It is deliberately not a row in `auth.db`: the
 * runner is a separate daemon that must be able to read the switch with no database and no HTTP.
 *
 * THE FILE IS THE OPERATOR'S. CloudCLI writes it through the two routes in `settings.routes.ts` and
 * no soul ever writes one by hand. The switch is drawn in Edit Agent Chains, at the head of the Dactyls
 * field beside the words its children run on; the field and the transport call under it live in
 * `src/modules/agent-launch/AgentLaunchDactylField.tsx`, `src/shared/hooks/useDactylsSwitch.ts` and
 * `src/shared/api.ts`.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS. The position is the file, the operator's word. The
 * readiness is the installed Claude Code's — whether it can serve the `[dactyl]` model — and only
 * `dactyl --status` knows how to derive it (it scans the installed binary at every ask). It is
 * asked of that verb, never re-derived here, so the row cannot say a sentence the runner would not.
 * A switch that is on while the CLI cannot serve a dactyl is armed, not broken: builders work as
 * before until it can.
 *
 * The write and the read are `deepseek-flash-switch.ts`'s own pair — one mechanism, another path.
 */

const execFileAsync = promisify(execFile);

/** Where the file lives, absent any override: the runner's own default (`switch.FLAG`). */
const SWITCH_PATH = path.join(os.homedir(), '.claude', 'state', 'dactyls.flag');

/** The verb whose `--status` answers readiness. Absolute, so the call does not depend on `PATH`. */
const DACTYL_VERB = path.join(os.homedir(), '.claude', 'scripts', 'dactyl');

/**
 * The status call's ceiling. It scans a ~250 MB binary (about 0.1 s) and reads one JSON file, so a call
 * that takes seconds is already wrong; 15 s keeps a wedged one from holding the route open.
 */
const STATUS_TIMEOUT_MS = 15_000;

/**
 * The file's path, this call: `PLAN_RUNNER_DACTYLS_FLAG_PATH` when it is set, else the default above.
 *
 * A FUNCTION rather than a constant, and the override made ABSOLUTE — both exactly as the Python
 * reader honours it (`switch.flag_path`). A switch is read live, so a probe that points the seam at a
 * scratch file must reach the next read; and the runner runs from a different working directory than
 * this server, so a relative override left unresolved would name two files from one variable.
 */
function dactylsSwitchPath(): string {
  const override = process.env.PLAN_RUNNER_DACTYLS_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return SWITCH_PATH;
}

/** The switch, read. OFF when the file is absent, oversized, or holds anything but the one word. */
async function readDactylsSwitch(): Promise<boolean> {
  return readFlagFile(dactylsSwitchPath());
}

/** The four facts `dactyl --status` answers beside the position. Each is `null` when it could not ask. */
type DactylsStatus = {
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
};

/** What a failed status call answers with: all four unknown, which is neither off nor not ready. */
const STATUS_UNKNOWN: DactylsStatus = { model: null, effort: null, ready: null, why: null };

/**
 * Ask the verb for the model, the effort and the readiness the next dactyl would be launched with.
 *
 * `dactyl --status` prints ONE JSON line — `{"switch", "model", "effort", "ready", "why", "cli"}` —
 * and exits 0. The environment is `userFacingEnv()` WHOLE, on purpose: it carries
 * `LAUNCH_TABLE_PATH`, `PLAN_RUNNER_CLAUDE_BIN` and the flag seam, so a probe server pointed at scratch
 * copies gets a status derived from those same copies.
 *
 * A call that fails in any way — no verb, a timeout, a non-zero exit, a line that is not JSON, a field
 * of the wrong type — answers all four `null`. A partly-typed answer is not trusted field by field:
 * "could not ask" is the one honest reading of a status that cannot be read whole, and it must never
 * degrade into `ready: false` (a Waiting line for a reason nobody gave) or into off.
 */
async function dactylsStatus(): Promise<DactylsStatus> {
  try {
    const { stdout } = await execFileAsync(DACTYL_VERB, ['--status'], {
      timeout: STATUS_TIMEOUT_MS,
      env: userFacingEnv(),
      cwd: os.homedir(),
    });
    const line = String(stdout).trim().split('\n').pop() ?? '';
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('status is not an object');
    const { model, effort, ready, why } = parsed as Record<string, unknown>;
    if (
      typeof model !== 'string' || typeof effort !== 'string'
      || typeof ready !== 'boolean' || typeof why !== 'string'
    ) {
      throw new Error('status lacks a typed model, effort, ready or why');
    }
    return { model, effort, ready, why };
  } catch (error) {
    // Logged with its cause: the row says only "could not be read", and this line is what says why.
    console.error('dactyl --status failed:', error instanceof Error ? error.message : error);
    return STATUS_UNKNOWN;
  }
}

/**
 * The switch in the shape the two routes answer with — `settings.service.ts`'s `getDactyls` /
 * `setDactyls` delegate to these verbatim, because that file is over its ceiling and takes call-in
 * lines only. `enabled` is the file's position; the four details are `dactylsStatus()`'s.
 */
export async function getDactylsState(): Promise<{
  enabled: boolean;
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
}> {
  const [enabled, status] = await Promise.all([readDactylsSwitch(), dactylsStatus()]);
  return { enabled, ...status };
}

/**
 * Set the switch, and answer with what the file reads back — never with the input.
 *
 * The read-back is the point, as it is for the DeepSeek switch: this is a file another daemon reads,
 * and the position the toggle renders should be the one on disk. A non-boolean is a 400 rather than a
 * coercion, because the only two things this route can say are on and off. Nothing queues on this
 * switch, so there is no dispatcher kick: a flip is read by the next builder launched.
 */
export async function setDactylsState(enabledInput: unknown): ReturnType<typeof getDactylsState> {
  if (typeof enabledInput !== 'boolean') {
    throw new AppError('enabled must be a boolean', {
      code: 'INVALID_DACTYLS_STATE',
      statusCode: 400,
    });
  }
  await writeFlagFile(dactylsSwitchPath(), enabledInput);
  return getDactylsState();
}
