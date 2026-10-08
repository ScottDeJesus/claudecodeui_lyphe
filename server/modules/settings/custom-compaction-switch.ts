import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { userFacingEnv } from '@/shared/child-env.js';
import type { SummarizerStatus } from '@/shared/types.js';
import { AppError, expandHome } from '@/shared/utils.js';

import { readFlagFile, writeFlagFile } from './deepseek-flash-switch.js';

/**
 * The HOST-WIDE Custom compaction switch, as a file — the operator's switch for having a CloudCLI
 * chat's compaction written by the summarizer (`launch.toml`'s `[summarizer]` words) instead of by
 * the CLI's own compaction. Off or absent, the CLI compacts as it always did.
 *
 * `modules/compaction` reads this exact file at every message (`readCustomCompactionSwitch`, through
 * the settings barrel), so a flip reaches each chat at its next message with nothing restarted.
 * Nothing queues on this switch, so a flip kicks no dispatcher.
 *
 * THE FILE IS THE OPERATOR'S. CloudCLI writes it through the two routes in `settings.routes.ts`; no
 * soul writes it by hand. The row and the transport under it live in `RunnerCompactionRow.tsx`,
 * `src/shared/hooks/useCustomCompactionSwitch.ts` and `src/shared/api.ts`.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS. The position is the file. The readiness is the
 * installed Claude Code's — whether it can serve the summarizer's model — and only
 * `summarize --status` derives it; it is asked of that verb, never re-derived here (INV-5703:
 * CloudCLI parses no launch table).
 *
 * The write and the read are `deepseek-flash-switch.ts`'s own pair — one mechanism, another path.
 */

const execFileAsync = promisify(execFile);

/** Where the file lives, absent any override. */
const SWITCH_PATH = path.join(os.homedir(), '.claude', 'state', 'custom_compaction.flag');

/** The verb whose `--status` answers the words and the readiness. Absolute, so `PATH` is not consulted. */
const SUMMARIZE_VERB = path.join(os.homedir(), '.claude', 'scripts', 'summarize');

/** The status call's ceiling: it scans the installed binary and reads one file, so seconds is already wrong. */
const STATUS_TIMEOUT_MS = 15_000;

/**
 * The file's path, this call: `CUSTOM_COMPACTION_FLAG_PATH` when set, else the default above.
 *
 * A FUNCTION, with the override made ABSOLUTE, as `park-at-peak-switch.ts` does it: a switch is read
 * live, so a probe that points the seam at a scratch file must reach the next read, and a relative
 * override must not name two files from two working directories.
 */
function customCompactionSwitchPath(): string {
  const override = process.env.CUSTOM_COMPACTION_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return SWITCH_PATH;
}

/** The switch, read. OFF when the file is absent, oversized, or holds anything but the one word. */
export async function readCustomCompactionSwitch(): Promise<boolean> {
  return readFlagFile(customCompactionSwitchPath());
}

/** The switch, written. One caller: `setCustomCompactionState`, behind `PUT /custom-compaction`. */
async function writeCustomCompactionSwitch(enabled: boolean): Promise<void> {
  return writeFlagFile(customCompactionSwitchPath(), enabled);
}

/** Is `value` a finite number? `typeof` alone admits `NaN`, which JSON cannot carry but a typo can. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Narrow one parsed JSON value to `SummarizerStatus`, or `null` when any field is missing or mistyped.
 * A partly-typed answer is not trusted field by field: "could not ask" is the one honest reading of a
 * status that cannot be read whole.
 */
function parseSummarizerStatus(parsed: unknown): SummarizerStatus | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { model, effort, ready, why, cli } = parsed as Record<string, unknown>;
  if (typeof cli !== 'object' || cli === null) return null;
  const { path: cliPath, size, mtime_ns: mtimeNs, version } = cli as Record<string, unknown>;
  if (
    typeof model !== 'string' || typeof effort !== 'string'
    || typeof ready !== 'boolean' || typeof why !== 'string'
    || typeof cliPath !== 'string' || !isFiniteNumber(size)
    || !isFiniteNumber(mtimeNs) || typeof version !== 'string'
  ) {
    return null;
  }
  return { model, effort, ready, why, cli: { path: cliPath, size, mtime_ns: mtimeNs, version } };
}

/**
 * Ask the verb for the summarizer's model, effort and readiness; `null` on any failure.
 *
 * `summarize --status` prints ONE JSON line and exits 0. The environment is `userFacingEnv()` WHOLE,
 * on purpose: it carries `LAUNCH_TABLE_PATH` and `PLAN_RUNNER_CLAUDE_BIN`, so a probe server pointed
 * at scratch copies gets a status derived from those same copies. A failure is never cached by the
 * caller and never read as "not ready": no script, a timeout, a non-zero exit, a line that is not
 * JSON, or a line that is not the shape all answer `null`, logged with the cause.
 *
 * Consumers: `getCustomCompactionState` below (the row), and `modules/compaction`'s mode, through the
 * settings barrel.
 */
export async function summarizerStatus(): Promise<SummarizerStatus | null> {
  try {
    const { stdout } = await execFileAsync(SUMMARIZE_VERB, ['--status'], {
      timeout: STATUS_TIMEOUT_MS,
      env: userFacingEnv(),
      cwd: os.homedir(),
    });
    const line = String(stdout).trim().split('\n').pop() ?? '';
    const status = parseSummarizerStatus(JSON.parse(line));
    if (status === null) throw new Error('status lacks a typed model, effort, ready, why or cli');
    return status;
  } catch (error) {
    console.error('summarize --status failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** The shape both routes answer with: the file's position, and the four details (`null` = could not ask). */
type CustomCompactionState = {
  enabled: boolean;
  model: string | null;
  effort: string | null;
  ready: boolean | null;
  why: string | null;
};

/**
 * The switch in the shape the two routes answer with — `settings.service.ts`'s `getCustomCompaction`
 * and `setCustomCompaction` delegate to these verbatim, because that file is over its ceiling and
 * takes call-in lines only. `enabled` is the file's position; the four details are the status's.
 */
export async function getCustomCompactionState(): Promise<CustomCompactionState> {
  const [enabled, status] = await Promise.all([readCustomCompactionSwitch(), summarizerStatus()]);
  return {
    enabled,
    model: status?.model ?? null,
    effort: status?.effort ?? null,
    ready: status?.ready ?? null,
    why: status?.why ?? null,
  };
}

/**
 * Set the switch, and answer with what the file reads back — never with the input, because the
 * position the toggle draws should be the one on disk. A non-boolean is a 400 rather than a coercion:
 * the only two things this route can say are on and off.
 */
export async function setCustomCompactionState(enabledInput: unknown): Promise<CustomCompactionState> {
  if (typeof enabledInput !== 'boolean') {
    throw new AppError('enabled must be a boolean', {
      code: 'INVALID_CUSTOM_COMPACTION_STATE',
      statusCode: 400,
    });
  }
  await writeCustomCompactionSwitch(enabledInput);
  return getCustomCompactionState();
}
