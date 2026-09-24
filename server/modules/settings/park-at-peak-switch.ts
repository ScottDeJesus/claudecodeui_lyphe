import os from 'node:os';
import path from 'node:path';

import { AppError, expandHome } from '@/shared/utils.js';

import { readFlagFile, writeFlagFile } from './deepseek-flash-switch.js';

/**
 * The dispatcher's HOST-WIDE park-at-peak switch, as a file — the operator's fourth switch file,
 * beside the DeepSeek, swarm and execute-runner flags.
 *
 * The dispatcher reads this exact path at both Accept doors (`hooks/dispatcher/schedule.py`, through
 * `plan_runner.state.reads_on` — the DeepSeek switch's own predicate, so the family cannot drift in
 * what it calls on): on, an Accept during DeepSeek's peak window queues the plan and arms systemd to
 * start it when the window lifts; off, or on the Claude route where the peak has no price, Accept
 * walks now. It is deliberately not a row in `auth.db`: the dispatcher is a separate daemon that
 * must be able to read the switch with no database and no HTTP in the way.
 *
 * THE FILE IS THE OPERATOR'S. CloudCLI writes it through the two routes in `settings.routes.ts` and
 * no soul ever writes one by hand — a flip is a press, and this process is the hand that turns it
 * into the one line. The settings row and the transport call under it live in
 * `src/shared/hooks/useParkAtPeakSwitch.ts` and `src/shared/api.ts`.
 *
 * The write and the read are `deepseek-flash-switch.ts`'s own pair — one mechanism, a third path —
 * so a fix to the scratch-file-and-rename dance can never land on two of the three files and miss
 * this one.
 */

/** Where the file lives, absent any override: the dispatcher's own default (`schedule.PEAK_FLAG`). */
const SWITCH_PATH = path.join(os.homedir(), '.claude', 'state', 'park_at_peak.flag');

/**
 * The file's path, this call: `DISPATCHER_PEAK_FLAG_PATH` when it is set, else the default above.
 *
 * A FUNCTION rather than a constant, and the override made ABSOLUTE — both exactly as the Python
 * reader honours it (`schedule.peak_flag_path`, which is `os.path.abspath(os.path.expanduser(...))`
 * on the same name). A switch is read live, so a probe that points the seam at a scratch file must
 * reach the next read; and the daemon runs from a different working directory than this server, so a
 * relative override left unresolved would name two different files from one variable.
 */
function peakSwitchPath(): string {
  const override = process.env.DISPATCHER_PEAK_FLAG_PATH;
  if (override) return path.resolve(expandHome(override));
  return SWITCH_PATH;
}

/** The switch, read. OFF when the file is absent, oversized, or holds anything but the one word. */
export async function readParkAtPeakSwitch(): Promise<boolean> {
  return readFlagFile(peakSwitchPath());
}

/** The switch, written. One caller: the settings route behind `PUT /park-at-peak`. */
export async function writeParkAtPeakSwitch(enabled: boolean): Promise<void> {
  return writeFlagFile(peakSwitchPath(), enabled);
}

/**
 * The switch in the shape the two routes answer with — the service's own two methods, living HERE
 * rather than in `settings.service.ts` because that file is over its ceiling and takes call-in lines
 * only. They are handed to it verbatim (`getParkAtPeak` / `setParkAtPeak` delegate), so the routes
 * stay as thin as the ones beside them and the 400 below is raised where the input is judged.
 */
export async function getParkAtPeakState(): Promise<{ enabled: boolean }> {
  return { enabled: await readParkAtPeakSwitch() };
}

/**
 * Set the switch, and answer with what the file reads back — never with the input.
 *
 * The read-back is the point, as it is for the DeepSeek switch: this is a file another daemon reads,
 * and the position the toggle renders should be the one on disk. A non-boolean is a 400 rather than a
 * coercion, because the only two things this route can say are on and off.
 */
export async function setParkAtPeakState(enabledInput: unknown): Promise<{ enabled: boolean }> {
  if (typeof enabledInput !== 'boolean') {
    throw new AppError('enabled must be a boolean', {
      code: 'INVALID_PARK_AT_PEAK_STATE',
      statusCode: 400,
    });
  }
  await writeParkAtPeakSwitch(enabledInput);
  return { enabled: await readParkAtPeakSwitch() };
}
