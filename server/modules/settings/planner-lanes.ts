import { stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AppError, expandHome } from '@/shared/utils.js';

import { writeFlagText } from './deepseek-flash-switch.js';

/**
 * The dispatcher's HOST-WIDE planner-lane dial, as a file — how many planners (designs, cuts,
 * judgments) may be out at once.
 *
 * The dispatcher reads this exact path at every planner take-up (`hooks/dispatcher/planner_lanes.py`,
 * `planner_rule.room`), so a press here reaches the next pass with nothing restarted on either side.
 * It is deliberately not a row in `auth.db`: the dispatcher is a separate daemon that must be able to
 * read the dial with no database and no HTTP in the way. The settings row and the transport call
 * under it live in `src/modules/settings/hooks/usePlannerLanes.ts` and `src/shared/api.ts`.
 *
 * The file holds ONE bare integer and a newline, and that is the whole contract between the two
 * languages. `planner_lanes.parse` reads ASCII digits and nothing else, at least 1, and answers its
 * DEFAULT (2) for everything it cannot trust: absent, unreadable, empty, past `FLAG_MAX_BYTES`, a sign,
 * a point, a word, zero. This reader answers the same for the same bytes. The floor is not a clamp —
 * a file that says 0 is a file the dispatcher ignores, and so is one this server would never write.
 *
 * Nothing clamps ABOVE: a width is the number the operator chose, written exactly as given and read
 * back exactly as written.
 */
const DEFAULT_PATH = path.join(os.homedir(), '.claude', 'state', 'planners.flag');

/** What an absent or untrustworthy flag reads (`planner_lanes.DEFAULT`): two planners at a time. */
const PLANNER_LANES_DEFAULT = 2;

/** The floor (`planner_lanes.MIN`): a lane of zero takes nothing up, which is a pause and not a width. */
const PLANNER_LANES_MIN = 1;

/** The dispatcher's own bound on the file (`planner_lanes.MAX_BYTES`), kept identical so a file past it reads the default on both sides. */
const FLAG_MAX_BYTES = 64;

/**
 * The trim `String.trim()` does not do, added so this reader and Python's `str.strip()` agree — the
 * same class `swarm-switch.ts` uses, for the same reason: the C0 separators `\x1c`–`\x1f` and NEL are
 * whitespace to Python and not to JavaScript, and `\s` already covers the BOM the dispatcher reads
 * through `utf-8-sig`.
 */
const FLAG_TRIM = /^[\s\x1c-\x1f\u0085]+|[\s\x1c-\x1f\u0085]+$/g;

/** What the dial is set to. */
type PlannerLanes = { lanes: number };

/**
 * The file's path, this call: `DISPATCHER_PLANNERS_FLAG_PATH` when it is set, else the default — the
 * dispatcher's own seam (`planner_lanes.FLAG_ENV`), made absolute as its reader makes it, so a probe
 * that points the seam at a scratch file reaches the next read and a relative override names one file
 * for the daemon and this server alike.
 */
function plannersFlagPath(): string {
  const override = process.env.DISPATCHER_PLANNERS_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return DEFAULT_PATH;
}

/**
 * The dial, read. The default in every case the file cannot be trusted; an absent file is the default,
 * never a throw. A run of digits past `Number.isSafeInteger` is a width the dispatcher honours as a
 * Python int and this double cannot hold: it reads as the largest safe integer, which is the same
 * thing for any lane that will ever exist, and not as the default that would draw a narrow lane for a
 * wide one.
 */
async function readPlannerLanes(): Promise<PlannerLanes> {
  const filePath = plannersFlagPath();
  try {
    if ((await stat(filePath)).size > FLAG_MAX_BYTES) return { lanes: PLANNER_LANES_DEFAULT };
    const word = (await readFile(filePath, 'utf8')).replace(FLAG_TRIM, '');
    if (!/^[0-9]+$/.test(word)) return { lanes: PLANNER_LANES_DEFAULT };
    const lanes = Number.parseInt(word, 10);
    if (lanes < PLANNER_LANES_MIN) return { lanes: PLANNER_LANES_DEFAULT };
    return { lanes: Number.isSafeInteger(lanes) ? lanes : Number.MAX_SAFE_INTEGER };
  } catch {
    return { lanes: PLANNER_LANES_DEFAULT };   // absent or unreadable reads the default, never an error to the caller
  }
}

/** Used by `settings.service.ts` (`getPlannerLanes`, behind `GET /planner-lanes`); the body lives here because that file is over its ceiling and takes call-in lines only. */
export async function getPlannerLanesState(): Promise<PlannerLanes> {
  return readPlannerLanes();
}

/**
 * Set the dial, and answer with what the file reads back — never with the input, for the reason every
 * switch here does: this is a file another daemon reads, and the number the stepper draws should be the
 * one on disk.
 *
 * REFUSED AT THE DOOR, before anything is written: anything but a whole number of at least 1, and a
 * number past `Number.isSafeInteger` — the line where this server's double and the dispatcher's
 * arbitrary-precision int stop agreeing, and `1e21` would be written as `1e+21`, a token neither
 * reader accepts. A float is refused with them: silently truncating one is how the row and the file
 * first disagree. The 400 is the API's usual envelope (`AppError`).
 *
 * Used by `settings.service.ts` (`setPlannerLanes`, behind `PUT /planner-lanes`), which kicks the
 * dispatcher once this has written.
 */
export async function setPlannerLanesState(lanesInput: unknown): Promise<PlannerLanes> {
  if (typeof lanesInput !== 'number' || !Number.isSafeInteger(lanesInput) || lanesInput < PLANNER_LANES_MIN) {
    throw new AppError(`lanes must be a whole number of at least ${PLANNER_LANES_MIN}`, {
      code: 'INVALID_PLANNER_LANES',
      statusCode: 400,
    });
  }
  await writeFlagText(plannersFlagPath(), `${lanesInput}\n`);
  return readPlannerLanes();
}
