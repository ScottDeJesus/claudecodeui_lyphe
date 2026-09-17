import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { KanbanMetisSession } from '@/shared/types';

/**
 * THE BOARD'S FLEET, AND THE THREE VERBS OVER A SESSION: every Metis the server has, kept current by
 * the `kanban_metis_state` frame and seeded once by REST when the panel mounts.
 *
 * TWO WAYS IN, AND THEY DO NOT FIGHT. The push is authoritative — every frame is the whole fleet.
 * The seed exists for the gap the push cannot cover: the server broadcasts on a CHANGE, so a panel
 * mounting while nothing moves would have nothing to paint until the next session started or ended.
 * The seed therefore never overwrites a reading NEWER THAN ITSELF, or a request in flight while a
 * frame arrives would land after it and put the older picture back on screen. A reconnect re-seeds,
 * because frames were missed while the socket was down and the lane only speaks on change.
 *
 * NO INTERVAL OF ITS OWN. The server already reads its own disk and pushes on change; a timer here
 * would be a second poll of the same facts, doubling the work for no freshness.
 *
 * A REFUSED VERB IS SAID OUT LOUD. The three verbs are refused in words the screen cannot show — the
 * board already has a running Metis, or the key its child needs is missing — so a refusal raises a
 * toast carrying the server's own sentence, rather than leaving a button that appears to have done
 * nothing.
 *
 * THE READING IS THE SERVER'S; THE BOARD IS THE PANEL'S QUESTION ABOUT IT. What is held is the fleet
 * as the last picture had it — every board's sessions — and this board's share is DERIVED at the
 * bottom. Switching boards therefore filters a picture already in hand instead of re-reading it, and
 * a session belonging to another board can never be drawn in this panel.
 *
 * Called ONCE, by `KanbanMetisPanel`.
 */

/** The seed's body, read defensively: a body that is not the shape expected is an unknown fleet,
 *  never a crash. `at` is the server's own stamp for the picture. */
type FleetBody = { sessions?: unknown; at?: unknown };

/**
 * THE SERVER'S OWN SENTENCE for a refusal, read off the body before anything else touches it. These
 * verbs refuse in words — 409 "this board already has a running Metis session", 503 "no DeepSeek
 * key" — and those words are the whole of what the reader needs. They cannot arrive through the
 * throw: `readApiJson` builds its `Error` over the `{ code, message }` object, so `message` there
 * reads "[object Object]". `undefined` when there is nothing legible to say, and the toast then
 * falls back to its title alone.
 */
async function refusalReason(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string; details?: unknown };
    if (typeof body.error === 'string') return body.error || undefined;
    const message = body.error?.message;
    if (typeof message === 'string' && message) return message;
    return typeof body.details === 'string' && body.details ? body.details : undefined;
  } catch {
    return undefined;
  }
}

export type KanbanMetis = {
  /** This board's sessions, in the server's own order — oldest first. */
  sessions: KanbanMetisSession[];
  /** True only until the first picture lands: the seed answering, or a frame beating it here. */
  loading: boolean;
  /** Asks the driver to put a Metis on this board. */
  launch: () => void;
  /** Asks the driver to end one session. */
  stop: (sessionId: string) => void;
  /** Asks the driver to carry one session's conversation on. */
  resume: (sessionId: string) => void;
};

