import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import {
  FAILED_PASS_RETRY_MS,
  QUEUED_RETRY_MS,
  STOP_GRACE_MS,
  armNextDue,
  holdQueued,
  mayStartQueued,
  startScheduledMessageClock,
  stopScheduledMessageClock,
} from '@/modules/scheduled-messages/services/scheduled-message-clock.service.js';
import {
  announceScheduledMessagesChanged,
  scheduledMessagesService,
} from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { tellDraftsChanged } from '@/modules/user/index.js';
import { readQueuedChatMessage } from '@/shared/utils.js';

// Set while the dispatcher is initialized; the passes and `requestQueuedPass` do nothing without it.
let dispatchRuntime: ProviderRuntimeGateway | null = null;
// The scheduled pass awaits each due turn to the end (two due messages for one session must land
// in order), so it is guarded on its own. The queued pass never waits on a turn and runs beside it:
// a long scheduled turn must not hold every queued message back.
let scheduledPassInFlight = false;
let queuedPassInFlight = false;
// A queued pass asked for while one was running: run again when it ends.
let queuedPassRequested = false;
let unsubscribeRunCompleted: (() => void) | null = null;
let unsubscribeScheduleChanged: (() => void) | null = null;
/**
 * Per session, how many scheduled messages are claimed but not started yet. The queued pass skips
 * these sessions: a queued turn started there would only be aborted when the scheduled message's
 * turn comes up (`interruptActiveRun`), consuming the queued message for an answer nobody gets.
 */
const scheduledAwaitingStart = new Map<string, number>();

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


async function sendClaimedQueuedMessage(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const message = readQueuedChatMessage(candidate.queuedMessage);
  if (!message) {
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
    tellDraftsChanged();
    return;
  }

  const result = await runDetachedChatTurn(
    {
      sessionId: candidate.sessionId,
      userId: candidate.userId,
      content: message.content,
      options: { ...message.options, attachments: message.attachments },
      // His words stand in every open tab as the run starts. Not with attachments: the echo is text alone, and the
      // history's retirement of it matches a row's images and files too.
      echoUserMessage: message.attachments.length === 0,
    },
    { runtime },
  );

  // A turn that did not start is put back, whatever stopped it: a run that won the race between the
  // registry check and the reservation, or a provider that is unavailable for now. Deleting it lost the
  // user's message without a word. Nothing announces that the provider came back, so the session is
  // held QUEUED_RETRY_MS and the hold's timer asks for the pass again.
  if (!result.started) {
    console.error('[ScheduledMessages] Queued turn did not start; kept and tried again', {
      sessionId: candidate.sessionId,
      retryInMs: QUEUED_RETRY_MS,
      error: result.error,
    });
    sessionDraftsDb.restoreQueuedMessage(candidate);
    tellDraftsChanged();
    holdQueued(candidate.sessionId, Date.now() + QUEUED_RETRY_MS);
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
  tellDraftsChanged();
}

/** Sends every persisted queued turn whose session is idle and not held (`holdQueued`). */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages();
  const now = Date.now();
  let claimed = 0;

  for (const candidate of candidates) {
    if (
      chatRunRegistry.isProcessing(candidate.sessionId)
      || scheduledAwaitingStart.has(candidate.sessionId)
      || !mayStartQueued(candidate.sessionId, now)
    ) {
      continue;
    }
    if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
      continue;
    }
    tellDraftsChanged();
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

/** Records why a claimed message did not go, and shows it on its session's banner. */
function recordFailure(row: ScheduledMessageRow, reason: string): void {
  scheduledMessagesDb.markFailed(row.id, reason);
  announceScheduledMessagesChanged(row.session_id);
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
        // His words stand in every open tab as the run starts, not when the turn ends.
        echoUserMessage: true,
      },
      { runtime },
    );

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (!result.started || result.error) {
      recordFailure(row, result.error ?? 'The session was unavailable when this was due.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(row, message);
  }
}

/**
 * Sends every message whose time has come.
 *
 * Exported so one pass can be driven by hand without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next pass
  // pick the same message up again.
  const due = scheduledMessagesDb.claimDue(now);
  if (due.length === 0) {
    return 0;
  }

  // The claim already recorded them as sent, so their banners come down now, as the turns start,
  // rather than once the last turn has finished. One frame per session however many were due.
  for (const sessionId of new Set(due.map((row) => row.session_id))) {
    announceScheduledMessagesChanged(sessionId);
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

function reportPassFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
}

/**
 * Asks for the queued pass: when a run completes, when a queued message is saved (the user module),
 * when a session's hold ends, and once at boot. A pass asked for while one runs follows it.
 */
export function requestQueuedPass(): void {
  const runtime = dispatchRuntime;
  if (!runtime) return;
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
        requestQueuedPass();
      }
    });
}

/**
 * The next-due timer's firing. A pass already running is not started again underneath itself (the
 * claim is transactional but the runs are not): its own `finally` re-arms, and a message that fell due
 * meanwhile is past due there, so the timer fires again at once.
 */
function runScheduledPass(): void {
  const runtime = dispatchRuntime;
  if (!runtime || scheduledPassInFlight) return;
  scheduledPassInFlight = true;
  let failed = false;
  void dispatchDueScheduledMessages(runtime)
    .catch((error: unknown) => {
      failed = true;
      reportPassFailure(error);
    })
    .finally(() => {
      scheduledPassInFlight = false;
      // Also after the pass's own claim and failures, which moved the earliest pending message.
      armNextDue(failed ? Date.now() + FAILED_PASS_RETRY_MS : undefined);
    });
}

/**
 * Starts sending scheduled and queued messages, each from a timer armed at a stored instant.
 *
 * The schedule lives in the database, so a message stays scheduled across a restart, and one that came
 * due while the server was down is sent by the catch-up pass here rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  if (dispatchRuntime) {
    return;
  }
  dispatchRuntime = runtime;
  startScheduledMessageClock({ onNextDue: runScheduledPass, onQueuedDue: requestQueuedPass });

  // Catch up on anything that came due while the server was not running. The claim is synchronous,
  // so the arm below already reads past it.
  runScheduledPass();
  armNextDue();
  unsubscribeScheduleChanged = scheduledMessagesService.onChanged(() => armNextDue());

  // A queued turn is waiting on exactly this: send it as its session goes idle. Deferred a turn of the
  // event loop, because completion is recorded inside the run's own event handling.
  // After an abort the session is held STOP_GRACE_MS instead: the user pressed Stop, and sending their
  // queued turn in the same instant reads as Stop not working and takes away the moment to cancel it.
  // The hold's timer asks for the pass when the grace ends.
  unsubscribeRunCompleted = chatRunRegistry.onRunCompleted((sessionId, { aborted }) => {
    if (aborted) {
      holdQueued(sessionId, Date.now() + STOP_GRACE_MS);
      return;
    }
    setImmediate(requestQueuedPass);
  });

  requestQueuedPass();
}

export function closeScheduledMessageDispatcher(): void {
  unsubscribeRunCompleted?.();
  unsubscribeRunCompleted = null;
  unsubscribeScheduleChanged?.();
  unsubscribeScheduleChanged = null;
  stopScheduledMessageClock();
  dispatchRuntime = null;
}
