import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { api, refusalSentence } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { StationLanded, StationLandedKind } from '@/shared/station-types';
import {
  adoptUserPreference,
  flushUserPreferences,
  hasHydratedUserPreferences,
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

type StationLandedContextValue = {
  /**
   * The week's landings, newest first, at most `LANDED_HELD`: the last good read with every `station_landed` frame folded in. `null`
   * while the first read is out, and while the preferences have not settled (his last look is not yet known, and a strip drawn
   * from a cold mirror would mark the whole week new for a moment); `[]` is a read that found nothing landed.
   */
  landed: StationLanded[] | null;
  /** When he last looked away from the station (ISO), the same on every device he uses; `null` when he never has, and then every landing is new. */
  seenAt: string | null;
  /** Writes his last look as now: the "<n> new" press, and every look-away. The server has it within the same breath, not at the end of the debounce. */
  markSeen: () => void;
  /** Why the first read failed (the server's own sentence when it gave one): the strip's failed state. Only while `landed` is null. */
  failure: string | null;
  /** The failed state's Try again: the failure gives way to the waiting state while the read is out. */
  reread: () => void;
};

const StationLandedContext = createContext<StationLandedContextValue | null>(null);

/** The most landings the page holds: what the read answers (`stationLanded`'s cap, 300, the most a strip draws), so folded frames never grow the list past it and a busy week stays whole. */
const LANDED_HELD = 300;

/** The four kinds the strip has a badge for: an entry of any other would be drawn with no glyph and no word, so it is left out. */
const LANDED_KINDS: ReadonlySet<StationLandedKind> = new Set(['shipped', 'epic', 'landed', 'recovered']);

/**
 * What the failed state says when the read got no answer at all (a dropped connection, a deadline), in place of the browser's own
 * "Failed to fetch". Used by this provider, and by `fake/strip.ts`, whose failed picture says it as the live strip does.
 */
export const LANDED_UNREACHABLE = 'the server could not be reached';

/** What the failed state says when the answer is not the list: a proxy's page, a server of another shape. In place of the JSON parser's own words. */
const NOT_A_LIST = 'the answer is not a list of landings this page can draw';

/** Whether `entry` has the shape of a landing: an id, a stamp and a title. A row without them is a server this page does not understand. */
function hasLandedShape(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const row = entry as Partial<StationLanded>;
  return typeof row.id === 'number' && typeof row.at === 'string' && typeof row.title === 'string';
}

/** Whether `entry` is a landing this page can draw: the shape above and a kind the strip has a badge for. */
function isLanded(entry: unknown): entry is StationLanded {
  return hasLandedShape(entry) && LANDED_KINDS.has((entry as StationLanded).kind);
}

/**
 * The landings of an `{ landed }` answer this page can draw, or `null` when the answer is not one (it is a failed read). A row of
 * the right shape but a kind this page does not know (a server one kind ahead of a cached bundle) is left out and the rest of the
 * week is drawn; a row of no landing's shape makes the whole answer a failed read.
 */
function landedRowsOf(answer: unknown): StationLanded[] | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { landed } = answer as { landed?: unknown };
  if (!Array.isArray(landed) || !landed.every(hasLandedShape)) return null;
  return landed.filter(isLanded);
}

/**
 * `incoming` folded into `held` by id, newest first (the order the read answers: the log's id, which grows as rows are kept), cut at
 * `LANDED_HELD`. An id already held is replaced, so a frame the read also carried, or one delivered twice, is one entry.
 */
function foldLanded(held: StationLanded[], incoming: StationLanded[]): StationLanded[] {
  const byId = new Map<number, StationLanded>();
  for (const entry of held) byId.set(entry.id, entry);
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, LANDED_HELD);
}

/**
 * Used by the station's strip (`SinceYouLastLooked`), which draws the week's landings and the line of his last look. Throws outside
 * `StationLandedProvider`, so a consumer placed wrong fails at once.
 */
export function useStationLanded(): StationLandedContextValue {
  const context = useContext(StationLandedContext);
  if (!context) throw new Error('useStationLanded must be used within a StationLandedProvider');
  return context;
}

