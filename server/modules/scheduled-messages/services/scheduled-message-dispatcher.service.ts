import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
// The scheduled pass awaits each due turn to the end (two due messages for one session must land
// in order), so it is guarded on its own. The queued pass never waits on a turn and runs beside it:
// a long scheduled turn must not hold every queued message back.
let scheduledPassInFlight = false;
let queuedPassInFlight = false;
// A queued pass asked for while one was running: run again when it ends.
let queuedPassRequested = false;
let unsubscribeRunCompleted: (() => void) | null = null;
/**
 * Per session, how many scheduled messages are claimed but not started yet. The queued pass skips
 * these sessions: a queued turn started there would only be aborted when the scheduled message's
 * turn comes up (`interruptActiveRun`), consuming the queued message for an answer nobody gets.
 */
const scheduledAwaitingStart = new Map<string, number>();

type StoredQueuedMessage = {
  content: string;
  options: Record<string, unknown>;
  attachments: unknown[];
};

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readQueuedMessage(value: unknown): StoredQueuedMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content : '';
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
    : Array.isArray(record.images)
      ? record.images
      : [];
  if (!content.trim() && attachments.length === 0) {
    return null;
  }
  const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options)
    ? record.options as Record<string, unknown>
    : {};
  return { content, options, attachments };
}

async function sendClaimedQueuedMessage(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const message = readQueuedMessage(candidate.queuedMessage);
  if (!message) {
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
    return;
  }

  const result = await runDetachedChatTurn(
    {
      sessionId: candidate.sessionId,
      userId: candidate.userId,
      content: message.content,
      options: { ...message.options, attachments: message.attachments },
    },
    { runtime },
  );

  // A turn that did not start is put back for the next poll, whatever stopped it: a run that won
  // the race between the registry check and the reservation, or a provider that is unavailable
  // for now. Deleting it lost the user's message without a word.
  if (!result.started) {
    console.error('[ScheduledMessages] Queued turn did not start; kept for the next pass', {
      sessionId: candidate.sessionId,
      error: result.error,
    });
    sessionDraftsDb.restoreQueuedMessage(candidate);
    return;
  }
  if (result.error) {
    // The turn ran and failed partway; the error is in its transcript. Logged so the queued
    // message's fate is not silent here either.
    console.error('[ScheduledMessages] Queued turn started but failed', {
      sessionId: candidate.sessionId,
      error: result.error,
    });
  }
  sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
}

/** Sends every persisted queued turn whose session is currently idle. */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages();
  let claimed = 0;

  for (const candidate of candidates) {
    if (chatRunRegistry.isProcessing(candidate.sessionId) || scheduledAwaitingStart.has(candidate.sessionId)) {
      continue;
    }
    if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
      continue;
    }
    claimed += 1;
    // Not awaited: the send resolves only when its whole turn ends, and a pass held open that long
    // kept every other session's queued turn (and every due scheduled message) waiting behind it.
    // The claim already removed the row, so a later pass cannot pick the same turn up again.
    void sendClaimedQueuedMessage(candidate, runtime).catch((error: unknown) => {
      console.error('[ScheduledMessages] Queued turn failed', {
        sessionId: candidate.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return claimed;
}

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  try {
    const result = await runDetachedChatTurn(
      {
        sessionId: row.session_id,
        userId: row.user_id,
        content: row.content,
        options: readOptions(row.options),
        // The user picked this time on purpose; a run that happens to be going
        // is aborted so the scheduled message lands when it was due, instead
        // of being recorded as "not sent — session was busy".
        interruptActiveRun: true,
      },
      { runtime },
    );

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (!result.started || result.error) {
      scheduledMessagesDb.markFailed(row.id, result.error ?? 'The session was unavailable when this was due.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scheduledMessagesDb.markFailed(row.id, message);
  }
}

/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again.
  const due = scheduledMessagesDb.claimDue(now);
  if (due.length === 0) {
    return 0;
  }

  const markStarted = (sessionId: string) => {
    const left = (scheduledAwaitingStart.get(sessionId) ?? 1) - 1;
    if (left > 0) scheduledAwaitingStart.set(sessionId, left);
    else scheduledAwaitingStart.delete(sessionId);
  };
  for (const row of due) {
    scheduledAwaitingStart.set(row.session_id, (scheduledAwaitingStart.get(row.session_id) ?? 0) + 1);
  }

  // Sequentially: a session can only have one run at a time, and two due
  // messages for the same session must not race each other into it.
  for (const row of due) {
    // Released as the send begins: `runDetachedChatTurn` reserves the session synchronously, so
    // from here the registry keeps the queued pass out instead.
    const send = sendClaimedMessage(row, runtime);
    markStarted(row.session_id);
    await send;
  }

  return due.length;
}

/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  if (pollTimer) {
    return;
  }

  const reportPassFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
  };

  const pollQueued = () => {
    if (queuedPassInFlight) {
      queuedPassRequested = true;
      return;
    }
    queuedPassInFlight = true;
    queuedPassRequested = false;
    void dispatchQueuedMessages(runtime)
      .catch(reportPassFailure)
      .finally(() => {
        queuedPassInFlight = false;
        if (queuedPassRequested) {
          pollQueued();
        }
      });
  };

  const poll = () => {
    // A scheduled pass that overruns the interval must not be started again underneath itself;
    // the claim is transactional but the runs are not.
    if (!scheduledPassInFlight) {
      scheduledPassInFlight = true;
      void dispatchDueScheduledMessages(runtime)
        .catch(reportPassFailure)
        .finally(() => {
          scheduledPassInFlight = false;
        });
    }
    pollQueued();
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // A queued turn is waiting on exactly this: send it as its session goes idle. Deferred a tick,
  // because completion is recorded inside the run's own event handling.
  // Not after an abort: the user pressed Stop, and sending their queued turn in the same instant
  // reads as Stop not working and takes away the moment to cancel it. The next tick still sends it.
  unsubscribeRunCompleted = chatRunRegistry.onRunCompleted((_sessionId, { aborted }) => {
    if (!aborted) {
      setImmediate(pollQueued);
    }
  });
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  unsubscribeRunCompleted?.();
  unsubscribeRunCompleted = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
