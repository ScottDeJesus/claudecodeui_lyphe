/**
 * A chat's own weekly window, filed with the pacer under the account the chat runs on.
 *
 * Every Claude child streams `rate_limit_event`s carrying `rate_limit_info.unifiedWindows`, whose
 * `seven_day` entry is the weekly window of the ACCOUNT ITS CREDENTIAL BELONGS TO. A CloudCLI chat's
 * process is launched on the account the house chose (`claude-launch-account.ts`, kept in the
 * launch profile), so its events are a reading of THAT account, never of whatever login the box
 * holds now: after a switch the live login is not the account an open chat rides (the account
 * rule's own fact).
 *
 * ONE READING PER MOVE. A chat is chatty: a turn arrives in a burst of events and the same window
 * is reported on each. This module remembers, per account, the week it last filed, and hands the
 * door no reading until its figure or its reset moves. The memory is this process's — a server
 * handover starts with none, and the first event after it files once; the pacer's store dedupes an
 * identical row in any case.
 *
 * THE DOOR'S UNITS. Python takes a fraction 0..1 and epoch seconds; a `ClaudeUsageWindow` carries a
 * percent 0..100 and an ISO instant. The conversion happens HERE, once, so `pacer-door.ts` keeps the
 * single scale rule it already owns for the meter. A window the event does not carry is left absent,
 * never fabricated as 0 %.
 *
 * consumer: `claude-runtime-signals.ts`'s `rate_limit_event` branch.
 */
import { notePacerReading } from '@/modules/accounts/index.js';
import type { ClaudeUsageWindow } from '@/shared/types.js';

/** One window as the door files it: percent 0..100 and its reset in whole epoch seconds. */
type WindowFigures = { percent: number; resetsAt: number };

/** One account's week, as last filed. */
type AccountFigures = { week: WindowFigures };

/** The pacer's own band (`readings.MAX_FRACTION`): 1.5 is the wall, the half beyond it an overshoot. */
const MAX_PERCENT = 150;

/** What this process has already filed, account digest → the week it filed. */
const filed = new Map<string, AccountFigures>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One `unifiedWindows` entry → the row the door takes, or null when the entry is not a live window.
 * A utilization is a FRACTION in the event; one decimal in percent is the vendor's own precision and
 * keeps the multiplication from turning 0.62 into 62.00000000000001 at the door. `resetsAt` is epoch
 * seconds; the door reads back the ISO instant this builds.
 */
function windowOf(
  value: unknown,
  key: string,
  label: string,
): { row: ClaudeUsageWindow; figures: WindowFigures } | null {
  if (!isRecord(value)) return null;
  const utilization = readNumber(value.utilization);
  const resetsAt = readNumber(value.resetsAt);
  if (utilization === null || resetsAt === null || resetsAt <= 0) return null;
  const percent = Math.round(utilization * 1000) / 10;
  if (percent < 0 || percent > MAX_PERCENT) return null;
  const seconds = Math.round(resetsAt);
  // The largest instant a `Date` can name (8.64e15 ms): a value past it would make `toISOString`
  // throw, and this runs inside a live chat's message loop, which a reading must never break.
  if (seconds > 8_640_000_000_000) return null;
  return {
    row: { key, label, percent, resetsAt: new Date(seconds * 1000).toISOString() },
    figures: { percent, resetsAt: seconds },
  };
}

/** Did the week move since this account's last reading — a new figure or a new reset? A first reading always has. */
function moved(before: AccountFigures | undefined, now: AccountFigures): boolean {
  if (before === undefined) return true;
  return before.week.percent !== now.week.percent || before.week.resetsAt !== now.week.resetsAt;
}

/**
 * File one `rate_limit_event`'s week under `account`, when it moved since that account's last
 * reading.
 *
 * `account` null is a process the door gave no answer on — it rides the live login and files nothing,
 * because there is no account to file under. An event with no readable week files nothing. The door
 * call is fire-and-forget and never raises. Consumers: `claude-runtime-signals.ts`.
 */
export function noteChatWindows(account: string | null, unifiedWindows: unknown): void {
  if (!account || !isRecord(unifiedWindows)) return;
  const week = windowOf(unifiedWindows.seven_day, 'seven_day', 'weekly');
  if (week === null) return;
  const figures: AccountFigures = { week: week.figures };
  if (!moved(filed.get(account), figures)) return;
  filed.set(account, figures);
  notePacerReading(account, [week.row], Date.now(), 'chat');
}
