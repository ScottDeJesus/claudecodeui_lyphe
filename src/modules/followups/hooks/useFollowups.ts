import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, attemptWrite } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { Followup } from '@/shared/types';

/**
 * Whether one element of the answer is an item this module can draw. The array is read OUTSIDE every widget's
 * boundary (`openCount` feeds the badge in `ChatGutterLayout`), so an element that is `null`, or lacks a
 * field the count and the groups read, must be dropped here and never reach a render that would take the whole
 * chat to the workspace's error panel. The server never sends one; a proxy or a stale cache could.
 */
function isFollowup(value: unknown): value is Followup {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'number'
    && typeof item.text === 'string'
    && (item.kind === 'next' || item.kind === 'gap')
    && (item.state === 'open' || item.state === 'done')
  );
}

/** One chat's last good reading, tagged with the chat it was read for. */
type Reading = { sessionId: string; items: Followup[] };

/**
 * The open chat's next steps and known gaps: one read, kept current, and the tick that settles an item.
 *
 * Called ONCE, by `ChatGutterLayout`, which needs the count outside every widget's boundary for the badge and
 * hands the same value to the widget's body through `FollowupsContext` — so the badge and the rows are one reading
 * and can never disagree. `sessionId` is the chat's APP session id (the gutter's own), or `null` while no chat is
 * open or the gutters are not drawn, when nothing is read and nothing is subscribed.
 *
 * A FRAME IS A HINT, NOT A PICTURE. `followups_changed` names the chat it moved, and the answer to one for THIS chat
 * (or to `websocket_reconnected`) is always "read the list again"; a frame for another chat is ignored. The
 * subscription is made BEFORE the first read, so a frame that lands between the two starts its own read rather than
 * being missed. Reads overlap (a frame's, a tick's, the mount's), so each takes a ticket and an answer older than
 * one already applied is dropped — but only an answer that APPLIES moves the ticket forward, so a newer read that
 * failed never makes the hook throw away an older read that answered well.
 *
 * THE READ IS THE LIST. A tick answers the item it changed and the hook puts that answer in place at once, but the
 * frame the write sends is what re-reads the whole list; nothing draws from a guess.
 */
export function useFollowups(sessionId: string | null) {
  const { t } = useTranslation();
  const toast = useToast();
  const { subscribe } = useWebSocket();

  // The last good reading and the chat it was read for. Essential: it is the only copy of the list between reads,
  // and the tag is what keeps one chat's items from ever drawing under another chat after a switch.
  const [reading, setReading] = useState<Reading | null>(null);

  // The chat whose first read failed, while it has no reading. Essential: it turns the body's spinner into the
  // unreachable box with its Try again. A failed read after a good one keeps the list on screen and never sets it.
  const [unreachableFor, setUnreachableFor] = useState<string | null>(null);

  // The chat the subscription below serves, so an answer that lands after a switch is recognised and dropped.
  const sessionRef = useRef<string | null>(null);
  // The newest read that left, and the newest ticket whose answer was applied.
  const newestReadRef = useRef(0);
  const newestAppliedRef = useRef(0);
  // The chat whose reading is held, mirrored so a failed read can tell "never read" from "read once, since failed".
  const readForRef = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (sessionId === null) return;
    const ticket = ++newestReadRef.current;
    let answer: Followup[] | null = null;
    try {
      const response = await api.followups.list(sessionId);
      if (response.ok) {
        const body = (await response.json()) as { data?: unknown };
        if (Array.isArray(body.data)) answer = body.data.filter(isFollowup);
      }
    } catch {
      // This app's own network, or a body that is not JSON — the same "no answer" a refusal leaves behind.
    }
    if (sessionRef.current !== sessionId) return;
    if (answer === null) {
      // Only a chat that has never been read says it could not be; the next frame or Try again reads again.
      if (readForRef.current !== sessionId) setUnreachableFor(sessionId);
      return;
    }
    if (ticket < newestAppliedRef.current) return;
    newestAppliedRef.current = ticket;
    readForRef.current = sessionId;
    setReading({ sessionId, items: answer });
    setUnreachableFor(null);
  }, [sessionId]);

  useEffect(() => {
    sessionRef.current = sessionId;
    if (sessionId === null) return undefined;
    // Subscribed BEFORE the first read, so a frame that lands between the two starts its own read.
    const unsubscribe = subscribe((event) => {
      const namesThisChat = event.kind === 'followups_changed' && event.appSessionId === sessionId;
      if (namesThisChat || event.kind === 'websocket_reconnected') void refresh();
    });
    void refresh();
    return () => {
      unsubscribe();
      sessionRef.current = null;
    };
  }, [sessionId, refresh, subscribe]);

  /** Ticks (`done`) or unticks (`open`) one item. A refusal is a toast carrying the server's own sentence. */
  const setDone = useCallback(async (id: number, done: boolean): Promise<void> => {
    const attempt = await attemptWrite(() => api.followups.setState(id, done ? 'done' : 'open'));
    if (!attempt.landed) {
      toast({ tone: 'warn', title: t('followups.toast.tickFailed'), ...(attempt.sentence === null ? {} : { message: attempt.sentence }) });
      return;
    }
    try {
      const body = (await attempt.response.json()) as { data?: unknown };
      const changed = body.data;
      if (isFollowup(changed)) {
        setReading((current) => (current === null || current.sessionId !== sessionRef.current
          ? current
          : { ...current, items: current.items.map((item) => (item.id === changed.id ? changed : item)) }));
      }
    } catch {
      // The write landed; the frame it sent re-reads the list, which is the truth either way.
    }
  }, [toast, t]);

  const items = reading !== null && reading.sessionId === sessionId ? reading.items : null;

  return useMemo(() => ({
    /** The chat's items, oldest first, open and done; `null` until a read has answered for this chat. */
    items: sessionId === null ? [] : items,
    /** True while this chat has never been read and the last read failed. */
    unreachable: sessionId !== null && items === null && unreachableFor === sessionId,
    /** How many items are open — the widget's badge. */
    openCount: items?.filter((item) => item.state === 'open').length ?? 0,
    refresh,
    setDone,
  }), [sessionId, items, unreachableFor, refresh, setDone]);
}
