import os from 'node:os';
import path from 'node:path';

import { AppError, expandHome, readFlagWord } from '@/shared/utils.js';

import { writeFlagText } from './deepseek-flash-switch.js';

/**
 * How full the box's CPU may be before a NEW agent waits, as a file — the operator's line, in whole percent of the box's
 * cores, or the word `off`.
 *
 * Every agent the runner starts asks this exact path just before it spawns (`hooks/plan_runner/pacer/cpu_limit.py`, read by
 * `cpu_wait.wait_for_room`), so a press here reaches the next agent — and any already waiting, at its next check — with nothing
 * restarted on either side. It is deliberately not a row in `auth.db`: the gate runs inside the runner's own detached wrappers, which
 * must be able to read the line with no database and no HTTP in the way. The settings row and the transport call under it live in
 * `src/modules/settings/hooks/useCpuLimit.ts` and `src/shared/api.ts`.
 *
 * The file holds ONE bare integer or the word `off`, and a newline, and that is the whole contract between the two languages.
 * `cpu_limit.read` reads ASCII digits and nothing else, from 1 to 100, and answers its DEFAULT (100: every core busy) for everything it
 * cannot trust — absent, unreadable, empty, past `FLAG_MAX_BYTES`, a sign, a point, a word that is not `off`, a number outside the
 * range. THE ONE THING THAT TURNS THE CHECK OFF IS THE WORD `off`: a file nobody wrote on purpose never does. This reader answers the same
 * for the same bytes.
 */
const DEFAULT_PATH = path.join(os.homedir(), '.claude', 'state', 'cpu_limit.flag');

/** What an absent or untrustworthy flag reads (`cpu_limit.DEFAULT`): all the cores busy (the operator, 2026-11-11). */
const CPU_LIMIT_DEFAULT = 100;

/** The bounds of a line anyone chose (`cpu_limit.MIN` / `MAX`), kept identical so both readers agree on what a number is. */
const CPU_LIMIT_MIN = 1;
const CPU_LIMIT_MAX = 100;

/** The word that turns the check off (`cpu_limit.OFF_WORD`). */
const OFF_WORD = 'off';

/** The gate's own bound on the file (`cpu_limit.MAX_BYTES`), kept identical so a file past it reads the default on both sides. */
const FLAG_MAX_BYTES = 64;

/**
 * What the line is set to: whole percent of the box's cores, or `null` when the operator turned the check Off. `cores` rides the
 * answer so the row can say what a percent comes to on THIS box (`os.cpus().length`, the count the gate takes from `os.cpu_count()`).
 */
type CpuLimit = { percent: number | null; cores: number };

/**
 * The file's path, this call: `PACER_CPU_LIMIT_FLAG_PATH` when it is set, else the default — the gate's own seam
 * (`cpu_limit.FLAG_ENV`), made absolute as its reader makes it, so a probe that points the seam at a scratch file reaches the next read.
 */
function cpuLimitFlagPath(): string {
  const override = process.env.PACER_CPU_LIMIT_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return DEFAULT_PATH;
}

/** Is `value` a whole percent the gate would honour as written? The one grammar the read and the write share. */
function isCpuLimitPercent(value: number): boolean {
  return Number.isInteger(value) && value >= CPU_LIMIT_MIN && value <= CPU_LIMIT_MAX;
}

/**
 * The line, read. The default in every case the file cannot be trusted; an absent file is the default, never a throw — and never Off.
 */
async function readCpuLimit(): Promise<CpuLimit> {
  const cores = os.cpus().length;
  // `null` is absent, unreadable, not a regular file or past the bound: the default, never an error to the caller.
  const word = await readFlagWord(cpuLimitFlagPath(), FLAG_MAX_BYTES);
  if (word === OFF_WORD) return { percent: null, cores };
  if (word === null || !/^[0-9]+$/.test(word) || word.length >= FLAG_MAX_BYTES) {
    return { percent: CPU_LIMIT_DEFAULT, cores };
  }
  const percent = Number.parseInt(word, 10);
  return { percent: isCpuLimitPercent(percent) ? percent : CPU_LIMIT_DEFAULT, cores };
}

/** Used by `settings.service.ts` (`getCpuLimit`, behind `GET /cpu-limit`); the body lives here because that file is over its ceiling and takes call-in lines only. */
export async function getCpuLimitState(): Promise<CpuLimit> {
  return readCpuLimit();
}

/**
 * Set the line, and answer with what the file reads back — never with the input, for the reason every switch here does: this is a
 * file another process reads, and the percent the dropdown draws should be the one on disk.
 *
 * REFUSED AT THE DOOR, before anything is written: anything but a whole number from 1 to 100, or `null` (Off). A float is refused
 * rather than truncated, because silently rounding one is how the row and the file first disagree, and a string rather than coerced.
 * The 400 is the API's usual envelope (`AppError`).
 *
 * Used by `settings.service.ts` (`setCpuLimit`, behind `PUT /cpu-limit`). No dispatcher kick rides on it: nothing is held in the
 * dispatcher for the CPU — an agent already waiting re-reads this file at its next check.
 */
export async function setCpuLimitState(percentInput: unknown): Promise<CpuLimit> {
  if (percentInput !== null && (typeof percentInput !== 'number' || !isCpuLimitPercent(percentInput))) {
    throw new AppError(`percent must be a whole number from ${CPU_LIMIT_MIN} to ${CPU_LIMIT_MAX}, or null for off`, {
      code: 'INVALID_CPU_LIMIT',
      statusCode: 400,
    });
  }
  await writeFlagText(cpuLimitFlagPath(), `${percentInput === null ? OFF_WORD : percentInput}\n`);
  return readCpuLimit();
}
