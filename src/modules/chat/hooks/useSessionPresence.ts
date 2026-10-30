import { useEffect, useRef, useState } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { companionClientId } from '@/shared/utils';

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
 * Whether the document the chat is drawn in is on screen. It is the HOST document's answer, not the
 * opener's: a chat floated into a picture-in-picture window is being read while its opener sits
 * hidden behind another tab.
 *
 * `document.hasFocus()` is the wrong question twice over: a visible window sitting behind
 * another one is still being read, and it answers false in headless Chromium, which would
 * make every verification run look unwatched.
 */
const isVisible = (hostDocument: Document) => hostDocument.visibilityState === 'visible';

/**
 * Whether the window the chat is drawn in has the keyboard. It is the HOST window's answer, and it is what separates two windows
 * on two monitors that are both visible: the server uses it to pick the page that speaks for his screen when none holds her
 * floor. Never a reading of visibility (`isVisible` is that), and false in headless Chromium, which only costs the tiebreak.
 */
const isFocused = (hostDocument: Document) => hostDocument.hasFocus();

/**
 * THE ONE DEFINITION OF "THE OPERATOR IS LOOKING AT THE SESSION": the chat is on screen (`isActive` —
 * the Chat tab shown, or the chat floating) and the host document is visible. It is the pair the
 * server's presence record is built from (`ChatInterface` passes the session only while `isActive`,
 * and `announce` states the document's visibility), exposed here as a boolean so the scroll follow and
 * the return-to-where-they-replied read the very same answer instead of a second guess at it.
 *
 * Used by ChatInterface, which hands the result to the session state hook. State, not a ref: coming
 * back is a transition the hook's effects must hear.
 */
export function useIsLookingAtSession(isActive: boolean): boolean {
  const hostWindow = useHostWindow();
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => isVisible(hostWindow.document));

  useEffect(() => {
    const hostDocument = hostWindow.document;
    const sync = () => setIsDocumentVisible(isVisible(hostDocument));
    // A move to another window reads that window's document at once: it may already be hidden.
    sync();
    hostDocument.addEventListener('visibilitychange', sync);
    return () => hostDocument.removeEventListener('visibilitychange', sync);
  }, [hostWindow]);

  return isActive && isDocumentVisible;
}

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
  const hostWindow = useHostWindow();

  // Held in a ref so a new `sendMessage` identity cannot restart the heartbeat or re-announce.
  // Seeded at construction and restated in its own effect — declared FIRST, so the mount
  // announcement below already sends through the identity this render was given.
  const sendRef = useRef(sendMessage);
  useEffect(() => {
    sendRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    if (!isConnected) return undefined;

    const hostDocument = hostWindow.document;
    // `clientId` names this page to the server (it is the id Kaylee's floor is held under) and `focused` says whether its window
    // has the keyboard: together they let the server find the page he last talked to her from.
    const announce = () => {
      sendRef.current({
        type: 'chat.presence',
        sessionId,
        visible: isVisible(hostDocument),
        clientId: companionClientId(),
        focused: isFocused(hostDocument),
      });
    };

    announce();
    hostDocument.addEventListener('visibilitychange', announce);
    // Moving the keyboard between windows changes which page speaks for his screen, and no heartbeat is owed to say so.
    hostWindow.addEventListener('focus', announce);
    hostWindow.addEventListener('blur', announce);
    // A token refresh swaps the socket without `isConnected` ever reading false, so this effect
    // does not re-run — and the server forgot the record with the old socket. The new socket's
    // open is announced as `websocket_reconnected`; restating on it closes a 30 s gap in which a
    // session on screen would still be pushed.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') announce();
    });
    // The heartbeat stays on the opener's own clock even while the chat floats: it paces the server's
    // 90 s expiry, not anything the reader sees, so a throttled opener timer (still well inside the
    // expiry) costs nothing, and a heartbeat armed on a window that closes would die with it.
    const heartbeat = window.setInterval(() => {
      // A hidden tab lets its record lapse rather than restating "not visible" every 30 s.
      if (isVisible(hostDocument)) announce();
    }, HEARTBEAT_MS);

    return () => {
      hostDocument.removeEventListener('visibilitychange', announce);
      hostWindow.removeEventListener('focus', announce);
      hostWindow.removeEventListener('blur', announce);
      unsubscribe();
      window.clearInterval(heartbeat);
      // A closed socket is forgotten server-side on its own, but a session switch or an
      // unmount inside a live socket has to say so or this tab keeps muting the old session.
      sendRef.current({ type: 'chat.presence', sessionId: null, visible: false, clientId: companionClientId(), focused: false });
    };
  // `hostWindow`: a move to another window re-runs this, which announces the new document's
  // visibility (the cleanup first says the old one has left).
  }, [hostWindow, isConnected, sessionId, subscribe]);
}
