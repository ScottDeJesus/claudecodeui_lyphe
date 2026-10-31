import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useCompanion } from '@/modules/companion';
import { useDispatcherPlans } from '@/modules/dispatcher';
import { useLivePending } from '@/modules/station/hooks/useLivePending';
import { needsCountOf } from '@/modules/station/needsCount';
import { api, refusalSentence } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { StationNeed } from '@/shared/station-types';

type StationNeedsContextValue = {
  /** Everything that needs him as the server last answered, in his order. `null` until the first read lands; `[]` is a read that found nothing waiting. */
  needs: StationNeed[] | null;
  /** The kinds the server could not read on the read that `needs` is from: each is left out of `needs`, and the rail says it rather than say "nothing waits". */
  faults: StationNeed['kind'][];
  /**
   * Why the first read failed (the server's own sentence when it gave one): the rail's failed state. Only while `needs` is null. A
   * read that fails after a good one keeps the items on screen and sets nothing here.
   */
  failure: string | null;
  /** The failed state's Try again: the failure gives way to the waiting state while the read is out. */
  reread: () => void;
};

const StationNeedsContext = createContext<StationNeedsContextValue | null>(null);

/** The five kinds the rail has an item for: an item of any other (a server newer than this page's bundle) cannot be drawn, so it is left out of the list and the rest is drawn. */
const NEED_KINDS: ReadonlySet<StationNeed['kind']> = new Set(['accept', 'questions', 'ask', 'followups', 'check']);

/** Whether `kind` is one this page can draw. */
const isNeedKind = (kind: unknown): kind is StationNeed['kind'] => typeof kind === 'string' && NEED_KINDS.has(kind as StationNeed['kind']);

/** Whether `item` is a need this page can draw: an object of a known kind with an id. */
const isDrawableNeed = (item: unknown): item is StationNeed =>
  typeof item === 'object' && item !== null && isNeedKind((item as StationNeed).kind) && typeof (item as StationNeed).id === 'string';

/** Whether `answer` is `{ needs, faults }` as lists. A 200 that is not (a proxy's page, a server of another shape) is a failed read; one item this page cannot draw is not: it is dropped by `isDrawableNeed`, and its kind by `isNeedKind`. */
function isNeedsAnswer(answer: unknown): answer is { needs: unknown[]; faults: unknown[] } {
  if (typeof answer !== 'object' || answer === null) return false;
  const { needs, faults } = answer as { needs?: unknown; faults?: unknown };
  return Array.isArray(needs) && Array.isArray(faults);
}

/** An Error that says `sentence` and carries what really threw as `cause`; the client's TypeScript lib predates `new Error(message, { cause })`, so it is set as a property. */
function sentenceFor(sentence: string, cause: unknown): Error {
  return Object.assign(new Error(sentence), { cause });
}

/**
 * Used by the station's rail (`WhatNeedsYou`), which draws the items, and by its three stages (`AskStage`, `FollowupsStage`,
 * `CheckStage`), which say that the thing they were opened on is gone when the list no longer holds it. The count of what needs him
 * is not this list's length: it comes from the one rule (`needsCountOf`), through `useNeedsCount` below and in the rail's head.
 * Throws outside `StationNeedsProvider`, so a consumer placed wrong fails at once.
 */
export function useStationNeeds(): StationNeedsContextValue {
  const context = useContext(StationNeedsContext);
  if (!context) throw new Error('useStationNeeds must be used within a StationNeedsProvider');
  return context;
}

/**
 * How many things need him, by the one rule (`needsCountOf`) over the live list and her pending action: the rail's items, and her
 * action as one more unless it answers an Accept or a round the rail holds. The action counts only while its card is drawn: the
 * server closes a lapsed row at its next prepare, take or cancel and leaves it in her picture until then, while the card and the
 * phone's line go at its deadline (`useActionLapse`, which `useLivePending` reads), so a lapsed action is counted out with them. `null` until the first read of
 * the items has landed (`needs` null, in flight or failed): the rail says so in its own words, and a 0 here would claim "nothing
 * waits". Used by the compact arrangement's wrapper (its "Needs you" button) and the phone's (its bar); the rail's head draws the
 * same rule over its own props (`WhatNeedsYouView`), so the three say one number. Throws outside `StationNeedsProvider` and outside
 * her provider.
 */
export function useNeedsCount(): number | null {
  const { needs } = useStationNeeds();
  const { picture } = useCompanion();
  const livePending = useLivePending(picture?.pending ?? null);
  return needsCountOf(needs, livePending);
}

/**
 * THE PAGE'S KEEP OF WHAT NEEDS HIM, mounted by `StationRoute` inside `StationProvider`: one `GET /api/companion/station/needs`
 * (the dispatcher's Accepts and rounds, the chats' asks, the follow-ups, the red checks), held for
 * every region of the page.
 *
 * IT IS KEPT ON EVENTS, and nothing polls. It reads on six, every one an announcement the house already makes:
 *   1. the mount;
 *   2. `websocket_reconnected` (what was announced while the socket was down is lost);
 *   3. the shell's `station_sessions_changed` when its `states` is true (an ask raised, answered or cancelled, a run started or ended).
 *      The frames with `states` false are a chat merely talking, and no need moves on them;
 *   4. the dispatcher lane's picture changing (`useDispatcherPlans()`, the live bus's `dispatcher:all`): an Accept or a round is raised
 *      and answered there. A CHANGE IS JUDGED ON THE PICTURE'S CONTENT, never on the object the hook returns: the server sends a frame
 *      only when the lane moved, but the feed also re-seeds the lane over REST on the page's mount and on every reconnect, and it stamps
 *      each publish with a new `received_at`, so the bus (and the hook) hold a new object for a lane that did not move;
 *   5. `followups_changed` (a chat filed or closed one);
 *   6. `cerberus_changed` (a check went red or came back; center sends it at most once a second).
 * The only other read is the failed state's Try again, which is a press.
 *
 * ONE READ IS IN FLIGHT. A request that lands while a read is out does not start another: it leaves one mark, and when the read
 * out has been drawn exactly one more runs, so a burst of events costs two reads however long it is. The read out is still drawn: it
 * is a true answer, only possibly older than the event, and the one behind it catches up. Reads never overlap, so a slow old answer
 * can never be drawn over a newer one.
 *
 * A FAILED READ KEEPS WHAT THE PAGE HOLDS. A first read that fails is `failure` (with `reread`); one that fails after a good
 * read changes nothing on screen, and the next event reads again. The items and the `faults` that came with them stay a pair.
 */
