import type { StationFocus } from '@/shared/station-types.js';

/**
 * Which session each open browser tab is looking at, so a push is not sent
 * about a session the user is already watching, and what is on his screen, so
 * Kaylee can be told.
 *
 * Keyed by the connection object itself: a tab reports its selected session,
 * visibility, window focus and (the station) what its stage holds over its chat
 * websocket, and the record lives exactly as long as that connection does. It lives in the notifications module, not the
 * websocket module that receives the reports, because the ntfy channel reads
 * it — and the channel importing the websocket barrel would close an import
 * cycle (websocket → providers → notifications → websocket).
 */

type PresenceRecord = {
  userId: string | number | null;
  sessionId: string | null;
  visible: boolean;
  /** The page's own client id (the one it sends her as `x-companion-client`), which is how the page that holds her floor is found. */
  clientId: string | null;
  /** Whether the page's window has the keyboard focus, as opposed to merely being visible on another monitor. */
  focused: boolean;
  /** What the station's stage holds; `null` for a page of the workspace, whose "view" is its chat. */
  view: StationFocus | null;
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

//----------------- WHAT A PAGE MAY SAY IT SHOWS ------------

/** The longest any text of a reported view keeps: a name, an id or a label, cut by characters. */
const VIEW_TEXT_MAX_CHARACTERS = 300;

const isText = (value: unknown): value is string => typeof value === 'string';

/**
 * Whether `value` is a `StationFocus` as a page may state it: a known `kind` with each of its fields of the type the contract gives
 * it. Texts are judged for their type only; `cutStationFocus` shortens them. Anything else a page sends in `view` is dropped, so the
 * station's stage can never put a shape in front of her that the envelope has no line for.
 */
function isStationFocus(value: unknown): value is StationFocus {
  if (typeof value !== 'object' || value === null) return false;
  const focus = value as Record<string, unknown>;
  if (!isText(focus.label)) return false;
  switch (focus.kind) {
    case 'chat':
    case 'followups':
      return isText(focus.sessionId);
    case 'card':
      return isText(focus.plan);
    case 'ask':
      return isText(focus.sessionId) && isText(focus.requestId);
    case 'check':
      return isText(focus.node) && isText(focus.key);
    case 'note':
      // A card's row id: a positive whole number a table can hold. Zero, a negative or 1e21 names no note.
      return typeof focus.id === 'number' && Number.isSafeInteger(focus.id) && focus.id >= 1;
    case 'walk':
      return true;
    case 'page':
      return isText(focus.pageId) && (focus.blockId === null || isText(focus.blockId));
    default:
      return false;
  }
}

/**
 * `text` cut to `VIEW_TEXT_MAX_CHARACTERS` characters, never inside a surrogate pair, and its line breaks made spaces: a label is
 * one line of a one-line tag. Only the first 600 UTF-16 units are ever split into characters (a character is at most two of
 * them, so they hold every one of the 300 kept), so a frame carrying megabytes of text costs no more than one carrying 600.
 */
function cutText(text: string): string {
  const bound = VIEW_TEXT_MAX_CHARACTERS * 2;
  const head = Array.from(text.slice(0, bound));
  const cut = text.length <= bound && head.length <= VIEW_TEXT_MAX_CHARACTERS ? text : head.slice(0, VIEW_TEXT_MAX_CHARACTERS).join('');
  return cut.replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/**
 * A copy of the view holding only the fields of its kind, every text cut. A page's object may carry more than the contract names;
 * what is kept is what the contract lists, so an extra field never rides into her prompt.
 */
function cutStationFocus(view: StationFocus): StationFocus {
  const label = cutText(view.label);
  switch (view.kind) {
    case 'chat':
      return { kind: 'chat', sessionId: cutText(view.sessionId), label };
    case 'followups':
      return { kind: 'followups', sessionId: cutText(view.sessionId), label };
    case 'card':
      return { kind: 'card', plan: cutText(view.plan), label };
    case 'ask':
      return { kind: 'ask', sessionId: cutText(view.sessionId), requestId: cutText(view.requestId), label };
    case 'check':
      return { kind: 'check', node: cutText(view.node), key: cutText(view.key), label };
    case 'note':
      return { kind: 'note', id: view.id, label };
    case 'walk':
      return { kind: 'walk', label };
    case 'page':
      return { kind: 'page', pageId: cutText(view.pageId), blockId: view.blockId === null ? null : cutText(view.blockId), label };
  }
}

// ---------------------------

/**
 * Consumed by the chat websocket on every `chat.presence` report: what this connection's tab shows now.
 *
 * `clientId` and `focused` say which page it is and whether its window has the keyboard; `view` is what the station's stage
 * holds, kept only when it is a whole `StationFocus` (anything else is dropped, and the record is then a page of the workspace
 * whose view is its chat).
 */
export function markPresence(
  connection: object,
  presence: {
    userId: string | number | null;
    sessionId: string | null;
    visible: boolean;
    clientId?: string | null;
    focused?: boolean;
    view?: unknown;
  },
): void {
  const now = Date.now();
  forgetStaleRecords(now);
  presenceByConnection.set(connection, {
    userId: presence.userId,
    sessionId: presence.sessionId,
    visible: presence.visible,
    clientId: presence.clientId ?? null,
    focused: presence.focused === true,
    view: isStationFocus(presence.view) ? cutStationFocus(presence.view) : null,
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
 * What is on this account's screen, as the one page that speaks for it reports it: `sessionId` is that page's chat (`null` for none)
 * and `view` what its station stage holds (`null` for a page of the workspace, whose view is its chat). `null` when no page of the
 * account is visible and fresh.
 *
 * WHICH PAGE SPEAKS, within the same 90 s freshness the other reads use: the page that holds her floor (`floor`, a client id),
 * when its record is fresh and visible; else the freshest FOCUSED visible record; else the freshest visible one. With two windows
 * on two monitors, both visible, the page he last talked to her from wins, and a 30 s heartbeat from the other never flips it. A
 * hidden tab, one whose socket has closed, or one that reports under no client id never holds the floor. The user id is compared
 * as a string, as in `isSessionWatched`.
 *
 * Consumed by the companion module's view: it names what is on his screen in the message she is pushed.
 */
export function viewTargetOf(
  userId: string | number,
  floor: string | null,
): { sessionId: string | null; view: StationFocus | null } | null {
  const wanted = String(userId);
  const now = Date.now();
  let floorHolder: PresenceRecord | null = null;
  let freshestFocused: PresenceRecord | null = null;
  let freshestVisible: PresenceRecord | null = null;
  const fresher = (candidate: PresenceRecord, held: PresenceRecord | null) =>
    held === null || candidate.updatedAt > held.updatedAt ? candidate : held;
  for (const [connection, record] of presenceByConnection) {
    if (!isConnectionLive(connection)) {
      presenceByConnection.delete(connection);
      continue;
    }
    if (!record.visible || String(record.userId) !== wanted || now - record.updatedAt > DEFAULT_FRESH_MS) continue;
    freshestVisible = fresher(record, freshestVisible);
    if (record.focused) freshestFocused = fresher(record, freshestFocused);
    if (floor !== null && record.clientId === floor) floorHolder = fresher(record, floorHolder);
  }
  const speaker = floorHolder ?? freshestFocused ?? freshestVisible;
  // The view is handed out as a copy (its fields are all text or numbers): a reader that edits what it was given must not edit the record.
  return speaker === null ? null : { sessionId: speaker.sessionId, view: speaker.view === null ? null : { ...speaker.view } };
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