/**
 * THE PAGE'S KEEP OF WHAT LANDED AND OF HIS LAST LOOK, mounted by `StationRoute` inside `StationProvider`.
 *
 * THE LANDINGS are one `GET /api/companion/station/landed` at mount and another on `websocket_reconnected` (a frame sent while the
 * socket was down is lost, and the read has it). Between them each `station_landed` frame folds its entry in by id. Nothing polls.
 * A frame that arrives while a read is out is folded into the answer as well as into what is held, because that read may have been
 * answered before the row it announces was kept. Reads may overlap (a reconnect while the mount's read is slow): an answer is drawn
 * unless a read that began after it has already been drawn, so a newer read that FAILS never throws away an older one that answered
 * well. A first read that fails is `failure` (with `reread`); one that fails after a good read changes nothing on screen, and the
 * next reconnect reads again.
 *
 * HIS LAST LOOK is `stationSeenAt`, a preference of the account, so it follows him from device to device and is read through the
 * preference store's own subscription. `markSeen` writes it as now, and the provider calls it on every look-away: the
 * document going hidden, the page going away, the window blurring after it was focused (he was in it and left it for another
 * window), and the route unmounting (he left the station by the app's own router, which raises none of the others). A look-away
 * with nothing new writes too, so the next look counts from it; with nothing drawn (no landings held) it writes nothing. Nothing
 * writes it on a clock. A page that comes back (its document visible again, its window focused) asks the server for the stamp
 * once, because another device may have written it while this one sat open, and keeps it when it is the newer.
 * The stamp is compared with the log's `at`, so the browser's clock and the server's are taken to agree (both are kept by NTP).
 * A clock BEHIND the server's is covered where it would show: the stamp is never earlier than the newest landing held, so the
 * "<n> new" press clears what it shows. A clock AHEAD stamps a moment in the future and swallows the landings of the next few
 * seconds; only a stamp made by the server would cure that, and a phone with automatic time is within seconds of it.
 * A tab closed before its stamp was sent leaves the server's older one: more landings read as new, never fewer.
 */
