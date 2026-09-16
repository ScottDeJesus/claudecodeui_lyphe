/**
 * Which session each open browser tab is looking at, so a push is not sent
 * about a session the user is already watching.
 *
 * Keyed by the connection object itself: a tab reports its selected session
 * and visibility over its chat websocket, and the record lives exactly as long
 * as that connection does. It lives in the notifications module, not the
 * websocket module that receives the reports, because the ntfy channel reads
 * it — and the channel importing the websocket barrel would close an import
 * cycle (websocket → providers → notifications → websocket).
 */

type PresenceRecord = {
  userId: string | number | null;
  sessionId: string | null;
  visible: boolean;
  updatedAt: number;
};

/** A tab repeats its report every 30 s while visible, so 90 s of silence means it is gone or asleep. */
const DEFAULT_FRESH_MS = 90_000;
/**
 * Records this old can never count as watching under any sensible freshness,
 * so they are dropped — the guard for a connection that closed without
 * `clearPresence` and would otherwise sit in the map forever.
 */
const FORGET_AFTER_MS = 10 * 60_000;

/** A websocket's OPEN `readyState`; the `ws` library and the browser API share the value. */
const OPEN_READY_STATE = 1;

const presenceByConnection = new Map<object, PresenceRecord>();

/**
 * Whether a connection can still be watching. A key carrying a numeric
 * `readyState` (a websocket) counts only while OPEN, so a socket that closed
 * without `clearPresence` stops counting at once rather than 90 s later; a key
 * without one is judged by freshness alone.
 */
function isConnectionLive(connection: object): boolean {
  const readyState = (connection as { readyState?: unknown }).readyState;
  return typeof readyState !== 'number' || readyState === OPEN_READY_STATE;
}

function forgetStaleRecords(now: number): void {
  for (const [connection, record] of presenceByConnection) {
    if (now - record.updatedAt > FORGET_AFTER_MS) presenceByConnection.delete(connection);
  }
}

// Consumed by the chat websocket on every `chat.presence` report: what this connection's tab shows now.
export function markPresence(
  connection: object,
  presence: { userId: string | number | null; sessionId: string | null; visible: boolean },
): void {
  const now = Date.now();
  forgetStaleRecords(now);
  presenceByConnection.set(connection, {
    userId: presence.userId,
    sessionId: presence.sessionId,
    visible: presence.visible,
    updatedAt: now,
  });
}

// Consumed by the chat websocket when a connection closes: its tab watches nothing any more.
export function clearPresence(connection: object): void {
  presenceByConnection.delete(connection);
}

/**
 * Whether one of this user's tabs has this session on screen right now: a
 * record for the same user (compared as strings, since a user id arrives as a
 * number from one path and a string from another), the same session, visible,
 * and reported within `freshMs`. Consumed by the ntfy channel, which skips the
 * push when it answers true.
 */
export function isSessionWatched(
  userId: string | number | null,
  sessionId: string | null,
  options: { freshMs?: number } = {},
): boolean {
  if (userId === null || userId === undefined || !sessionId) return false;
  return hasFreshVisiblePresence(sessionId, options, String(userId));
}

/**
 * Whether any open tab has this session on screen right now, whichever user it
 * belongs to — the same freshness window and the same store `isSessionWatched`
 * uses, minus the user comparison.
 *
 * Consumed by the chat run registry: when a chat that is already on screen
 * finishes, its completion is stamped as read in the same breath, so the user
 * is not shown an unread dot for a run they just watched. A run carries no
 * user and `sessions` has no user column, so requiring one would answer false
 * for every run.
 */
export function isSessionOnScreen(sessionId: string, options: { freshMs?: number } = {}): boolean {
  if (!sessionId) return false;
  return hasFreshVisiblePresence(sessionId, options, null);
}

/**
 * The shared presence walk behind `isSessionWatched` and `isSessionOnScreen`.
 *
 * `userId` is the only difference between the two questions — a string to
 * match one account's tabs, `null` to accept any tab — so the freshness rule,
 * the liveness check and the single store live here once.
 */
function hasFreshVisiblePresence(
  sessionId: string,
  options: { freshMs?: number },
  userId: string | null,
): boolean {
  const freshMs = options.freshMs ?? DEFAULT_FRESH_MS;
  const now = Date.now();
  for (const [connection, record] of presenceByConnection) {
    if (!isConnectionLive(connection)) {
      presenceByConnection.delete(connection);
      continue;
    }
    if (
      record.visible
      && record.sessionId === sessionId
      && (userId === null || String(record.userId) === userId)
      && now - record.updatedAt <= freshMs
    ) {
      return true;
    }
  }
  return false;
}
