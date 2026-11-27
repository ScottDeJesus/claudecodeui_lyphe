import { scheduledMessagesDb } from '@/modules/database/index.js';
import { createDeadlineTimer } from '@/shared/deadline-timer.js';

/**
 * The scheduled-message dispatcher's two timers, each armed at an instant read from stored state, never a poll:
 *
 * - next due: the earliest pending scheduled message (`nextPendingAt()`);
 * - queued hold: the earliest instant a held session's queued message may start (`holdQueued`).
 *
 * The dispatcher owns what a firing does; this module owns when.
 */

/**
 * After Stop, the session's queued message waits this long. Sending it the instant Stop lands reads as Stop
 * not working and takes away the moment to cancel the queued message.
 */
export const STOP_GRACE_MS = 15_000;
/**
 * A queued turn that did not start (a provider unavailable for now, a run that won the race) waits this long
 * before it is tried again: nothing announces that the provider came back, so this is the one bounded wait.
 */
export const QUEUED_RETRY_MS = 30_000;
/** A scheduled pass that threw, or a next-due read that failed, is tried again no sooner than this: never a spin. */
export const FAILED_PASS_RETRY_MS = 30_000;

type ClockHandlers = {
  onNextDue(): void;
  onQueuedDue(): void;
};

let handlers: ClockHandlers | null = null;
const queuedNotBefore = new Map<string, number>();
// The last armed-or-nothing line logged, so the re-arm after every pass says only what changed.
let lastNextDueLine: string | null = null;
// The unreadable earliest time a pass was last armed to claim: seen again, that pass could not take it.
let lastUnreadablePendingAt: string | null = null;

const nextDueTimer = createDeadlineTimer(() => handlers?.onNextDue());
const queuedHoldTimer = createDeadlineTimer(() => {
  armQueuedHold(Date.now());
  handlers?.onQueuedDue();
});

export function startScheduledMessageClock(next: ClockHandlers): void {
  handlers = next;
}

export function stopScheduledMessageClock(): void {
  handlers = null;
  nextDueTimer.clear();
  queuedHoldTimer.clear();
  queuedNotBefore.clear();
  lastNextDueLine = null;
  lastUnreadablePendingAt = null;
}

/** Arms the next-due timer at the earliest pending message, no sooner than `notBefore` when given. */
export function armNextDue(notBefore?: number): void {
  let pendingAt: string | null;
  try {
    pendingAt = scheduledMessagesDb.nextPendingAt();
  } catch (error) {
    console.error('[ScheduledMessages] Could not read the next pending message; reading again later', {
      retryInMs: FAILED_PASS_RETRY_MS,
      error: error instanceof Error ? error.message : String(error),
    });
    nextDueTimer.arm(Date.now() + FAILED_PASS_RETRY_MS);
    return;
  }

  if (pendingAt === null) {
    nextDueTimer.arm(null);
    sayNextDue('[ScheduledMessages] nothing pending');
    return;
  }
  const dueAt = Date.parse(pendingAt);
  if (Number.isNaN(dueAt)) {
    // Never left unarmed: MIN keeps answering this row, so arming nothing stranded every message behind it.
    // The claim compares strings, so a row that sorts before now is taken by a pass armed now (and its send
    // fails it on the banner). One that sorts after now cannot be claimed; seen again, it waits the retry, never a spin.
    const isSecondSight = pendingAt === lastUnreadablePendingAt;
    lastUnreadablePendingAt = pendingAt;
    const passAt = isSecondSight ? Date.now() + FAILED_PASS_RETRY_MS : Date.now();
    nextDueTimer.arm(notBefore === undefined ? passAt : Math.max(passAt, notBefore));
    console.error('[ScheduledMessages] The earliest pending message has an unreadable time; a pass is armed to claim it', {
      scheduledFor: pendingAt,
      inMs: Math.max(0, passAt - Date.now()),
    });
    return;
  }
  lastUnreadablePendingAt = null;
  const at = notBefore === undefined ? dueAt : Math.max(dueAt, notBefore);
  nextDueTimer.arm(at);
  sayNextDue(`[ScheduledMessages] next due armed for ${new Date(at).toISOString()}`);
}

/** Holds a session's queued message until `until` (epoch ms); a later hold extends an earlier one. */
export function holdQueued(sessionId: string, until: number): void {
  const held = queuedNotBefore.get(sessionId);
  if (held === undefined || until > held) {
    queuedNotBefore.set(sessionId, until);
  }
  armQueuedHold(Date.now());
}

/** Whether a session's queued message may start at `now`; a hold that has ended is forgotten. */
export function mayStartQueued(sessionId: string, now: number): boolean {
  const held = queuedNotBefore.get(sessionId);
  if (held === undefined) return true;
  if (held > now) return false;
  queuedNotBefore.delete(sessionId);
  armQueuedHold(now);
  return true;
}

function armQueuedHold(now: number): void {
  let earliest: number | null = null;
  for (const [sessionId, until] of queuedNotBefore) {
    if (until <= now) {
      queuedNotBefore.delete(sessionId);
      continue;
    }
    if (earliest === null || until < earliest) earliest = until;
  }
  queuedHoldTimer.arm(earliest);
}

function sayNextDue(line: string): void {
  if (line === lastNextDueLine) return;
  lastNextDueLine = line;
  console.log(line);
}
