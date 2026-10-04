import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/**
 * The open chat's CLI (provider) session id — the id the launcher stamps into every launch it mints
 * (`launched_by`), and NOT the app's own session id the client addresses the chat by. The two are
 * different strings for every chat created through the app; the session list the client holds does
 * not carry the CLI one, so it is asked for (`GET /sessions/:id`, whose `providerSessionId` is `null`
 * in a 200 for a chat with no turn yet — never the 409 the `provider-id` route answers, which the
 * browser logs as a console error on every empty chat) and kept current from the `session_upserted`
 * frame the server broadcasts the instant a run captures it.
 *
 * `null` while the provider has not reported an id yet — a brand-new chat before its first turn —
 * and for an id the server does not know. `null` anchors nothing
 * (`readStampedLaunchIds`), which is the safe reading: the chat simply shows no stamped launches
 * until the id lands, and the frame that carries it lands the id with no refetch.
 *
 * Used by `ChatInterface`, which hands it to the strip and publishes it for the gutter's widget.
 */
export function useCliSessionId(appSessionId: string | null): string | null {
  const { subscribe } = useWebSocket();
  // The id the server reported, TAGGED with the app session it belongs to: the value is held in
  // state because the provider mints it mid-run and only the server knows it, and the tag lets a
  // switch to another chat read as `null` for that one frame instead of showing the previous
  // chat's id as this one's.
  const [resolved, setResolved] = useState<{ appSessionId: string; cliSessionId: string } | null>(null);

  useEffect(() => {
    if (!appSessionId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await api.sessionDetails(appSessionId);
        const payload = await response.json();
        const cliSessionId: unknown = payload?.data?.providerSessionId;
        if (!cancelled && response.ok && typeof cliSessionId === 'string' && cliSessionId) {
          setResolved({ appSessionId, cliSessionId });
        }
      } catch (error) {
        // A non-2xx answer is not an exception (an unknown id, handled above); this is the network
        // failing, and the next `websocket_reconnected` asks again.
        console.warn('[useCliSessionId] could not read the CLI session id for', appSessionId, error);
      }
    };
    void load();

    const unsubscribe = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') {
        // A frame announcing the id may have been missed while the socket was down.
        void load();
        return;
      }
      if (
        event.kind === 'session_upserted'
        && event.sessionId === appSessionId
        && typeof event.providerSessionId === 'string'
        && event.providerSessionId
      ) {
        setResolved({ appSessionId, cliSessionId: event.providerSessionId });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [appSessionId, subscribe]);

  return resolved !== null && resolved.appSessionId === appSessionId ? resolved.cliSessionId : null;
}
