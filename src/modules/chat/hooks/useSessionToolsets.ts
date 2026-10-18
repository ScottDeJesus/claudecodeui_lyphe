import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { api, errorMessage } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { SessionToolsetsView, ToolsetSwitchResult } from '@/shared/toolset-types';

/** The hook's answer: the chat's view, the one switch in flight, the last switch's answer, and the last failure. */
export type SessionToolsetsState = {
  /** The chat's sets as the box last said them; `null` while inert or until a read answers. */
  view: SessionToolsetsView | null;
  /** The set whose switch is out, or `null`. One at a time. */
  pendingSet: string | null;
  /** What the last switch answered, kept until the next one answers. */
  lastResult: ToolsetSwitchResult | null;
  /** The server's own sentence for the last switch it refused, cleared by the next press. */
  error: string | null;
  /** Switches one set on or off by name. Never rejects: a failure lands in `error`. */
  toggle(set: string, on: boolean): Promise<void>;
};

/** Everything the hook holds, tagged with the chat it was read for. */
type Held = Omit<SessionToolsetsState, 'toggle'> & { sessionId: string | null };

const NOTHING_HELD: Held = { sessionId: null, view: null, pendingSet: null, lastResult: null, error: null };

/** Held state for a chat, starting empty when the state on hand belongs to another one. */
function heldFor(held: Held, sessionId: string): Held {
  return held.sessionId === sessionId ? held : { ...NOTHING_HELD, sessionId };
}

/**
 * Whether an answer is a chat's view as far as the model menu and the section read it. They draw from
 * `sets` and `strays` at every render of the composer, so a wrong-shaped 2xx (a proxy's, a future shape
 * change) must be refused here and never reach them: it would take the whole chat pane down.
 */
function isSessionToolsetsView(value: unknown): value is SessionToolsetsView {
  if (typeof value !== 'object' || value === null) return false;
  const { sets, strays } = value as { sets?: unknown; strays?: unknown };
  return Array.isArray(strays)
    && Array.isArray(sets)
    && sets.every((set) => typeof set === 'object' && set !== null && Array.isArray((set as { servers?: unknown }).servers));
}

/** The same, for a switch's answer: the section reads its `servers` and the view it carries. */
function isToolsetSwitchResult(value: unknown): value is ToolsetSwitchResult {
  if (typeof value !== 'object' || value === null) return false;
  const { servers, view } = value as { servers?: unknown; view?: unknown };
  return Array.isArray(servers) && isSessionToolsetsView(view);
}

/**
 * The `data` of one tool-set request's `{ success: true, data }` answer, once `isShape` accepts it. A
 * failure is an Error whose message is the sentence the section prints after "Not updated:": the server's
 * own when its envelope carried one, else ours. Never the engine's ("Unexpected token '<'", "Failed to
 * fetch"), which the operator cannot act on.
 */
async function readToolsetsAnswer<T>(
  send: Promise<Response>,
  isShape: (value: unknown) => value is T,
  t: TFunction,
): Promise<T> {
  let response: Response;
  try {
    response = await send;
  } catch {
    // No answer at all: the network, an aborted request, or the deadline.
    throw new Error(t('composer.toolsets.noAnswer', { defaultValue: 'CloudCLI did not answer.' }));
  }
  let body: { success?: unknown; data?: unknown; error?: unknown; details?: unknown } | null = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: a proxy's error page, or an empty body. The status below is all there is to say.
  }
  if (response.ok && body?.success === true && isShape(body.data)) return body.data;
  throw new Error(
    errorMessage(body?.error)
      ?? errorMessage(body?.details)
      ?? t('composer.toolsets.badAnswer', {
        status: response.status,
        defaultValue: 'CloudCLI answered {{status}}, and its answer could not be read.',
      }),
  );
}

/**
 * Used by chat's ChatInterface, which hands the answer to the composer's model menu (through
 * ChatComposer) so the menu can show which of the box's tool sets are on for the open chat and switch one.
 *
 * INERT unless the chat is a Claude chat with a session id: no read, no subscription, `view` null.
 *
 * EVENT-DRIVEN, never timed. Every switch that changed a row, the operator's press or the model's own
 * `toolset` in Bash mid-turn, sends one `session_toolsets_changed` frame naming the chat, and the hook
 * reads again on it, and on `websocket_reconnected` for the frames it missed while the socket was down.
 *
 * The answer's identity changes only when a read or a switch lands (or the chat changes), because the
 * model menu that receives it is memoized.
 */
