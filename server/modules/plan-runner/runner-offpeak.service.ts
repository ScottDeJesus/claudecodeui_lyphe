import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { userFacingEnv } from '@/shared/child-env.js';

/**
 * The runner's next DeepSeek off-peak moment, for the card's and the deck's `Start at …` button.
 *
 * ONE CLOCK. The moment is `plan-runner offpeak`'s answer — derived by the runner from `deepseek.PEAK_UTC`, the
 * same table that parks a start in peak hours — and never computed here or in the browser: a second copy of the
 * vendor's windows would be a second clock to keep in step. The answer is CACHED until the moment it names has
 * passed, because it moves once a day and the tab asks on every mount; a failed ask caches nothing, so the next
 * one tries again.
 */

const execFileAsync = promisify(execFile);

/** `OFFPEAK at=<epoch seconds> utc=<iso>` — the runner's one line (`hooks/plan_runner/schedule.py:offpeak`). */
const OFFPEAK_LINE = /^OFFPEAK at=(\d+)\b/m;

export type OffpeakClockDependencies = {
  /** The runner's entry point, absolute. */
  bin: string;
  /** Wall-clock ceiling for the one call. */
  timeoutMs: number;
};

/**
 * Builds the clock `plan-runner.module.ts` hands to the router's `GET /runs/offpeak`. Resolves epoch SECONDS, or
 * `null` when the runner did not answer with its line — never throws, since a missing button time is not a fault.
 */
export function createOffpeakClock(dependencies: OffpeakClockDependencies): () => Promise<number | null> {
  let cached: number | null = null;

  return async () => {
    if (cached !== null && cached * 1000 > Date.now()) return cached;
    try {
      const { stdout } = await execFileAsync(dependencies.bin, ['offpeak'], {
        timeout: dependencies.timeoutMs,
        env: userFacingEnv(),
        cwd: os.homedir(),
      });
      const found = OFFPEAK_LINE.exec(String(stdout));
      cached = found ? Number(found[1]) : null;
    } catch {
      cached = null;
    }
    return cached;
  };
}
