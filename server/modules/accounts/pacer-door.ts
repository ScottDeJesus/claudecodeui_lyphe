import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import type { ClaudeUsagePace, ClaudeUsageWindow } from '@/shared/types.js';

import { isFiniteNumber, isRecord, resetEpoch } from './usage-windows.js';

/**
 * Both halves of the pacer's door: the readings CloudCLI hands to the house's record
 * (`~/.claude/scripts/pacer note --source meter|chat`), and the pacer's projection read back out of
 * it (`status --json --account <digest>`) to draw on the meters' bars.
 *
 * WHO FILES. The meter files the times the house is idle with the app open — including the instant
 * of an account switch, when its re-read is the new account's first reading. A chat files its own
 * `rate_limit_event` stream under the account its process was launched on (`claude-chat-readings.ts`,
 * source "chat"): those are the times the house is working, and they are what lets the operator's
 * own chats trigger the account rule. The pacer's projection needs both, and nothing else polls the
 * OAuth endpoint (`claude-api-backup` ruled polling out).
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
 * `note()` is the writing half, for the meter and for a chat. `status()` asks for ONE named account
 * and answers `null` on any failure, so the projection on the meters is always the picture of the
 * login the reading came from and never the account some other command happens to consider in use.
 */

/** The door's ceiling. The command writes one stdout line and exits; ten seconds is a fault, not a
 *  slow answer, and a stray child must not outlive the poll that started it. */
const NOTE_TIMEOUT_MS = 10_000;

/** The read call's ceiling. `status` is a local SQLite read and a table lookup, not a network poll:
 *  five seconds is a pacer fault, and the poll answers without a picture rather than without a reading. */
const STATUS_TIMEOUT_MS = 5_000;

/** The binary: the probe seam, else the house's wrapper (`scripts/pacer`, in `scripts/launch-table`'s
 *  shape). Read on every call rather than at module load, so a probe redirects the door it gets. */
function pacerBin(): string {
  return process.env.PACER_BIN || path.join(os.homedir(), '.claude', 'scripts', 'pacer');
}

/** One window as the door takes it: a fraction 0..1 and its reset in epoch SECONDS. */
type DoorWindow = { used: number; resets_at: number };

/** One window of `pacer status --json`, as far as this file reads it: fractions 0..1. */
type StatusWindow = { used?: unknown; projected?: unknown; ceiling?: unknown };

/** The reading behind the picture: the moment it was taken, or `null` when there is none. */
type StatusReading = { at?: unknown };

/** The status verb's answer, as far as this file reads it (`door_status.as_json`). */
export type PacerStatus = {
  reading?: StatusReading | null;
  five?: StatusWindow | null;
  week?: StatusWindow | null;
  words?: unknown;
};

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
 * File one good reading with the pacer, under the source word that names who read it: `'meter'` for
 * the browser's usage poll, `'chat'` for a CloudCLI chat's own `rate_limit_event`.
 *
 * Consumers: `usage.service.ts`'s `measure` (source `'meter'`), after it has re-read the credential
 * stamp and found the login unchanged, and `claude-chat-readings.ts` (source `'chat'`, through the
 * accounts barrel), under the account its chat process was launched on. `digest` is
 * `liveAccountDigest()`'s answer for the meter, the launch profile's account for a chat;
 * `checkedAt` is the reading's own instant in epoch MILLISECONDS. SYNCHRONOUS BY DESIGN — it starts
 * the child and returns, so nothing on the route ever awaits it. Never raises.
 */
export function note(
  digest: string,
  windows: ClaudeUsageWindow[],
  checkedAt: number,
  source: 'meter' | 'chat',
): void {
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
      ['note', '--source', source],
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

/**
 * Ask the pacer for one account's picture: `pacer status --json --account <digest>`.
 *
 * Consumers: `usage.service.ts`'s `measure`, once a reading has come back whole, so the projection
 * on the meters belongs to the same login and the same instant as the percentages under it.
 * `--account` is ALWAYS passed: the verb's default is the account in use, which after a swap or a
 * `claude /login` may not be the login this reading was taken from, and the meters must never draw
 * one account's projection under another's numbers.
 *
 * IT ANSWERS `null` ON ANY FAILURE — an empty digest (no login to ask about, so no account is
 * named rather than the wrong one), a missing binary, a door that exits non-zero or overruns its
 * five seconds, a body that is not a JSON object. The caller attaches no `pace` then, and the
 * meters draw exactly as they did before the pacer's picture existed. Never raises.
 */
export function status(digest: string): Promise<PacerStatus | null> {
  const account = digest.trim();
  if (!account) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFile(
        pacerBin(),
        ['status', '--json', '--account', account],
        { timeout: STATUS_TIMEOUT_MS },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          try {
            const parsed: unknown = JSON.parse(stdout);
            resolve(isRecord(parsed) ? (parsed as PacerStatus) : null);
          } catch {
            resolve(null); // a body this file cannot read is no picture at all
          }
        },
      );
    } catch {
      resolve(null); // the same synchronous spawn failure `note` guards
    }
  });
}

/** One figure of the status JSON — a FRACTION 0..1 — as the percent the usage route sends. */
function percentOf(value: unknown): number | null {
  return isFiniteNumber(value) ? Math.round(value * 100) : null;
}

/**
 * The status verb's answer → `ClaudeUsage.pace`, the ONE place the pacer's fractions become the
 * wire's percents. Consumers: `usage.service.ts`'s `measure`.
 *
 * All seven figures are nullable because the pacer can see one window and not the other; `words`
 * is the pacer's own sentence and is required, so a body without one is no picture (null) rather
 * than a captionless set of marks. A null status — any failure of `status()` — is null here, and
 * the key is left off the reading entirely.
 *
 * A PACER FAULT IS NOT A PICTURE, and it is not a failure of `status()` either: a home that cannot
 * be opened still makes `pacer status` exit 0 with `probe: true`, a `why` naming the fault, every
 * window null and its diagnostic sentence in `words` ("pace: the 5-hour window is unknown"). A real
 * picture — fresh, stale or rolled — always carries the moment of the reading it was built from, so
 * a body whose `reading.at` is null draws nothing and the key is left off. The caption this file
 * would otherwise attach would describe a pacer that could not read, not this account's projection.
 */
export function paceOf(status: PacerStatus | null): ClaudeUsagePace | null {
  if (status === null || typeof status.words !== 'string') return null;
  const reading = status.reading ?? null;
  if (reading === null || !isFiniteNumber(reading.at)) return null;
  const five = status.five ?? null;
  const week = status.week ?? null;
  return {
    used5: percentOf(five?.used),
    projected5: percentOf(five?.projected),
    ceiling5: percentOf(five?.ceiling),
    used7: percentOf(week?.used),
    projected7: percentOf(week?.projected),
    ceiling7: percentOf(week?.ceiling),
    words: status.words,
  };
}