export function StationLandedProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  // The week's landings as the last good read answered, with the frames folded in since. State, because the strip draws from it and a new landing must re-draw it; null is "no read has landed".
  const [landed, setLanded] = useState<StationLanded[] | null>(null);
  // Why the last read failed, cleared when a read lands or Try again starts one. State, because the strip's failed state draws it; the value below withholds it once landings are held.
  const [failure, setFailure] = useState<string | null>(null);

  // His last look is an external store's value (the preference store), read through its one subscription, so a hydrate that brings the server's stamp, another tab's write and `markSeen` all re-draw the strip.
  const seenAt = useSyncExternalStore(
    subscribeToUserPreferences,
    () => readUserPreference<string | null>('stationSeenAt', null),
  );
  // Whether the preferences have settled: before they have, `seenAt` is a cold mirror's default and not his last look. A second subscription, because a hydrate that finds no stamp leaves `seenAt` as it was and only this tells the strip that "never" is now the answer.
  const settled = useSyncExternalStore(subscribeToUserPreferences, hasHydratedUserPreferences);

  // The numbering of reads: each read takes the next number. A ref: it orders answers and is not itself drawn.
  const readNumberRef = useRef(0);
  // The highest read number whose answer has been drawn: an answer from a lower number is older than what is on screen and is dropped. A ref for the same reason.
  const drawnNumberRef = useRef(0);
  // How many reads are out. A ref: it decides whether a frame is also kept for the answers on their way, and nothing is drawn from it.
  const outRef = useRef(0);
  // The frames that came while any read was out, kept until none is: folded into every answer that lands in that time (a row both holds is one entry). A ref for the same reason.
  const arrivedRef = useRef<StationLanded[]>([]);
  // False once the provider unmounted: a read that lands then sets nothing. Set true by each mount, so a strict-mode remount revives the read the first mount started.
  const aliveRef = useRef(false);
  // The landings held, mirrored for `markSeen`, which is a stable callback and cannot close over state. A ref: written after each draw, read only when a stamp is made.
  const landedRef = useRef<StationLanded[] | null>(null);
  // Whether the page is asking the server for the stamp (a come-back). A ref: it only keeps a visible-and-focused pair of events to one request.
  const learningRef = useRef(false);

  useEffect(() => {
    landedRef.current = landed;
  }, [landed]);

  const read = useCallback(async () => {
    readNumberRef.current += 1;
    const mine = readNumberRef.current;
    outRef.current += 1;
    try {
      const response = await api.companion.station.landed().catch(() => {
        throw new Error(LANDED_UNREACHABLE);
      });
      if (!response.ok) throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
      const answer: unknown = await response.json().catch(() => {
        throw new Error(NOT_A_LIST);
      });
      const rows = landedRowsOf(answer);
      if (rows === null) throw new Error(NOT_A_LIST);
      if (aliveRef.current && mine > drawnNumberRef.current) {
        drawnNumberRef.current = mine;
        setLanded(foldLanded(rows, arrivedRef.current));
        setFailure(null);
      }
    } catch (error) {
      // The socket's next reconnect or the failed state's Try again reads again; there is no retry loop to run here.
      console.warn('[Station] Could not read what landed:', error);
      if (aliveRef.current) setFailure((error instanceof Error && error.message) || 'Request failed');
    } finally {
      outRef.current -= 1;
      if (outRef.current === 0) arrivedRef.current = [];
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // Strict mode mounts twice in development: the second mount finds the first one's read out, and that read is this mount's
    // own first read, so it asks for no second.
    if (outRef.current === 0) void read();
    return () => {
      aliveRef.current = false;
    };
  }, [read]);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'websocket_reconnected') {
      void read();
      return;
    }
    if (event.kind !== 'station_landed') return;
    if (!isLanded(event.entry)) return;
    const { entry } = event;
    // The read out may have been answered before this row was kept: keep the entry for that answer too.
    if (outRef.current > 0) arrivedRef.current.push(entry);
    // Before the first read lands there is nothing to fold into, and the read's answer carries the entry (above).
    setLanded((held) => (held === null ? held : foldLanded(held, [entry])));
  }), [subscribe, read]);

  const markSeen = useCallback(() => {
    // Nothing drawn, nothing seen: with no landings held (the first read out or failed) a stamp would read the landings that arrive after as seen.
    if (landedRef.current === null) return;
    // Never earlier than the newest landing held: a device clock behind the server's would otherwise stamp a moment before a landing
    // he is looking at, and the press would leave it new.
    let stamp = Date.now();
    for (const entry of landedRef.current ?? []) stamp = Math.max(stamp, Date.parse(entry.at) || 0);
    writeUserPreference('stationSeenAt', new Date(stamp).toISOString());
    flushUserPreferences();
  }, []);

  // HIS LOOK-AWAYS, each a browser event and none a clock. `focused` is a plain variable of this effect: it is only the memory
  // that a `blur` follows a `focus`, so a window that was never focused (a page opened in the background) is not "looked away from".
  // It starts as the window's focus at mount, because a page loaded with focus never fires a `focus` of its own.
  useEffect(() => {
    let focused = document.hasFocus();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markSeen();
    };
    const onFocus = () => {
      focused = true;
    };
    const onBlur = () => {
      if (!focused) return;
      focused = false;
      markSeen();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', markSeen);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', markSeen);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      // THE ROUTE LEAVING is a look-away that raises none of the events above (a phone's "Back to CloudCLI" is the app's own
      // navigation, in the same window). It is stamped one microtask later and only if no remount revived the provider by then:
      // strict mode unmounts and remounts in one commit, and a stamp written then would put "now" over a landing never seen. Not
      // stamped after a sign-out either (the store is no longer settled), so one account's stamp is never queued under the next.
      queueMicrotask(() => {
        if (!aliveRef.current && hasHydratedUserPreferences()) markSeen();
      });
    };
  }, [markSeen]);

  // HIS COMING BACK, a browser event and no clock: the document visible again, or the window focused. Another device may have
  // written the stamp while this page sat open, and the store reads the server only at sign-in, so the page asks once and keeps the
  // server's stamp when it is the newer. A stamp this page wrote and has not sent is never older than the server's, and one in flight
  // is newer than the answer: both compare as not newer, so nothing is taken over them.
  useEffect(() => {
    const learn = async () => {
      if (learningRef.current || !hasHydratedUserPreferences()) return;
      learningRef.current = true;
      try {
        const response = await api.user.preferences();
        if (!response.ok) return;
        const body = (await response.json()) as { preferences?: { stationSeenAt?: unknown } };
        const stored = body.preferences?.stationSeenAt;
        if (typeof stored !== 'string' || Number.isNaN(Date.parse(stored))) return;
        const held = readUserPreference<string | null>('stationSeenAt', null);
        if (held === null || !(Date.parse(stored) <= Date.parse(held))) adoptUserPreference('stationSeenAt', stored);
      } catch (error) {
        // The next come-back asks again; a stamp that is a little old costs only a few landings that read as new.
        console.warn('[Station] Could not read his last look:', error);
      } finally {
        learningRef.current = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void learn();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', learn);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', learn);
    };
  }, []);

  const reread = useCallback(() => {
    setFailure(null);
    void read();
  }, [read]);

  const value = useMemo<StationLandedContextValue>(
    () => ({
      landed: settled ? landed : null,
      seenAt,
      markSeen,
      failure: landed === null ? failure : null,
      reread,
    }),
    [landed, settled, seenAt, markSeen, failure, reread],
  );

  return <StationLandedContext.Provider value={value}>{children}</StationLandedContext.Provider>;
}
