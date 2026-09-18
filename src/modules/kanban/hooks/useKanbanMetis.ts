import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { KanbanBoardEvent } from '@/shared/kanban-types';
import type { KanbanMetisSession } from '@/shared/types';

/**
 * THE BOARD'S FLEET, THE VERBS OVER A SESSION, AND THE DIAL THAT CAPS THEM: every Metis the server
 * has, kept current by the `kanban_metis_state` frame and seeded once by REST when the panel mounts.
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
 * A REFUSED VERB IS SAID OUT LOUD. The verbs are refused in words the screen cannot show — the
 * board is at its concurrency dial, or the key its child needs is missing — so a refusal raises a
 * toast carrying the server's own sentence, rather than leaving a button that appears to have done
 * nothing. The person's send is the exception and `MetisOutcome` is why: its surface holds a strip a
 * refusal belongs in, so the sentence is handed back to the caller instead of toasted over it.
 *
 * THE DIAL IS READ, NEVER GUESSED. The panel's header divides this board's live count by the cap it
 * may run, and that cap is a column on the board's row which the driver reads at CALL time — so it
 * comes from the driver's own reading: once per board, and again when a `board.updated` frame says
 * somebody moved it. Never `0`: an unreadable reading is `null`, an UNKNOWN cap, because zero is a
 * board switched off and the header would refuse every launch on a board open for work.
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
 * verbs refuse in words — 409 naming the board's own dial (`canSpawn`'s own sentence,
 * e.g. "this board is at its dial of 1 — 1 session is running…"), 503 "no DeepSeek
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

/**
 * WHAT A VERB ANSWERS A CALLER THAT HAS SOMEWHERE TO PUT THE NEWS: `landed`, and the fleet already
 * carries whatever the route returned. `refused` carries ONE sentence — the server's own words when
 * the body held any, the verb's own title when it did not — so a caller that draws it has something
 * to draw either way. `busy` is NOT a refusal: a second press arrived while the first ask was out
 * and the guard dropped it, so nothing was sent and a caller told "refused" would draw a refusal for
 * a press nobody made.
 */
export type MetisOutcome =
  | { status: 'landed' }
  | { status: 'refused'; reason: string }
  | { status: 'busy' };

export type KanbanMetis = {
  /** This board's sessions, in the server's own order — oldest first. */
  sessions: KanbanMetisSession[];
  /** True only until the first picture lands: the seed answering, or a frame beating it here. */
  loading: boolean;
  /** This board's dial — the cap the driver reads off its row. `null` while there is no reading OF
   *  THIS BOARD: one not yet asked for, or one that could not be fetched. Both draw as the plain
   *  count, which is the point: only a reading taken for this board may cap it. */
  dial: number | null;
  /** Asks the driver to put a Metis on this board. */
  launch: () => void;
  /** Asks the driver to end one session. */
  stop: (sessionId: string) => void;
  /** Asks the driver to carry one session's conversation on. */
  resume: (sessionId: string) => void;
  /** Carries one session's conversation on with a PERSON's words as the turn she wakes up to. The
   *  one verb a row never has, and the one that hands its refusal back instead of toasting it. */
  reply: (sessionId: string, text: string) => Promise<MetisOutcome>;
  /** Wakes this board's driver now rather than at its next tick. */
  nudge: () => Promise<MetisOutcome>;
};

