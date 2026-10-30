import { useCallback, useEffect, useRef } from 'react';

import { useStation } from '@/modules/station/context/StationContext';
import type { StationFocus } from '@/shared/station-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { companionClientId } from '@/shared/utils';

/**
 * How often a visible station re-states itself: the chat's own rhythm (`useSessionPresence`). The server forgets a record
 * not restated for 90 seconds, so this is freshness, not a check on whether anything died.
 */
const HEARTBEAT_MS = 30_000;

/**
 * The chat the focus is about, or null: a chat, a waiting ask and follow-ups all belong to one. This is the `sessionId` the
 * presence states, so the push channels stay quiet about a chat he is looking at here, as they do for the chat tab.
 */
function sessionOf(focus: StationFocus | null): string | null {
  return focus !== null && (focus.kind === 'chat' || focus.kind === 'ask' || focus.kind === 'followups') ? focus.sessionId : null;
}

/**
 * THE STATION'S PRESENCE: tells the server what this window is showing, as the chat does (`chat.presence` on the one socket),
 * with the station's focus as `view`. Her `<view>` line is read from it the moment he sends her a message, so she knows
 * what he is looking at without being told — a press on the stage never pushes, wakes or spends anything itself.
 *
 * It states `sessionId` (the stage's chat, for a chat, an ask or follow-ups), `visible`, `clientId` (the name this page is
 * known to her by), `focused` (whether the window has the keyboard) and `view` (the focus, or null). It says so as the
 * station mounts, when the page is shown or hidden, when the window gains or loses the keyboard, on each focus change, when
 * the socket reconnects (the server forgot the record with the old socket) and every 30 seconds while visible. Leaving
 * says the window watches nothing any more.
 *
 * Used by `StationRoute`, once, inside the station's provider.
 */
export function useStationPresence(): void {
  const { sendMessage, subscribe, isConnected } = useWebSocket();
  const { focus } = useStation();

  // The newest `sendMessage`, so a new identity from the socket's provider never restarts the heartbeat. Seeded at
  // construction and restated in its own effect, declared first, so the mount announcement below already uses it.
  const sendRef = useRef(sendMessage);
  useEffect(() => {
    sendRef.current = sendMessage;
  }, [sendMessage]);

  // The focus the next announcement states. A ref, not a dependency of the connection effect: a focus change is announced by
  // the effect below, without tearing down the listeners and saying "left" in between.
  const focusRef = useRef(focus);
  // Whether the connection effect is live, i.e. there is a socket to say anything to.
  const liveRef = useRef(false);

  const announce = useCallback(() => {
    const view = focusRef.current;
    sendRef.current({
      type: 'chat.presence',
      sessionId: sessionOf(view),
      visible: document.visibilityState === 'visible',
      clientId: companionClientId(),
      focused: document.hasFocus(),
      view,
    });
  }, []);

  // Each focus change is announced, once, when the socket is up. The first run finds the ref already equal and says nothing:
  // the connection effect's mount announcement is the one that states it.
  useEffect(() => {
    const changed = focusRef.current !== focus;
    focusRef.current = focus;
    if (changed && liveRef.current) announce();
  }, [focus, announce]);

  useEffect(() => {
    if (!isConnected) return undefined;
    liveRef.current = true;
    announce();
    document.addEventListener('visibilitychange', announce);
    window.addEventListener('focus', announce);
    window.addEventListener('blur', announce);
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') announce();
    });
    const heartbeat = window.setInterval(() => {
      // A hidden window lets its record lapse rather than restating "not visible" every 30 s.
      if (document.visibilityState === 'visible') announce();
    }, HEARTBEAT_MS);

    return () => {
      liveRef.current = false;
      document.removeEventListener('visibilitychange', announce);
      window.removeEventListener('focus', announce);
      window.removeEventListener('blur', announce);
      unsubscribe();
      window.clearInterval(heartbeat);
      // Leaving inside a live socket has to say so, or this window goes on muting the chat it showed.
      sendRef.current({ type: 'chat.presence', sessionId: null, visible: false, clientId: companionClientId(), focused: false });
    };
  }, [isConnected, subscribe, announce]);
}
