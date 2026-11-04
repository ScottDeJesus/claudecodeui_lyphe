import { randomUUID } from 'node:crypto';

import type { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { LLMProvider, NormalizedMessage, RealtimeClientConnection } from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

/**
 * Which chat sessions each gateway socket has OPEN — idle ones included — so a run that starts with nobody asking for it
 * (a scheduled message, a queued follow-up, the companion's send, a compaction, a re-adoption) reaches every tab showing
 * that session from the run's first event, with no tab round trip. A turn typed in a tab is not joined here: the typing
 * tab is on it already, and another tab on that session has nothing yet to show of the words that started it.
 *
 * A WeakMap keyed by the socket, as `socketUsers` in `websocket-state.service.ts` is: a closed socket leaves
 * `connectedClients` and its entry is collected with it, so there is no `delete` to forget.
 */
const sessionsOpenBySocket = new WeakMap<RealtimeClientConnection, Set<string>>();

/** A real tab holds one or two (its chat, a delegated one); the cap only stops a client from growing the set without end. */
const MAX_OPEN_SESSIONS_PER_SOCKET = 64;

/**
 * Records that this socket has `sessionId` open, from a `chat.subscribe` naming it — whether or not a run is going.
 * Adds only: several subscribes on one socket all stay open until the chat view next reports the session it shows —
 * every `chat.presence` it sends (on mount, on focus, on its 30 s heartbeat) goes through `markSocketShowing`, which
 * keeps that one and drops the rest.
 *
 * Consumed by `handleChatSubscribe` in `chat-websocket.service.ts`.
 */
export function markSocketSubscribed(connection: RealtimeClientConnection, sessionId: string): void {
  const open = sessionsOpenBySocket.get(connection);
  if (!open) {
    sessionsOpenBySocket.set(connection, new Set([sessionId]));
    return;
  }
  open.delete(sessionId);
  open.add(sessionId);
  // The session ids are the client's to choose, so the set is bounded: past the cap the oldest is let go (a Set keeps
  // insertion order, and a repeat subscribe above moved its session to the newest).
  if (open.size > MAX_OPEN_SESSIONS_PER_SOCKET) {
    open.delete(open.values().next().value as string);
  }
}

/**
 * Records that this socket now SHOWS `sessionId` and nothing else: its chat page reported it (`chat.presence`), so the
 * sessions it opened earlier are left — a tab that switched chats, or that visited forty over a day, must not go on
 * hearing every run of all of them. This is the same frame the house already reads as "what this tab is looking at"
 * (`session-presence.service.ts`); a report that names no session, or one a station page makes about its stage, says
 * nothing about the chat view's own session and is not passed here.
 *
 * Consumed by `handleChatPresence` in `chat-websocket.service.ts`.
 */
export function markSocketShowing(connection: RealtimeClientConnection, sessionId: string): void {
  sessionsOpenBySocket.set(connection, new Set([sessionId]));
}

/**
 * Joins every open tab of a session to a run nobody asked for from a browser, as a `chat.subscribe` a moment after the
 * run began would: each tab is sent the `chat_subscribed` ack (the existing frame, `isProcessing: true`, which is what
 * puts the session in its busy map — spinner, Stop, the sidebar's running mark), then the events the run has written so
 * far (`events`, the echo of the user's words among them), and is added to the writer's audience for the rest. The ack
 * carries no `pendingPermissions`: a run that has not reached the provider has none, and the tab's handler leaves its
 * own list alone when the field is absent. A tab is added only after its ack went out, so a socket that throws is not
 * left in an audience whose every later send would throw into the run.
 *
 * Called by `dispatchRun` after the run's `beforeRun` hook and before the provider is asked, and only while the run is
 * still running (`chatRunRegistry.joinOpenTabs`): a re-adopted host whose turn had already ended closes its run in that
 * hook, and tells no tab of a run that is over.
 *
 * Consumed by `chat-run-registry.service.ts`, which owns the run's writer and event log.
 */
export function joinOpenTabsToRun(
  writer: ChatSessionWriter,
  appSessionId: string,
  events: NormalizedMessage[],
): void {
  const ack = JSON.stringify({
    kind: 'chat_subscribed',
    sessionId: appSessionId,
    isProcessing: true,
    lastSeq: 0,
    timestamp: new Date().toISOString(),
  });

  for (const client of connectedClients) {
    if (client.readyState !== WS_OPEN_STATE || !sessionsOpenBySocket.get(client)?.has(appSessionId)) {
      continue;
    }
    // Per socket: one tab whose send throws must not cost the others their start.
    try {
      client.send(ack);
      for (const event of events) {
        client.send(JSON.stringify(event));
      }
      writer.updateWebSocket(client);
    } catch (error) {
      console.error('[ChatAudience] Could not join one open tab to its session\'s run', {
        appSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Writes the words a run was started with onto its stream as a local echo, so every tab that has the session open shows
 * the message at the run's start — the stream carries only what the model says, and without this the message would stand
 * in the chat when the turn ends and its history is read, after the reply it prompted.
 *
 * The same echo the companion's send writes (`companion-send.ts`): a `local_` row the history retires once the persisted
 * row with the same words arrives (`removeOptimisticUserEchoes`). Only for a run nobody typed in a tab: a page that sent
 * its own turn drew the message itself, and a second row would never retire. Not for attachments either — the retirement
 * matches a row's images and files too, and the server holds descriptors, not the rows the page draws.
 *
 * Consumed by `runDetachedChatTurn` in `chat-websocket.service.ts`, for a caller that says its content is the user's own
 * words (`echoUserMessage`): the scheduled-message dispatcher, for a scheduled message and a queued follow-up.
 */
export function echoUserMessageOnRun(
  writer: ChatSessionWriter,
  message: { sessionId: string; provider: LLMProvider; content: string },
): void {
  writer.send(createNormalizedMessage({
    kind: 'text',
    role: 'user',
    content: message.content,
    id: `local_detached_${randomUUID()}`,
    sessionId: message.sessionId,
    provider: message.provider,
  }));
}
