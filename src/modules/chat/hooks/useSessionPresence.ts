import { useEffect, useRef } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';

/**
 * How often a visible tab re-states itself.
 *
 * The server forgets a record that has not been restated for 90 seconds
 * (`session-presence.service.ts`), so this has to be well inside that: a laptop left open on
 * a session must keep counting as watched, and a single announcement at mount would expire.
 */
const HEARTBEAT_MS = 30_000;

type UseSessionPresenceInput = {
  sessionId: string | null;
  sendMessage: (message: unknown) => void;
  isConnected: boolean;
};

/**
 * Whether this tab is on screen.
 *
 * `document.hasFocus()` is the wrong question twice over: a visible window sitting behind
 * another one is still being read, and it answers false in headless Chromium, which would
 * make every verification run look unwatched.
 */
const isVisible = () => document.visibilityState === 'visible';

/**
 * Tells the server which session this tab is showing, so the notification channels stay quiet
 * about a session the user is already looking at.
 *
 * Used by ChatInterface, once, which passes `null` whenever its chat is not the tab on screen.
 * Presence is keyed by the websocket on the server, so a phone and a laptop on the same account
 * are two records and one switching sessions never speaks for the other — which is also why
 * leaving is announced rather than merely stopped.
 */
export function useSessionPresence({ sessionId, sendMessage, isConnected }: UseSessionPresenceInput): void {
  // Only the frame stream is read from the context here; sending stays with the caller's
  // `sendMessage`, so the signature ChatInterface relies on is the whole contract.
  const { subscribe } = useWebSocket();

  // Held in a ref so a new `sendMessage` identity cannot restart the heartbeat or re-announce.
  // Seeded at construction and restated in its own effect — declared FIRST, so the mount
  // announcement below already sends through the identity this render was given.
  const sendRef = useRef(sendMessage);
  useEffect(() => {
    sendRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    if (!isConnected) return undefined;

    const announce = () => {
      sendRef.current({ type: 'chat.presence', sessionId, visible: isVisible() });
    };

    announce();
    document.addEventListener('visibilitychange', announce);
    // A token refresh swaps the socket without `isConnected` ever reading false, so this effect
    // does not re-run — and the server forgot the record with the old socket. The new socket's
    // open is announced as `websocket_reconnected`; restating on it closes a 30 s gap in which a
    // session on screen would still be pushed.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') announce();
    });
    const heartbeat = window.setInterval(() => {
      // A hidden tab lets its record lapse rather than restating "not visible" every 30 s.
      if (isVisible()) announce();
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener('visibilitychange', announce);
      unsubscribe();
      window.clearInterval(heartbeat);
      // A closed socket is forgotten server-side on its own, but a session switch or an
      // unmount inside a live socket has to say so or this tab keeps muting the old session.
      sendRef.current({ type: 'chat.presence', sessionId: null, visible: false });
    };
  }, [isConnected, sessionId, subscribe]);
}
