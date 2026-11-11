import fs from 'node:fs';
import path from 'node:path';

import { runDispatcherCommand, type DispatcherCommandResult } from '@/shared/dispatcher-command.js';
import { pacerBin } from '@/shared/utils.js';

/**
 * The runner's CPU gate, as this lane meets it: an agent about to start waits while the box's CPU is full
 * (`~/.claude/hooks/plan_runner/pacer/cpu_wait.py`), and while it waits its launcher owns a marker in the
 * pacer's `cpu-wait/` folder (`cpu_marker.py`: `<launch id>.json`, written atomically) — who, since when and the
 * gate's own words for why. This file owns the two bytes-and-process halves of that: reading the marker, and
 * pressing the one door that lets THAT agent go (`pacer cpu-release`, the Override). What the marker MEANS for a
 * pin is `soul-launch.service.ts`'s; nothing here decides it.
 */

/** How long the pacer's door may take to let one agent go: it writes one line and exits, so ten seconds is a fault. */
const RELEASE_TIMEOUT_MS = 10_000;

/** The name an Override from a card signs with in the pacer's journal (`cpu_marker.BY_RE`: letters, digits, `.`, `_`, `-`). */
const RELEASE_SIGNATURE = 'app-card';

/** What one waiting agent's marker says. `since` is epoch SECONDS, as everything the launcher's Python wrote. */
export type CpuWaitMarker = { since: number; words: string };

/**
 * The marker of one launch that is waiting for CPU, or `null` when it is not: no marker, one mid-write or torn, or one that
 * is not the shape the launcher writes. Never throws — a marker comes and goes with the launcher's wait, and one torn read
 * must never cost the lane its other launches. The caller proves the launcher alive (a SIGKILLed one leaves its marker).
 *
 * Used by `soul-launch.service.ts` (`snapshotLaunches`), once per launch that has no receipt.
 */
export function readCpuWaitMarker(cpuWaitDir: string, launchId: string): CpuWaitMarker | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(cpuWaitDir, `${launchId}.json`), 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const { since, words } = parsed as { since?: unknown; words?: unknown };
    return typeof since === 'number' && Number.isFinite(since) && typeof words === 'string' ? { since, words } : null;
  } catch {
    return null;
  }
}

/**
 * Let ONE waiting agent start now: `pacer cpu-release <launch id>`. The check stays on — the next agent is weighed as
 * before — and the pacer's own door answers on stdout like every dispatcher verb (`RELEASED <id>` with exit 0, or
 * `REFUSED <id>: not waiting for CPU` with exit 2), which is why this reuses the dispatcher's command runner: the same
 * argv boundary, the same refusal-as-a-result, the same body shape the cards' presses already read (`useVerbSend`).
 * The id is checked at the route before it gets here, and again by the door. It follows a `--` so the door's argument parser
 * can never read it as an option, whatever reaches here: a second fence behind the route's first-character rule.
 *
 * Used by `dispatch-souls.module.ts`, behind `POST /launches/:launchId/cpu-release`.
 */
export function releaseCpuWait(launchId: string): Promise<DispatcherCommandResult> {
  return runDispatcherCommand(['cpu-release', '--by', RELEASE_SIGNATURE, '--', launchId], {
    bin: pacerBin(),
    door: 'pacer',
    timeoutMs: RELEASE_TIMEOUT_MS,
    env: process.env,
  });
}