export function useSessionToolsets(sessionId: string | null, provider: string): SessionToolsetsState {
  const { subscribe } = useWebSocket();
  const { t } = useTranslation('chat');
  const heldSessionId = provider === 'claude' && sessionId ? sessionId : null;

  // The translator of the LATEST render, read through a ref: `read` and `toggle` keep one identity (the
  // menu is memoized on the answer, and `read` is in the subscription's deps), so neither closes over `t`.
  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  }, [t]);

  // The one copy of what the server last said about the chat, plus the press and the refusal. Essential:
  // nothing else holds it between reads. It carries its chat's id so that moving to another chat reads as
  // empty at once, never as the previous chat's sets for the frame before the first read lands.
  const [held, setHeld] = useState<Held>(NOTHING_HELD);

  // The chat the hook is reading for RIGHT NOW, mirrored for the answers that land later: a read or a
  // switch that returns after the chat changed (or the hook went away) names a chat nobody is showing.
  const sessionRef = useRef<string | null>(null);
  // Which read this is. Reads overlap (a frame's, the mount's, a switch's own), so each takes a ticket.
  const newestTicketRef = useRef(0);
  // The newest ticket that has ANSWERED. An older answer landing after it is dropped, so the view never
  // goes backwards; a newer read that fails drops nothing, so a good older answer still stands.
  const newestAnsweredRef = useRef(0);
  // The switch that is out, or null. The hook has one `pendingSet`, so a second press would take the first
  // one's spinner away before its answer came back. It is a token rather than a flag, and it is let go when
  // the chat changes: a switch still out for the chat that was left must not swallow the press of the next.
  const switchingRef = useRef<object | null>(null);

  /** Reads the chat's view and publishes it unless the chat changed or a newer read already answered. */
  const read = useCallback(async (forSession: string): Promise<void> => {
    const ticket = ++newestTicketRef.current;
    let view: SessionToolsetsView;
    try {
      view = await readToolsetsAnswer(api.toolsets.read(forSession), isSessionToolsetsView, tRef.current);
    } catch (failure) {
      // The last good view stands; the next frame or reconnect reads again.
      console.warn(`[tool sets] could not read the sets of chat ${forSession}:`, failure);
      return;
    }
    if (sessionRef.current !== forSession || ticket < newestAnsweredRef.current) return;
    newestAnsweredRef.current = ticket;
    setHeld((current) => ({ ...heldFor(current, forSession), view }));
  }, []);

  useEffect(() => {
    sessionRef.current = heldSessionId;
    if (heldSessionId === null) return undefined;
    // Subscribed BEFORE the first read: a frame that lands between the two starts its own read rather
    // than being missed, and the tickets above keep their answers in order.
    const unsubscribe = subscribe((event) => {
      const namesThisChat = event.kind === 'session_toolsets_changed' && event.sessionId === heldSessionId;
      if (namesThisChat || event.kind === 'websocket_reconnected') void read(heldSessionId);
    });
    void read(heldSessionId);
    return () => {
      unsubscribe();
      sessionRef.current = null;
      switchingRef.current = null;
      // Frames for this chat are not heard from here on, so what was held would be a stale picture the
      // moment the chat came back; it is dropped now and the next read starts from nothing.
      setHeld(NOTHING_HELD);
    };
  }, [heldSessionId, read, subscribe]);

  const toggle = useCallback(async (set: string, on: boolean): Promise<void> => {
    if (heldSessionId === null || switchingRef.current !== null) return;
    const thisSwitch = {};
    switchingRef.current = thisSwitch;
    // Taken when the press leaves, so a read that started after it outranks the answer's view while the
    // answer's `lastResult` still lands: the frame this switch raises starts such a read.
    const ticket = ++newestTicketRef.current;
    setHeld((current) => ({ ...heldFor(current, heldSessionId), pendingSet: set, error: null }));

    let result: ToolsetSwitchResult | null = null;
    let refusal = '';
    try {
      result = await readToolsetsAnswer(api.toolsets.set(heldSessionId, set, on), isToolsetSwitchResult, tRef.current);
    } catch (failure) {
      // `readToolsetsAnswer` throws an Error carrying the sentence to show.
      refusal = failure instanceof Error ? failure.message : String(failure);
      console.warn(`[tool sets] switching ${set} ${on ? 'on' : 'off'} for chat ${heldSessionId} did not land:`, failure);
    } finally {
      if (switchingRef.current === thisSwitch) switchingRef.current = null;
    }
    if (sessionRef.current !== heldSessionId) return;

    if (result === null) {
      setHeld((current) => ({ ...heldFor(current, heldSessionId), pendingSet: null, error: refusal }));
      // A refusal can mean the box's file changed under the menu, and no frame says so: read again.
      void read(heldSessionId);
      return;
    }
    const answered = result;
    const viewStands = ticket >= newestAnsweredRef.current;
    if (viewStands) newestAnsweredRef.current = ticket;
    setHeld((current) => {
      const mine = heldFor(current, heldSessionId);
      return { ...mine, view: viewStands ? answered.view : mine.view, lastResult: answered, pendingSet: null, error: null };
    });
  }, [heldSessionId, read]);

  return useMemo<SessionToolsetsState>(() => {
    const mine = heldSessionId !== null && held.sessionId === heldSessionId ? held : NOTHING_HELD;
    return { view: mine.view, pendingSet: mine.pendingSet, lastResult: mine.lastResult, error: mine.error, toggle };
  }, [held, heldSessionId, toggle]);
}
