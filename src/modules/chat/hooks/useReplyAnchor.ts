import { useCallback, useEffect, useRef } from 'react';

import type { NormalizedMessage, SentUserTurn } from '@/shared/types';
import { findSentUserTurn } from '@/modules/chat/utils/sessionMessageReconciliation';

/** A sent message the operator may be brought back to, and what they had been shown of its reply when they left. */
type ReplyAnchor = {
  sent: SentUserTurn;
  /** Rows after the sent message when the operator stopped looking; null while they look. */
  rowsSeenAfterSent: number | null;
  /**
   * The operator came back while the socket was down and the store showed nothing new — which then says
   * nothing, since the server may hold a reply the store has not heard of. The question stays open until
   * rows arrive below the message (`takeDeferredLanding`).
   */
  isReturnDeferred: boolean;
};

type UseReplyAnchorArgs = {
  /** The session on screen, or null. */
  sessionId: string | null;
  /** Whether the operator is looking at it (`useIsLookingAtSession`). */
  isLooking: boolean;
  /** Whether a turn is running in it. */
  isProcessing: boolean;
  /** Reads a session's rows from the store — the session being left included, which is no longer on screen. */
  getMessages: (sessionId: string) => NormalizedMessage[];
};

type ReplyAnchorApi = {
  /** The operator sent `sent` in `sessionId`: it is the message to come back to, replacing any earlier one. */
  armReplyAnchor: (sessionId: string, sent: SentUserTurn) => void;
  /**
   * The operator is looking at `sessionId` again. Answers the message to land on when its anchor is
   * armed and rows arrived below it while they were away, else null (today's return stands). A landing
   * on a turn that has already ended spends the anchor; one on a running turn keeps it until that
   * turn ends in front of them.
   */
  takeLanding: (
    sessionId: string,
    messages: NormalizedMessage[],
    isTurnRunning: boolean,
    isSocketUp: boolean,
  ) => SentUserTurn | null;
  /**
   * Asks again for a return that `takeLanding` could not answer because the socket was down: answers
   * the message to land on once rows have arrived below it (the reconnect's catch-up), else null.
   */
  takeDeferredLanding: (sessionId: string, messages: NormalizedMessage[], isTurnRunning: boolean) => SentUserTurn | null;
};

/** How many rows follow the sent message in `messages`; every row when it is not among them. */
function countRowsAfterSent(messages: NormalizedMessage[], sent: SentUserTurn): number {
  const found = findSentUserTurn(messages, sent);
  return found ? messages.length - 1 - found.index : messages.length;
}

/**
 * Remembers, per session, which message the operator last sent there — so a reader who left while the
 * reply was still coming can be put back at their message, not thrown to the foot of a reply they have
 * not read. Called by `useChatSessionState`; the composer arms it through that hook.
 *
 * ONE `ChatInterface` SERVES EVERY SESSION, so the anchors are keyed by session id and live in a ref
 * that survives the switches between them.
 *
 * LIFE OF AN ANCHOR. Armed by the operator's send; replaced by their next send in that session; spent
 * when that turn ends while they look at the session. Away is `useIsLookingAtSession` turning false
 * for the session — another session picked, the Chat tab left, the browser tab hidden — and the rows
 * counted below the message at that moment are what "arrived while they were away" is measured from.
 */
export function useReplyAnchor({ sessionId, isLooking, isProcessing, getMessages }: UseReplyAnchorArgs): ReplyAnchorApi {
  const anchorsRef = useRef(new Map<string, ReplyAnchor>());
  // The session looked at as of the previous commit; a change of it is a departure.
  const lookedAtRef = useRef<string | null>(null);
  const turnRef = useRef<{ sessionId: string | null; isProcessing: boolean }>({ sessionId: null, isProcessing: false });

  const armReplyAnchor = useCallback((armedSessionId: string, sent: SentUserTurn) => {
    anchorsRef.current.set(armedSessionId, { sent, rowsSeenAfterSent: null, isReturnDeferred: false });
  }, []);

  const takeLanding = useCallback((
    returnedSessionId: string,
    messages: NormalizedMessage[],
    isTurnRunning: boolean,
    isSocketUp: boolean,
  ) => {
    const anchor = anchorsRef.current.get(returnedSessionId);
    // Never left (or already back): nothing was missed.
    if (!anchor || anchor.rowsSeenAfterSent === null) return null;

    const rowsArrived = countRowsAfterSent(messages, anchor.sent) > anchor.rowsSeenAfterSent;
    if (!rowsArrived && !isSocketUp) {
      // "Nothing new" from a store that could not have heard: not an answer. Keep the question open.
      anchor.isReturnDeferred = true;
      return null;
    }
    anchor.rowsSeenAfterSent = null;
    anchor.isReturnDeferred = false;
    if (!rowsArrived) return null;
    if (!isTurnRunning) anchorsRef.current.delete(returnedSessionId);
    return anchor.sent;
  }, []);

  const takeDeferredLanding = useCallback((
    returnedSessionId: string,
    messages: NormalizedMessage[],
    isTurnRunning: boolean,
  ) => {
    const anchor = anchorsRef.current.get(returnedSessionId);
    if (!anchor?.isReturnDeferred || anchor.rowsSeenAfterSent === null) return null;
    // Still behind the server: keep waiting.
    if (countRowsAfterSent(messages, anchor.sent) <= anchor.rowsSeenAfterSent) return null;
    return takeLanding(returnedSessionId, messages, isTurnRunning, true);
  }, [takeLanding]);

  // Departure: the operator stopped looking at the session they looked at a commit ago.
  useEffect(() => {
    const lookedAt = isLooking ? sessionId : null;
    const previous = lookedAtRef.current;
    lookedAtRef.current = lookedAt;
    if (previous === null || previous === lookedAt) return;

    const anchor = anchorsRef.current.get(previous);
    if (anchor) {
      anchor.rowsSeenAfterSent = countRowsAfterSent(getMessages(previous), anchor.sent);
      anchor.isReturnDeferred = false;
    }
  });

  // The turn ends in front of them: its anchor has done its work.
  useEffect(() => {
    const previousTurn = turnRef.current;
    turnRef.current = { sessionId, isProcessing };
    if (!sessionId || !isLooking) return;
    if (previousTurn.sessionId === sessionId && previousTurn.isProcessing && !isProcessing) {
      anchorsRef.current.delete(sessionId);
    }
  });

  return { armReplyAnchor, takeLanding, takeDeferredLanding };
}
