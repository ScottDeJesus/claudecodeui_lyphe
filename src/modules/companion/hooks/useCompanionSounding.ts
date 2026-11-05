import { useEffect, useRef } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';

/** What this page last told the server (and so what the server holds against its socket). */
type Sounding = { press: boolean; voice: boolean };

const SILENT: Sounding = { press: false, voice: false };

/**
 * Used once by CompanionProvider: tells the server, on the one socket and on change only, whether this page has a press of his
 * open (the talk button recording, her name opening a recording, or a clip out for transcription) and whether her voice is
 * still sounding. The server's dev supervisor holds a restart for a builder's save while either is true, so a restart never
 * lands in the middle of a sentence of his or hers (`modules/restart-hold`).
 *
 * `voice` is already the floor page's alone (only the page holding the floor plays), and the talk button is any page's, so
 * nothing here asks who holds the floor. The ears merely LISTENING for her name are not a press: with the switch on that mic is
 * open all day, and reporting it would hold every restart for ever.
 *
 * The server keeps this against the socket and drops it when the socket closes, so a page that goes away needs no goodbye; one
 * that unmounts while its socket lives says idle on the way out, and a new socket (a token refresh) is told again when it opens.
 */
export function useCompanionSounding(now: Sounding): void {
  const { sendMessage, isConnected, subscribe } = useWebSocket();
  const sendRef = useRef(sendMessage);
  const nowRef = useRef(now);
  const toldRef = useRef(SILENT);

  useEffect(() => {
    sendRef.current = sendMessage;
    nowRef.current = now;
  });

  const { press, voice } = now;
  useEffect(() => {
    if (!isConnected) return;
    const told = toldRef.current;
    if (told.press === press && told.voice === voice) return;
    toldRef.current = { press, voice };
    sendRef.current({ type: 'companion.sounding', press, voice });
  }, [isConnected, press, voice]);

  // A new socket starts with nothing told: the server dropped this page's state with the old one.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.kind !== 'websocket_reconnected') return;
        toldRef.current = nowRef.current;
        if (nowRef.current.press || nowRef.current.voice) sendRef.current({ type: 'companion.sounding', ...nowRef.current });
      }),
    [subscribe],
  );

  // Unmounting inside a live socket (the workspace and the station each mount a provider) must not leave the server holding a press that no page has.
  useEffect(
    () => () => {
      if (toldRef.current.press || toldRef.current.voice) sendRef.current({ type: 'companion.sounding', ...SILENT });
      toldRef.current = SILENT;
    },
    [],
  );
}