export function useKanbanMetis(boardId: string): KanbanMetis {
  const { t } = useTranslation();
  // A REFUSED VERB IS SAID OUT LOUD. The verbs refuse in words the reader cannot derive from
  // the screen — the board is at its concurrency dial, or the key its child needs is missing — and
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

  // The reading, WITH the board it was taken for — and the pairing is the whole point of the shape.
  // Essential: the header's figure is the live count AGAINST this number, and this hook OUTLIVES a
  // board switch (`KanbanPanel` re-renders the panel with a new `boardId` and no `key`), so a bare
  // number would be painted against whichever board is on screen — the board just left, divided into
  // this board's live count, disabling its Launch with a title that is false for it. Tagged, a
  // reading belongs to the board that asked for it and to no other; see where `dial` is derived.
  const [dialRead, setDialRead] = useState<{ boardId: string; value: number | null } | null>(null);

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
  // What is IN FLIGHT, keyed by what it addresses: a session id for stop, resume and the person's
  // send; the board id for a launch and a wake. Essential: the row's buttons, the header's Nudge and
  // Launch, and the composer's Send all stay live until the next frame lands, so a second press
  // would otherwise send one SIGTERM over another, start a second child on a conversation one is
  // already resuming, or wake the driver once per repeat of a held bolt.
  const busyRef = useRef<Set<string>>(new Set());

  // The board this panel is on NOW, for the subscription's dial branch: the effect below mounts ONCE
  // (its comment says why), so it cannot close over `boardId` without re-seeding the fleet on every
  // board switch, which is the one thing it must never do.
  const boardRef = useRef(boardId);
  useEffect(() => {
    boardRef.current = boardId;
  });

  // The newest dial ask. Two reads can settle out of order — a switch and the `board.updated` frame
  // that follows it, say — so the answer to an ask that is no longer the newest is DROPPED rather
  // than written over a newer one. The fleet's own seed keeps the same discipline (`atRef`): the tag
  // above is about OWNERSHIP, this counter about ORDER, and neither alone is enough.
  const dialAskRef = useRef(0);

  /** The dial, out of the driver's reading — `null` for one that could not be read. */
  const readDial = useCallback(async (id: string): Promise<void> => {
    const ask = ++dialAskRef.current;
    try {
      const body = await readApiJson<{ concurrency?: unknown }>(await api.kanbanMetis.driver(id));
      if (ask !== dialAskRef.current || !mountedRef.current) return;
      setDialRead({ boardId: id, value: typeof body.concurrency === 'number' ? body.concurrency : null });
    } catch (error) {
      // An unreadable reading is an UNKNOWN cap, never a zero; see the module comment.
      console.warn('[useKanbanMetis] the driver reading could not be read:', error);
      if (ask !== dialAskRef.current || !mountedRef.current) return;
      setDialRead({ boardId: id, value: null });
    }
  }, []);

  // Per board, and never per frame: a fleet frame says nothing about the cap, so re-reading on one
  // would be a request per session start for a number that did not move. Nothing is cleared here —
  // the reading for the board just left stays tagged with it, so the board now on screen simply has
  // none until its own lands, from the first render after the switch rather than a pass later.
  useEffect(() => {
    void readDial(boardId);
  }, [readDial, boardId]);

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
      // A board write can move the dial — it is that board's own column — so the ONE frame that can
      // change the number this header divides by re-reads it. Every other frame is left alone.
      if (event.kind === 'kanban_event') {
        const frame = event as unknown as KanbanBoardEvent;
        if (frame.boardId === boardRef.current && frame.event?.kind === 'board.updated') {
          void readDial(boardRef.current);
        }
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
    // on it would be a request per tab press for facts the panel is holding. `readDial` is in the
    // list because the branch above calls it, and it is stable — an empty dep list of its own — so
    // it cannot re-run this effect.
  }, [subscribe, readDial]);

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
   * Resume two children on one conversation, Launch two Metis on one board. The key IS the in-flight
   * flag — one per thing being asked for, cleared when its ask settles.
   *
   * AND A REFUSAL IS SAID, NOT SWALLOWED. `title` is the sentence the reader gets — the verb they
   * pressed, in the negative — with the server's own words under it when its body carries any. A
   * `speak` of `false` raises no toast: the composer draws its own refusal in its own strip, and a
   * second voice over the same send would be noise. The answer comes back either way.
   */
  const verb = useCallback(
    async (
      key: string,
      call: () => Promise<Response>,
      title: string,
      speak = true,
    ): Promise<MetisOutcome> => {
      // Not a refusal: a second press while the first ask is still out, which nothing was sent for.
      if (busyRef.current.has(key)) return { status: 'busy' };
      busyRef.current.add(key);

      try {
        const response = await call();
        // Read before `readApiJson`, which would flatten the refusal into a bare throw: the body
        // is the only place the server's reason is legible.
        if (!response.ok) {
          const said = await refusalReason(response);
          console.warn(`[useKanbanMetis] ${key} was refused (${response.status}):`, said ?? 'no reason given');
          if (mountedRef.current && speak) toast({ tone: 'warn', title, message: said });
          return { status: 'refused', reason: said ?? title };
        }
        const body = await readApiJson<{ session?: KanbanMetisSession }>(response);
        if (mountedRef.current && body.session) place(body.session);
        return { status: 'landed' };
      } catch (error) {
        console.warn(`[useKanbanMetis] ${key} did not land:`, error);
        if (mountedRef.current && speak) toast({ tone: 'warn', title });
        return { status: 'refused', reason: title };
      } finally {
        busyRef.current.delete(key);
      }
    },
    [place, toast],
  );

  const launch = useCallback(() => {
    void verb(`launch:${boardId}`, () => api.kanbanMetis.launch(boardId), t('kanban.metis.notLaunched'));
  }, [verb, boardId, t]);

  const stop = useCallback(
    (sessionId: string) => {
      void verb(`stop:${sessionId}`, () => api.kanbanMetis.stop(sessionId), t('kanban.metis.notStopped'));
    },
    [verb, t],
  );

  const resume = useCallback(
    (sessionId: string) => {
      void verb(`resume:${sessionId}`, () => api.kanbanMetis.resume(sessionId), t('kanban.metis.notResumed'));
    },
    [verb, t],
  );

  // `resume` with a person's words as the opening turn: the same `{ session }` lands, and the row
  // repaints the same way. `speak` is `false` — the conversation that sends it has a strip to draw
  // the refusal in, so this one sentence is handed back rather than said twice.
  const reply = useCallback(
    (sessionId: string, text: string): Promise<MetisOutcome> =>
      verb(
        `send:${sessionId}`,
        () => api.kanbanMetis.reply(sessionId, text),
        t('kanban.metis.notReplied', { defaultValue: 'Your words did not reach her' }),
        false,
      ),
    [verb, t],
  );

  // Woken now instead of at the driver's next tick, and toasted like the row verbs: a bolt in a
  // header has nowhere to put a sentence.
  const nudge = useCallback(
    (): Promise<MetisOutcome> =>
      verb(
        `wake:${boardId}`,
        () => api.kanbanMetis.nudge(boardId),
        t('kanban.metis.notNudged', { defaultValue: 'The driver was not woken' }),
      ),
    [verb, boardId, t],
  );

  // This board's share of the reading, derived rather than kept: a second list would be a second
  // thing to hold in step with the frames.
  const forBoard = useMemo(
    () => sessions.filter((session) => session.boardId === boardId),
    [sessions, boardId],
  );

  // This board's dial, and only a reading TAKEN for it — a cap read for the board just left is not
  // this board's number. It is not this board's ZERO either: an unknown cap draws the plain count,
  // where a cap of zero would say the board is switched off and refuse every launch on it.
  const dial = dialRead !== null && dialRead.boardId === boardId ? dialRead.value : null;

  return { sessions: forBoard, loading, dial, launch, stop, resume, reply, nudge };
}
