import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';

type UnreadReplyInput = {
  /** The conversation the chat shows; null while it shows none (nothing can be unread then). */
  sessionId: string | null;
  /** Whether the reader can see the chat right now: floating, or home on a visible, uncovered tab. */
  onScreen: boolean;
};

/**
 * Used by chat-host's provider: whether a reply landed in the chat's conversation while the chat was out of
 * sight — the fact the switcher's FAB draws as its dot.
 *
 * WHAT LIGHTS IT. A frame for the chat's own session (`event.sessionId`), arriving while `onScreen` is false,
 * that is either the turn's end (`complete`, unless the reader stopped it — `aborted: true` is the reader's own
 * act, not news) or a `permission_request` (the run is waiting on the reader). Every other frame — the stream's
 * deltas, status, a reply to some other conversation — leaves the dot alone.
 *
 * WHAT CLEARS IT. The chat coming on screen (floating it, or opening the chat tab with no application over
 * it), and the conversation changing: the dot said something about the old one. What is held is WHICH
 * conversation a reply waits in, and `unread` is that conversation being the one shown while the chat is out
 * of sight — so a change of conversation un-lights the dot by itself, and the stale value is dropped in the
 * render that finds it stale (the pattern React documents for state that follows props), never by an effect.
 *
 * THE FRAME IS JUDGED AGAINST THE LATEST FACTS, not the ones of the render the subscription was made in. The
 * subscription is bound once and reads `onScreen` and `sessionId` through refs written in a layout effect, so
 * a frame that lands right after the chat floated is never judged against the moment before it.
 */
export function useUnreadReply({ sessionId, onScreen }: UnreadReplyInput): boolean {
  const { subscribe } = useWebSocket();

  // The conversation a reply is waiting in, or null. State because the FAB draws the dot from it; only the
  // frame listener below writes a session id, and the render below drops it once it is stale.
  const [waitingSessionId, setWaitingSessionId] = useState<string | null>(null);
  const unread = waitingSessionId !== null && waitingSessionId === sessionId && !onScreen;
  // Seen, or the conversation changed: nothing waits any more. Conditional, so it settles in one extra render.
  if (waitingSessionId !== null && !unread) setWaitingSessionId(null);

  const latest = useRef({ sessionId, onScreen });
  useLayoutEffect(() => {
    latest.current = { sessionId, onScreen };
  });

  useEffect(() => {
    return subscribe((event) => {
      const { sessionId: chatSessionId, onScreen: chatOnScreen } = latest.current;
      if (chatOnScreen || chatSessionId === null || event.sessionId !== chatSessionId) return;
      const endsTheTurn = event.kind === 'complete' && event.aborted !== true;
      if (endsTheTurn || event.kind === 'permission_request') setWaitingSessionId(chatSessionId);
    });
  }, [subscribe]);

  return unread;
}
