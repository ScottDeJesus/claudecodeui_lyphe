import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { userFacingEnv } from '@/shared/child-env.js';

/**
 * The dispatcher's next DeepSeek off-peak moment, for the cards' `Start at …` button.
 *
 * ONE CLOCK. The moment is `dispatcher offpeak`'s answer — derived by the dispatcher from
 * `deepseek.PEAK_UTC`, the same table that parks a start in peak hours — and never computed here or in
 * the browser: a second copy of the vendor's windows would be a second clock to keep in step. The
 * answer is CACHED until the moment it names has passed, because it moves once a day and the tab asks
 * on every mount; a failed ask caches nothing, so the next one tries again.
 */

const execFileAsync = promisify(execFile);

/** `OFFPEAK at=<epoch seconds> utc=<iso>` — the dispatcher's one line (`hooks/dispatcher/cmd/schedule.py`). */
const OFFPEAK_LINE = /^OFFPEAK at=(\d+)\b/m;

export type OffpeakClockDependencies = {
  /** The dispatcher's entry point, absolute. */
  bin: string;
  /** Wall-clock ceiling for the one call. */
  timeoutMs: number;
};

/**
 * Builds the clock `dispatcher.module.ts` hands to the router's `GET /plans/offpeak`. Resolves epoch
 * SECONDS, or `null` when the dispatcher did not answer with its line — never throws, since a missing
 * button time is not a fault.
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
