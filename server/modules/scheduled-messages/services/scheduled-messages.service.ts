import { scheduledMessagesDb, sessionsDb } from '@/modules/database/index.js';
import type { ScheduledMessageRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { ScheduledMessagesChangedEvent } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** How far ahead a message may be scheduled. Beyond this it is almost certainly a mistake. */
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CONTENT_LENGTH = 100_000;

export type ScheduledMessage = {
  id: string;
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
  scheduledFor: string;
  status: ScheduledMessageRow['status'];
  failureReason: string | null;
  createdAt: string;
};

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // A corrupt options blob must not stop the message from being sent.
    return {};
  }
}

/**
 * Puts one `scheduled_messages_changed` frame on every open gateway socket, naming the chat whose
 * scheduled messages moved, so a composer showing that chat's banner reads its list again.
 *
 * Called AFTER each change landed — scheduled, cancelled or dismissed, claimed by the dispatcher
 * as its turn starts, failed — never before it, so a write that refused told no client it happened.
 * Without it the banner was read only when a chat opened: a message the dispatcher had sent stayed
 * on screen as still scheduled until a reload, and so did one scheduled or cancelled in another tab.
 *
 * The frame names the chat and carries no message: each client reads the list through the
 * authenticated per-user GET, so no text travels over the broadcast, and a composer on another chat
 * ignores it. The fan-out copies `followups.service.ts`: stringify once, skip a client whose
 * `readyState` is not open, catch PER CLIENT so one dead socket does not cost the rest their frame.
 * Never throws — the dispatcher calls it right after claiming messages it still has to send.
 *
 * Exported for the dispatcher beside this file, which claims and fails messages from a timer with
 * no request to answer.
 */
export function announceScheduledMessagesChanged(sessionId: string): void {
  const message = JSON.stringify({
    kind: 'scheduled_messages_changed',
    sessionId,
    at: Date.now(),
  } satisfies ScheduledMessagesChangedEvent);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[ScheduledMessages] could not send a scheduled_messages_changed frame to a client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export function toScheduledMessage(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    options: readOptions(row.options),
    scheduledFor: row.scheduled_for,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export const scheduledMessagesService = {
  /**
   * Records a message to send to a session later.
   *
   * The time is taken as an absolute instant, so the schedule does not move if
   * the user changes time zone — or schedules from a phone and is on a laptop
   * when it fires.
   */
  schedule(input: {
    userId: number;
    sessionId: string;
    content: string;
    options?: unknown;
    scheduledFor: string;
  }): ScheduledMessage {
    const content = input.content.trim();
    if (!content) {
      throw new AppError('A scheduled message needs some text.', {
        code: 'CONTENT_REQUIRED',
        statusCode: 400,
      });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new AppError('That message is too long to schedule.', {
        code: 'CONTENT_TOO_LONG',
        statusCode: 400,
      });
    }

    const scheduledFor = new Date(input.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      throw new AppError('scheduledFor must be an ISO timestamp.', {
        code: 'INVALID_SCHEDULE_TIME',
        statusCode: 400,
      });
    }
    if (scheduledFor.getTime() - Date.now() > MAX_SCHEDULE_AHEAD_MS) {
      throw new AppError('That is too far in the future to schedule.', {
        code: 'SCHEDULE_TOO_FAR_AHEAD',
        statusCode: 400,
      });
    }

    if (!sessionsDb.getSessionById(input.sessionId)) {
      throw new AppError(`Session "${input.sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const scheduled = toScheduledMessage(scheduledMessagesDb.create({
      userId: input.userId,
      sessionId: input.sessionId,
      content,
      options: input.options ?? {},
      scheduledFor,
    }));
    announceScheduledMessagesChanged(scheduled.sessionId);
    return scheduled;
  },

  listForSession(userId: number, sessionId: string): ScheduledMessage[] {
    return scheduledMessagesDb.listForSession(userId, sessionId).map(toScheduledMessage);
  },

  listPending(userId: number): ScheduledMessage[] {
    return scheduledMessagesDb.listPendingForUser(userId).map(toScheduledMessage);
  },

  /** Cancels a pending message, or dismisses a failed one. */
  cancel(userId: number, id: string): void {
    const sessionId = scheduledMessagesDb.cancel(userId, id);
    if (!sessionId) {
      throw new AppError('That message has already been sent or cancelled.', {
        code: 'SCHEDULED_MESSAGE_NOT_PENDING',
        statusCode: 409,
      });
    }
    announceScheduledMessagesChanged(sessionId);
  },
};
