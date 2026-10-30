import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api, refusalSentence } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { StationSession, StationSessionState } from '@/shared/station-types';

type StationSessionsContextValue = {
  /** His chats as the server last answered, in the rail's order. `null` until the first read lands; `[]` is a read that found no chat. */
  sessions: StationSession[] | null;
  /**
   * Why the first read failed (the server's own sentence when it gave one): the rail's failed state. Only while `sessions` is
   * null. A read that fails after a good one keeps the rows on screen and sets nothing here.
   */
  failure: string | null;
  /** The failed state's Try again: the failure gives way to the waiting state while the read is out. */
  reread: () => void;
};

const StationSessionsContext = createContext<StationSessionsContextValue | null>(null);

/** The four states the rail has a chip for: a row in any other would have the rail draw nothing for its state, so the read is refused instead. */
const SESSION_STATES: ReadonlySet<StationSessionState> = new Set(['working', 'waiting', 'live', 'asleep']);

/** Whether `answer` is `{ sessions }` of rows this page can draw. A 200 that is not (a proxy's page, a server of another shape) is a failed read. */
function isSessionsAnswer(answer: unknown): answer is { sessions: StationSession[] } {
  if (typeof answer !== 'object' || answer === null) return false;
  const { sessions } = answer as { sessions?: unknown };
  return Array.isArray(sessions) && sessions.every((row) => (
    typeof row === 'object' && row !== null
    && typeof (row as StationSession).sessionId === 'string'
    && SESSION_STATES.has((row as StationSession).state)
  ));
}

/** An Error that says `sentence` and carries what really threw as `cause`; the client's TypeScript lib predates `new Error(message, { cause })`, so it is set as a property. */
function sentenceFor(sentence: string, cause: unknown): Error {
  return Object.assign(new Error(sentence), { cause });
}

/**
 * For the station's rail (`WhereThingsStand`) and the chat's stage (`ChatStage`), which draw his chats, and the draft dock's
 * Steer and the walk stage's chat name, which name a chat (neither calls it yet; `FILL` markers hold their places): all four read
 * the same rows, so a chat is never working in one and idle in another.
 * Throws outside `StationSessionsProvider`, so a consumer placed wrong fails at once.
 */
export function useStationSessions(): StationSessionsContextValue {
  const context = useContext(StationSessionsContext);
  if (!context) throw new Error('useStationSessions must be used within a StationSessionsProvider');
  return context;
}

/**
 * THE PAGE'S KEEP OF HIS CHATS, mounted by `StationRoute` inside `StationProvider`: one `GET /api/companion/station/sessions`
 * (`chatRows()` and the line she reads of each, served as they are), held for every region of the page.
 *
 * IT IS KEPT ON EVENTS, and nothing polls. It reads at mount, on every `station_sessions_changed` hint (whatever its `states`:
 * the run registry, the upsert broadcaster, host liveness and a raised ask each stand behind one, so every change the rail draws
 * has a hint behind it) and on `websocket_reconnected` (the hints that came while the socket was down are lost). The only other
 * read is the failed state's Try again, which is a press.
 *
 * ONE READ IS IN FLIGHT. A request that lands while a read is out does not start another: it leaves one mark, and when the read
 * out has been drawn exactly one more runs, so a burst of hints costs two reads however long it is. The read out is still drawn:
 * it is a true answer, only possibly older than the hint, and the one behind it catches up.
 *
 * A FAILED READ KEEPS WHAT THE PAGE HOLDS. A first read that fails is `failure` (with `reread`); one that fails after a good
 * read changes nothing on screen, and the next hint reads again.
 */
export function StationSessionsProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  // His chats as the last good read answered. State, because the rail and the stage draw from it and a new answer must re-draw them; null is "no read has landed".
  const [sessions, setSessions] = useState<StationSession[] | null>(null);
  // Why the last read failed, cleared when a read lands or Try again starts one. State, because the rail's failed state draws it; the value below withholds it once rows are held.
  const [failure, setFailure] = useState<string | null>(null);

  // Whether a read is out. A ref: it decides whether a request starts a read or marks one, and nothing is drawn from it.
  const readingRef = useRef(false);
  // A request landed while a read was out: one more read runs when it has been drawn. A ref for the same reason; a boolean, not a count, which is what makes a burst cost two reads.
  const queuedRef = useRef(false);
  // False once the provider unmounted: a read that lands then sets nothing. Set true by each mount, so a strict-mode remount revives the read the first mount started.
  const aliveRef = useRef(false);

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
          const response = await api.companion.station.sessions().catch((cause: unknown) => {
            throw sentenceFor('the server could not be reached', cause);
          });
          if (!response.ok) throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
          const answer: unknown = await response.json().catch((cause: unknown) => {
            throw sentenceFor('the answer is not a list of chats this page can draw', cause);
          });
          if (!isSessionsAnswer(answer)) throw new Error('the answer is not a list of chats this page can draw');
          if (aliveRef.current) {
            setSessions(answer.sessions);
            setFailure(null);
          }
        } catch (error) {
          // The next hint, the socket's next reconnect or the failed state's Try again reads again; there is no retry loop to run here.
          console.warn('[Station] Could not read your chats:', error, ...(error instanceof Error && 'cause' in error ? [error.cause] : []));
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
    if (event.kind === 'station_sessions_changed' || event.kind === 'websocket_reconnected') void read();
  }), [subscribe, read]);

  const reread = useCallback(() => {
    setFailure(null);
    void read();
  }, [read]);

  const value = useMemo<StationSessionsContextValue>(
    () => ({ sessions, failure: sessions === null ? failure : null, reread }),
    [sessions, failure, reread],
  );

  return <StationSessionsContext.Provider value={value}>{children}</StationSessionsContext.Provider>;
}
