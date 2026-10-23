import os from 'node:os';
import path from 'node:path';

import { AppError, expandHome, readFlagWord } from '@/shared/utils.js';

import { writeFlagText } from './deepseek-flash-switch.js';

/**
 * Where the usage pacer stops starting plans on the WEEKLY window, as a file — the operator's line,
 * in whole percent. The 5-hour window has no such setting; its ceiling stays the pacer's own.
 *
 * The pacer reads this exact path at every picture (`hooks/plan_runner/pacer/weekly_stop.py`, read by
 * `project._windows` and `pacer windows`), so a press here reaches the next pass with nothing restarted
 * on either side. It is deliberately not a row in `auth.db`: the pacer runs inside the dispatcher's
 * daemon and in the `pacer` door, which must be able to read the line with no database and no HTTP in
 * the way. The settings row and the transport call under it live in
 * `src/modules/settings/hooks/useWeeklyStop.ts` and `src/shared/api.ts`.
 *
 * The file holds ONE bare integer and a newline, and that is the whole contract between the two
 * languages. `weekly_stop.percent_of` reads ASCII digits and nothing else, from 50 to 99, and answers
 * its DEFAULT (95) for everything it cannot trust: absent, unreadable, empty, past `FLAG_MAX_BYTES`, a
 * sign, a point, a word, a number outside the range. This reader answers the same for the same bytes.
 * Nothing is clamped: 30 is not "50", it is a file nobody wrote on purpose.
 */
const DEFAULT_PATH = path.join(os.homedir(), '.claude', 'state', 'weekly_stop.flag');

/** What an absent or untrustworthy flag reads (`weekly_stop.DEFAULT`): the operator's ruling of 2026-10-22. */
const WEEKLY_STOP_DEFAULT = 95;

/** The bounds of a line anyone chose (`weekly_stop.MIN` / `MAX`), kept identical so both readers agree on what a number is. */
const WEEKLY_STOP_MIN = 50;
const WEEKLY_STOP_MAX = 99;

/** The pacer's own bound on the file (`weekly_stop.MAX_BYTES`), kept identical so a file past it reads the default on both sides. */
const FLAG_MAX_BYTES = 64;

/** What the line is set to: whole percent of the weekly window. */
type WeeklyStop = { percent: number };

/**
 * The file's path, this call: `PACER_WEEKLY_STOP_FLAG_PATH` when it is set, else the default — the
 * pacer's own seam (`weekly_stop.FLAG_ENV`), made absolute as its reader makes it, so a probe that
 * points the seam at a scratch file reaches the next read and a relative override names one file for
 * the pacer and this server alike.
 */
function weeklyStopFlagPath(): string {
  const override = process.env.PACER_WEEKLY_STOP_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return DEFAULT_PATH;
}

/** Is `value` a whole percent the pacer would honour as written? The one grammar the read and the write share. */
function isWeeklyStopPercent(value: number): boolean {
  return Number.isInteger(value) && value >= WEEKLY_STOP_MIN && value <= WEEKLY_STOP_MAX;
}

/**
 * The line, read. The default in every case the file cannot be trusted; an absent file is the default,
 * never a throw.
 */
async function readWeeklyStop(): Promise<WeeklyStop> {
  // `null` is absent, unreadable, not a regular file or past the bound: the default, never an error to the caller.
  const word = await readFlagWord(weeklyStopFlagPath(), FLAG_MAX_BYTES);
  if (word === null || !/^[0-9]+$/.test(word) || word.length >= FLAG_MAX_BYTES) {
    return { percent: WEEKLY_STOP_DEFAULT };
  }
  const percent = Number.parseInt(word, 10);
  return { percent: isWeeklyStopPercent(percent) ? percent : WEEKLY_STOP_DEFAULT };
}

/** Used by `settings.service.ts` (`getWeeklyStop`, behind `GET /weekly-stop`); the body lives here because that file is over its ceiling and takes call-in lines only. */
export async function getWeeklyStopState(): Promise<WeeklyStop> {
  return readWeeklyStop();
}

/**
 * Set the line, and answer with what the file reads back — never with the input, for the reason every
 * switch here does: this is a file another process reads, and the percent the dropdown draws should be
 * the one on disk.
 *
 * REFUSED AT THE DOOR, before anything is written: anything but a whole number from 50 to 99. A float
 * is refused rather than truncated, because silently rounding one is how the row and the file first
 * disagree, and a string rather than coerced. The 400 is the API's usual envelope (`AppError`).
 *
 * Used by `settings.service.ts` (`setWeeklyStop`, behind `PUT /weekly-stop`), which kicks the
 * dispatcher once this has written.
 */
export async function setWeeklyStopState(percentInput: unknown): Promise<WeeklyStop> {
  if (typeof percentInput !== 'number' || !isWeeklyStopPercent(percentInput)) {
    throw new AppError(`percent must be a whole number from ${WEEKLY_STOP_MIN} to ${WEEKLY_STOP_MAX}`, {
      code: 'INVALID_WEEKLY_STOP',
      statusCode: 400,
    });
  }
  await writeFlagText(weeklyStopFlagPath(), `${percentInput}\n`);
  return readWeeklyStop();
}