export function StationNeedsProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const lane = useDispatcherPlans();
  // The lane's picture as text: its plans, hidden plans, arcs and planner outings, which is everything a need is read from. Compared by value, so a
  // re-seed of a lane that did not move is no event. Derived in render (not state or an effect) and recomputed only when the hook's object is new.
  // The one move it cannot tell from the lane's is his own put-away of a done plan (the hook drops it from `plans`): one read for his press.
  const laneSignature = useMemo(() => JSON.stringify([lane.plans, lane.hidden, lane.arcs, lane.planners]), [lane]);
  // What needs him as the last good read answered. State, because the rail and the stages draw from it and a new answer must re-draw them; null is "no read has landed".
  const [needs, setNeeds] = useState<StationNeed[] | null>(null);
  // The kinds the same read could not read. State, because the rail says them under the items; set together with `needs` so the two always come from one answer.
  const [faults, setFaults] = useState<StationNeed['kind'][]>([]);
  // Why the last read failed, cleared when a read lands or Try again starts one. State, because the rail's failed state draws it; the value below withholds it once items are held.
  const [failure, setFailure] = useState<string | null>(null);

  // Whether a read is out. A ref: it decides whether a request starts a read or marks one, and nothing is drawn from it.
  const readingRef = useRef(false);
  // A request landed while a read was out: one more read runs when it has been drawn. A ref for the same reason; a boolean, not a count, which is what makes a burst cost two reads.
  const queuedRef = useRef(false);
  // False once the provider unmounted: a read that lands then sets nothing. Set true by each mount, so a strict-mode remount revives the read the first mount started.
  const aliveRef = useRef(false);
  // The lane's picture (`laneSignature`) the last effect run saw. A ref: the effect compares against it to tell a picture that CHANGED from a re-run of the same one (strict mode's second mount), and nothing is drawn from it.
  const seenLaneRef = useRef(laneSignature);

  const read = useCallback(async () => {
    if (readingRef.current) {
      queuedRef.current = true;
      return;
    }
    readingRef.current = true;
    try {
      do {
        queuedRef.current = false;
        try {
          // The rail's failed state draws `error.message`: a dropped connection and an unparseable body say plain sentences here, never the browser's "Failed to fetch" or the JSON parser's words.
          // The sentence is for him; what really threw rides along as `cause` and is logged below, because "could not be reached" is right for a dropped connection and wrong for a bug in the page's own request code.
          const response = await api.companion.station.needs().catch((cause: unknown) => {
            throw sentenceFor('the server could not be reached', cause);
          });
          if (!response.ok) throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
          const answer: unknown = await response.json().catch((cause: unknown) => {
            throw sentenceFor('the answer is not a list of needs this page can draw', cause);
          });
          if (!isNeedsAnswer(answer)) throw new Error('the answer is not a list of needs this page can draw');
          if (aliveRef.current) {
            setNeeds(answer.needs.filter(isDrawableNeed));
            setFaults(answer.faults.filter(isNeedKind));
            setFailure(null);
          }
        } catch (error) {
          // The next event, the socket's next reconnect or the failed state's Try again reads again; there is no retry loop to run here.
          console.warn('[Station] Could not read what needs you:', error, ...(error instanceof Error && 'cause' in error ? [error.cause] : []));
          if (aliveRef.current) setFailure((error instanceof Error && error.message) || 'Request failed');
        }
      } while (queuedRef.current && aliveRef.current);
    } finally {
      readingRef.current = false;
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // Strict mode mounts twice in development: the second mount finds the first one's read out, and that read is this mount's
    // own first read, so it asks for no second.
    if (!readingRef.current) void read();
    return () => {
      aliveRef.current = false;
    };
  }, [read]);

  useEffect(() => subscribe((event) => {
    switch (event.kind) {
      case 'websocket_reconnected':
      case 'followups_changed':
      case 'cerberus_changed':
        void read();
        return;
      case 'station_sessions_changed':
        // `states` false is a chat merely talking: no need moves on it, and a rail that read on every streamed line would be a poll in all but name.
        if (event.states === true) void read();
        return;
    }
  }), [subscribe, read]);

  // A lane whose content differs from the one last seen is the event. The mount's own read already holds the picture the page began with;
  // this runs for the ones after it.
  useEffect(() => {
    if (seenLaneRef.current === laneSignature) return;
    seenLaneRef.current = laneSignature;
    void read();
  }, [laneSignature, read]);

  const reread = useCallback(() => {
    setFailure(null);
    void read();
  }, [read]);

  const value = useMemo<StationNeedsContextValue>(
    () => ({ needs, faults, failure: needs === null ? failure : null, reread }),
    [needs, faults, failure, reread],
  );

  return <StationNeedsContext.Provider value={value}>{children}</StationNeedsContext.Provider>;
}
