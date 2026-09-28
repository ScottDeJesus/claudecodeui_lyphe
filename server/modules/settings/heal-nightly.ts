import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expandHome } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

/**
 * The house's own door onto the nightly unit (`~/.claude/scripts/heal-nightly`). `HEAL_NIGHTLY_BIN`
 * moves it for a probe, as `DISPATCHER_BIN` moves the dispatcher's; the default is where the house
 * installs it.
 */
const DEFAULT_BIN = '~/.claude/scripts/heal-nightly';

/**
 * How long a sync may take before it is given up on. `sync` is a few `systemctl --user` calls that
 * answer in well under a second each, so this bounds a door that is stuck — a user manager that will
 * not answer — never a wait anybody is meant to sit through.
 */
const SYNC_TIMEOUT_MS = 20_000;

/**
 * Make the heal cycle's nightly calendar unit say what `heal_cycle.flag` now says: `on <h>` arms
 * `heal-cycle-nightly.timer` at `h`:00 UTC, `off` disarms it. The flag is only the operator's word;
 * the UNIT is what fires at the hour (INV-187: no timer in any process of ours), so a flag written
 * without this would name an hour nothing keeps.
 *
 * Consumer: `heal-cycle-switch.ts`'s `writeHealCycle`, the flag's one writer, which awaits this after
 * every write so the PUT answers once systemd holds the new hour. The Python side owns the unit
 * (`scripts/heal_cycle_nightly.py`: it parses the flag itself and reads the result back out of
 * systemd), so nothing about the unit's shape is restated here.
 *
 * NOTHING HERE RAISES. The flag is already on disk when this runs, and a switch that failed because
 * the user manager was unreachable would lie about a file it had written; the one line the sync
 * printed — its read-back, or its refusal — goes to the journal instead, one line per press.
 */
export async function syncHealNightly(): Promise<void> {
  const bin = expandHome(process.env.HEAL_NIGHTLY_BIN || DEFAULT_BIN);
  try {
    const { stdout } = await execFileAsync(bin, ['sync'], { timeout: SYNC_TIMEOUT_MS });
    console.error(`heal nightly: ${stdout.trim() || 'no answer'}`);
  } catch (error) {
    // A refused sync exits 1 with its read-back still on stdout: that line names what systemd said.
    const failure = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    const said = [failure.stdout, failure.stderr, failure.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .find(Boolean);
    console.error(`heal nightly sync failed: ${said || 'the unit door did not answer'}`);
  }
}
