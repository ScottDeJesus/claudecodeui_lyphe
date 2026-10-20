import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import type { ClaudeUsageWindow } from '@/shared/types.js';

import { isFiniteNumber, resetEpoch } from './usage-windows.js';

/**
 * The WRITE half of the pacer's door: CloudCLI's usage meter handing every good reading it takes to
 * the house's record (`~/.claude/scripts/pacer note --source meter`).
 *
 * WHY THE METER FILES. The Claude children's own `rate_limit_event` stream covers the times the
 * house is working; the meter covers the times it is idle with the app open — including the instant
 * of an account switch, when its re-read is the new account's first reading. The pacer's projection
 * needs both, and nothing else polls the OAuth endpoint (`claude-api-backup` ruled polling out).
 *
 * WHAT THE DOOR TAKES. One JSON object on stdin: `{"account", "at" (epoch seconds), "five":
 * {"used": fraction, "resets_at": epoch} | null, "week": … | null}`. Fractions here are 0..1, the
 * pacer's only unit; this file is where a meter's PERCENT is divided by a hundred, so no reader of
 * the store ever has to ask which scale a number is in.
 *
 * A READING IS DROPPED, NEVER SENT, when there is no login to file it under, and when neither
 * window is a live one. A window whose reset has already passed is HISTORY (a rolled window): its
 * percentage describes a block that is over, and filing it would put a stale figure at the head of
 * the account's newest reading. A window with no readable reset cannot be filed at all, because it
 * cannot be told which block it belongs to.
 *
 * IT NEVER RAISES, NEVER LOGS AND IS NEVER AWAITED. The caller is a poll that must answer the
 * browser on time, so the door is a child process with a ten-second ceiling whose failure lands in
 * a callback that says nothing. A reading lost to a missing binary is worth less than a poll lost
 * to it; the next poll reads again.
 *
 * `status()` — the read call, which draws the projection — is the drawing side's half of this door;
 * `note()` is the meter's.
 */

/** The door's ceiling. The command writes one stdout line and exits; ten seconds is a fault, not a
 *  slow answer, and a stray child must not outlive the poll that started it. */
const NOTE_TIMEOUT_MS = 10_000;

/** The binary: the probe seam, else the house's wrapper (`scripts/pacer`, in `scripts/launch-table`'s
 *  shape). Read on every call rather than at module load, so a probe redirects the door it gets. */
function pacerBin(): string {
  return process.env.PACER_BIN || path.join(os.homedir(), '.claude', 'scripts', 'pacer');
}

/** One window as the door takes it: a fraction 0..1 and its reset in epoch SECONDS. */
type DoorWindow = { used: number; resets_at: number };

/** The door's stdin object, field for field. */
type NoteBody = {
  account: string;
  at: number;
  five: DoorWindow | null;
  week: DoorWindow | null;
};

/**
 * One meter window → the door's, or `null` when the door could not file it.
 *
 * `checkedAt` is the reading's own instant in epoch MILLISECONDS (`Reading.checkedAt`): the reset is
 * judged against when the figure was READ, not against the clock at filing time, so a poll that
 * answers late does not roll a window that was live when it arrived.
 */
function doorWindow(
  windows: ClaudeUsageWindow[],
  key: string,
  checkedAt: number,
): DoorWindow | null {
  const window = windows.find((entry) => entry.key === key);
  if (!window || window.rolled === true || !isFiniteNumber(window.percent)) return null;
  const resets = resetEpoch(window.resetsAt);
  if (resets === null) return null;
  if (resets <= checkedAt) return null; // its block is over: history, never a reading
  // Whole seconds, like every epoch the pacer stores — `readings._epoch` rounds the stream's the
  // same way, so the two sources agree on one window instead of splitting it a second apart.
  const at = Math.floor(checkedAt / 1000);
  const resetsAt = Math.round(resets / 1000);
  // ⚠ The door demands `at < resets_at` STRICTLY and refuses the WHOLE object when one window
  // fails it. A reset within half a second of the read rounds onto `at`; dropping this window here
  // keeps the other window's reading instead of losing both.
  if (resetsAt <= at) return null;
  return { used: window.percent / 100, resets_at: resetsAt };
}

/**
 * File one good meter reading with the pacer, as `source` "meter".
 *
 * Consumers: `usage.service.ts`'s `measure`, after it has re-read the credential stamp and found the
 * login unchanged. `digest` is `liveAccountDigest()`'s answer; `checkedAt` is the reading's
 * `checkedAt` in epoch MILLISECONDS. SYNCHRONOUS BY DESIGN — it starts the child and returns, so
 * nothing on the route ever awaits it. Never raises.
 */
export function note(digest: string, windows: ClaudeUsageWindow[], checkedAt: number): void {
  const account = digest.trim();
  if (!account) return; // no login, no owner for the reading
  const five = doorWindow(windows, 'five_hour', checkedAt);
  const week = doorWindow(windows, 'seven_day', checkedAt);
  if (five === null && week === null) return; // nothing here the door would keep

  const body: NoteBody = { account, at: Math.floor(checkedAt / 1000), five, week };
  // ⚠ The spawn can throw SYNCHRONOUSLY — an argument carrying a NUL byte is `ERR_INVALID_ARG_VALUE`,
  // raised before any child exists. That is the same fact as a door that never answered: a reading
  // dropped, never a poll lost.
  try {
    const child = execFile(
      pacerBin(),
      ['note', '--source', 'meter'],
      { timeout: NOTE_TIMEOUT_MS },
      // The door's own stdout/stderr end here and go no further: `NOTED` and `DROPPED` are the
      // operator's words at a terminal, and the server's journal must not carry the door's lines.
      () => {},
    );
    // ⚠ The door may exit before it has read stdin (a `DROPPED`, or no binary at all). That is an
    // EPIPE on this write, and an unhandled `error` event on a stream is an uncaught exception in
    // the server. Swallow it: the reading was not filed, and the next poll reads again.
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(body));
  } catch {
    // A reading dropped, never a poll lost.
  }
}