export function useKanbanMetis(boardId: string): KanbanMetis {
  const { t } = useTranslation();
  // A REFUSED VERB IS SAID OUT LOUD. The three verbs refuse in words the reader cannot derive from
  // the screen — the board already has a running Metis, or the key its child needs is missing — and
  // a button that silently did nothing reads as a broken button. The module's board writes answer
  // the same class of failure the same way (`useKanbanBoards`'s `failBoardWrite`).
  const toast = useToast();
  // The one socket. Subscribed to below and never opened here: the provider owns the connection.
  const { subscribe } = useWebSocket();

  // The fleet as the last picture had it. Essential: it is the whole of what the panel draws, and
  // the seed and the frame are two writers to it.
  const [sessions, setSessions] = useState<KanbanMetisSession[]>([]);
  // True until the first picture lands. Essential: an unread fleet and an empty one are different
  // news, and nothing in the sessions array can tell them apart.
  const [loading, setLoading] = useState(true);

  // The stamp of the last picture the SERVER sent, 0 before any. A ref, not state: the seed's guard
  // reads it inside an async tail and nothing about the drawing depends on it.
  const atRef = useRef(0);
  // A response landing after the panel is gone must not set state on a component that is gone. Set
  // true on mount rather than once at declaration, so a remount starts from the truth.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // What is IN FLIGHT, keyed by what it addresses: a session id for stop and resume, the board id
  // for a launch. Essential: the row's buttons and the header's Launch stay live until the next
  // frame lands, so a second press would otherwise send one SIGTERM over another, or start a second
  // child on a conversation one is already resuming.
  const busyRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Guards the seed's async tail across the effect's own teardown: an answer landing after the
    // panel unmounted must not paint a fleet this hook no longer shows.
    let cancelled = false;

    // One picture, from either way in. `guarded` is the seed's: a reading at least as new as its own
    // is already on screen, so the older one is dropped rather than written.
    const apply = (next: KanbanMetisSession[], at: number, guarded: boolean): void => {
      if (guarded && atRef.current >= at) return;
      atRef.current = at;
      setSessions(next);
      setLoading(false);
    };

    const seed = async (): Promise<void> => {
      try {
        const body = await readApiJson<FleetBody>(await api.kanbanMetis.sessions());
        if (cancelled || !mountedRef.current) return;
        apply(
          Array.isArray(body.sessions) ? (body.sessions as KanbanMetisSession[]) : [],
          typeof body.at === 'number' ? body.at : Date.now(),
          true,
        );
      } catch (error) {
        // A seed that could not be read is a GAP, not a failure: the frame fills it, and the panel's
        // own retry is a reload of the tab. The spinner must still end — a fleet nothing could be
        // read from is an EMPTY fleet here, which is the honest reading: nothing is known to be
        // running. The sessions already held are kept, because a blip must not blank a live fleet.
        console.warn('[useKanbanMetis] the fleet could not be read:', error);
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    };

    const unsubscribe = subscribe((event) => {
      // A reconnect means frames were missed while the socket was down, and this lane broadcasts
      // only on a CHANGE — so a session that started or ended during the outage would otherwise
      // stay invisible until the fleet moved again. Re-seeding closes exactly that gap.
      if (event.kind === 'websocket_reconnected') {
        void seed();
        return;
      }
      if (event.kind !== 'kanban_metis_state') return;
      if (!Array.isArray(event.sessions)) return;
      apply(
        event.sessions as KanbanMetisSession[],
        typeof event.at === 'number' ? event.at : Date.now(),
        false,
      );
    });

    void seed();

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // ONCE PER MOUNT, and deliberately not per board: the reading is the WHOLE FLEET — every board's
    // sessions — so a board switch is a question asked of a picture already in hand, and re-seeding
    // on it would be a request per tab press for facts the panel is holding.
  }, [subscribe]);

  /** One returned session placed into the reading: replaced where its id is already known, appended
   *  otherwise. Never a re-read — the verb's own answer is the newest truth about that session. */
  const place = useCallback((session: KanbanMetisSession) => {
    setSessions((held) => {
      const index = held.findIndex((other) => other.sessionId === session.sessionId);
      if (index === -1) return [...held, session];
      const next = [...held];
      next[index] = session;
      return next;
    });
  }, []);

  /**
   * ONE PRESS, ONE REQUEST. Every verb below goes through here, because each is a thing the server
   * must not be asked twice for while the first ask is unanswered: Stop two TIMEs over a SIGKILL,
   * Resume two children on one conversation, Launch two Metis on one board.
   *
   * AND A REFUSAL IS SAID, NOT SWALLOWED. `refusalKey` is the sentence the reader gets — the verb
   * they pressed, in the negative — and the server's own words ride under it as the message when its
   * body carries any. A network failure has no sentence to show, so it gets the title alone.
   */
  const verb = useCallback(
    (key: string, call: () => Promise<Response>, refusalKey: string): void => {
      if (busyRef.current.has(key)) return;
      busyRef.current.add(key);

      void (async () => {
        try {
          const response = await call();
          // Read before `readApiJson`, which would flatten the refusal into a bare throw: the body
          // is the only place the server's reason is legible.
          if (!response.ok) {
            const said = await refusalReason(response);
            console.warn(`[useKanbanMetis] ${key} was refused (${response.status}):`, said ?? 'no reason given');
            if (mountedRef.current) toast({ tone: 'warn', title: t(refusalKey), message: said });
            return;
          }
          const body = await readApiJson<{ session?: KanbanMetisSession }>(response);
          if (mountedRef.current && body.session) place(body.session);
        } catch (error) {
          console.warn(`[useKanbanMetis] ${key} did not land:`, error);
          if (mountedRef.current) toast({ tone: 'warn', title: t(refusalKey) });
        } finally {
          busyRef.current.delete(key);
        }
      })();
    },
    [place, t, toast],
  );

  const launch = useCallback(() => {
    verb(`launch:${boardId}`, () => api.kanbanMetis.launch(boardId), 'kanban.metis.notLaunched');
  }, [verb, boardId]);

  const stop = useCallback(
    (sessionId: string) => {
      verb(`stop:${sessionId}`, () => api.kanbanMetis.stop(sessionId), 'kanban.metis.notStopped');
    },
    [verb],
  );

  const resume = useCallback(
    (sessionId: string) => {
      verb(`resume:${sessionId}`, () => api.kanbanMetis.resume(sessionId), 'kanban.metis.notResumed');
    },
    [verb],
  );

  // This board's share of the reading, derived rather than kept: a second list would be a second
  // thing to hold in step with the frames.
  const forBoard = useMemo(
    () => sessions.filter((session) => session.boardId === boardId),
    [sessions, boardId],
  );

  return { sessions: forBoard, loading, launch, stop, resume };
}
