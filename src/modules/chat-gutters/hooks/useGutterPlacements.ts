import { useCallback, useSyncExternalStore } from 'react';

import type { ChatGutterPlacements, GutterSide, GutterWidgetId, GutterWidgetPlacement } from '@/shared/types';
import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Where the gutter widgets sit and whether they are open, PER CHAT, as one server-backed preference.
 *
 * A chat is a piece of work: one has a plan run to watch, another has subagents out, a third needs
 * the transcript and nothing else. One arrangement for every chat meant opening a widget for one of
 * them opened it for all of them, so the arrangement is kept per session and a chat with none of its
 * own opens with the fallback: what a chat that has never been arranged starts from. A chat not sent
 * yet has no session id, so arranging one moves the fallback itself — the next new chat opens the way
 * the last one was left, and an old chat that was never touched is undisturbed.
 *
 * THE SERVER IS THE SOURCE OF TRUTH, the same as for every other preference: a placement made on
 * the phone is there on the desktop at its next sign-in. Nothing else records this arrangement —
 * the gutters are a browser-side layout of the chat, and the app has no second copy of it.
 *
 * The stored value is whatever an older build wrote, so it is PARSED and never trusted: an entry
 * that is missing, names no usable side, or carries an `open` that is not a boolean falls back to
 * that widget's default, and ranks are renumbered so two widgets can never claim one place. The
 * defaults put `runner` first on the left and `memory` first on the right, both collapsed — the
 * state that costs the chat nothing — `subagents` under the runner, open, and `embed` under memory,
 * collapsed until a chat names a page for it.
 *
 * THE STORED SHAPE is `{ fallback, sessions: { <sessionId>: placements } }`, and an older build's
 * flat record reads as the fallback with no sessions — so an arrangement made before this is the one
 * every existing chat still opens with. The session map is capped (`MAX_REMEMBERED_SESSIONS`) and
 * loses its least recently WRITTEN entries first, because the store is one preference row and a
 * browser that opens a thousand chats must not grow it without end. The cap is enforced again by the
 * server, which merges this document per chat rather than replacing it — a write from one tab or
 * device must not delete a chat another one just arranged
 * (`server/modules/database/repositories/user-preferences.db.ts`).
 *
 * A PLACE IS A SIDE AND A RANK IN IT, never one of four berths. A side holds as many widgets as are
 * dropped on it, in `order`, and a fourth widget costs nothing here. An arrangement stored by the
 * build that had four corners is READ, never discarded: `top-left` is the left side's first place,
 * `bottom-left` its second, and the same on the right.
 *
 * WHERE THE WIDGETS ARE LISTED. `DEFAULT_PLACEMENTS` below is the one place the compiler proves
 * every widget is named: it is typed `ChatGutterPlacements`, a `Record<GutterWidgetId, …>`, so an id
 * added to the union fails to typecheck there until it is given a place. The list is READ OFF that
 * record rather than spelled a second time, because a list written separately could quietly omit a
 * widget — and a widget that is placed but never asked about simply never draws.
 */

const DEFAULT_PLACEMENTS: ChatGutterPlacements = {
  runner: { side: 'left', order: 0, open: false },
  memory: { side: 'right', order: 0, open: false },
  subagents: { side: 'left', order: 1, open: true },
  // Collapsed, and on the right under memory: an embed is a page the chat has yet to name, so a
  // widget that opened itself would give a column's height to an empty frame in every chat that
  // never uses one. It opens itself the moment a chat declares an address — see `ChatGutterLayout`.
  embed: { side: 'right', order: 1, open: false },
};

/** Every widget there is, in the order a repair falls back to. */
export const GUTTER_WIDGET_ORDER: readonly GutterWidgetId[] =
  Object.keys(DEFAULT_PLACEMENTS) as GutterWidgetId[];

export const GUTTER_SIDES: readonly GutterSide[] = ['left', 'right'];

function isSide(value: unknown): value is GutterSide {
  return value === 'left' || value === 'right';
}

/** The four-corner spelling this feature used to store, as a side and a rank. */
const LEGACY_SLOTS: Record<string, { side: GutterSide; order: number }> = {
  'top-left': { side: 'left', order: 0 },
  'bottom-left': { side: 'left', order: 1 },
  'top-right': { side: 'right', order: 0 },
  'bottom-right': { side: 'right', order: 1 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One widget's stored place, or `null` when the record does not hold a usable one. */
function parsePlacement(value: unknown): GutterWidgetPlacement | null {
  if (!isRecord(value)) {
    return null;
  }

  const { side, order, open } = value;
  if (typeof open !== 'boolean') return null;
  if (isSide(side) && typeof order === 'number' && Number.isFinite(order)) {
    return { side, order, open };
  }
  // The four-corner record an older build wrote.
  const legacy = typeof value.slot === 'string' ? LEGACY_SLOTS[value.slot] : undefined;
  return legacy ? { ...legacy, open } : null;
}

/**
 * The stored placements, repaired widget by widget.
 *
 * A widget whose entry is missing or unreadable takes its default place — `subagents`, whose id an
 * older build never stored, arrives this way — and each side's ranks are then made dense, so a
 * record where two widgets share a rank draws in a settled order instead of an accidental one.
 */
function parsePlacements(raw: unknown): ChatGutterPlacements {
  // Seeded from the defaults rather than built empty: the record is complete by TYPE, not by a cast,
  // and a widget the list somehow left out keeps its default place instead of vanishing.
  const result: ChatGutterPlacements = { ...DEFAULT_PLACEMENTS };
  for (const widget of GUTTER_WIDGET_ORDER) {
    const parsed = isRecord(raw) ? parsePlacement(raw[widget]) : null;
    if (parsed) result[widget] = parsed;
  }

  // Ranks are made DENSE per side, in the order they were stored: two widgets that shared a rank
  // (an older four-corner record, a hand-edited preference) would otherwise draw in an order the
  // next drop could not reason about. Ties break on the list above, so the repair is the same every
  // time it runs.
  for (const side of GUTTER_SIDES) {
    GUTTER_WIDGET_ORDER
      .filter((widget) => result[widget].side === side)
      .sort((left, right) => (
        result[left].order - result[right].order
        || GUTTER_WIDGET_ORDER.indexOf(left) - GUTTER_WIDGET_ORDER.indexOf(right)
      ))
      .forEach((widget, index) => {
        result[widget] = { ...result[widget], order: index };
      });
  }

  return result;
}

/**
 * The read is memoised by the IDENTITY of the stored value, because `useSyncExternalStore`
 * compares snapshots by identity: a getter that parsed afresh on every call would report a change
 * on every render and loop. The store replaces that value only on a write or a hydrate, so the
 * parse is rebuilt exactly when the placements change — the shape `modules/plan-runner/
 * dismissedRuns.ts` uses for its own preference.
 */
/** How many chats keep an arrangement of their own before the least recently written is dropped. */
const MAX_REMEMBERED_SESSIONS = 60;

/** The whole preference, parsed: the fallback every chat starts from, and the chats with their own. */
type StoredGutters = {
  fallback: ChatGutterPlacements;
  sessions: Record<string, ChatGutterPlacements>;
  /** Write order, oldest first — what the cap drops by. */
  order: string[];
};

function parseStored(raw: unknown): StoredGutters {
  if (!isRecord(raw) || (!isRecord(raw.sessions) && !isRecord(raw.fallback))) {
    // An older build wrote the flat record, and nothing else has a claim on it: it is the fallback.
    return { fallback: parsePlacements(raw), sessions: {}, order: [] };
  }
  // A `sessions` that is not a record says nothing about any chat; the fallback beside it still does,
  // so it is kept rather than reset — this function repairs what it is given and discards nothing.
  if (!isRecord(raw.sessions)) {
    return { fallback: parsePlacements(raw.fallback), sessions: {}, order: [] };
  }

  const sessions: Record<string, ChatGutterPlacements> = {};
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : [];
  for (const [sessionId, value] of Object.entries(raw.sessions)) {
    if (isRecord(value)) sessions[sessionId] = parsePlacements(value);
  }
  // An id in the map but not in the order is still a chat's arrangement; it simply drops first.
  const known = order.filter((id) => id in sessions);
  const missing = Object.keys(sessions).filter((id) => !known.includes(id));
  return { fallback: parsePlacements(raw.fallback), sessions, order: [...missing, ...known] };
}

let lastRaw: unknown;
let lastStored: StoredGutters = { fallback: DEFAULT_PLACEMENTS, sessions: {}, order: [] };

function readStored(): StoredGutters {
  const raw = readUserPreference<unknown>('chatGutters', null);
  if (raw === lastRaw) {
    return lastStored;
  }

  lastRaw = raw;
  lastStored = parseStored(raw);
  return lastStored;
}

/** One chat's arrangement: its own if it has one, else the fallback. */
function readPlacementsFor(sessionId: string | null): ChatGutterPlacements {
  const stored = readStored();
  return (sessionId && stored.sessions[sessionId]) || stored.fallback;
}

/**
 * Writes one chat's arrangement, and ONLY that chat's: a widget opened here must not open itself in
 * every chat that has not been arranged yet, which is the whole complaint this answers. The fallback
 * moves only where there is no chat to write — a chat not sent yet, which has no session id — so the
 * arrangement made in a new chat is the one the next new chat starts from.
 */
function writePlacementsFor(sessionId: string | null, placements: ChatGutterPlacements): void {
  const stored = readStored();
  if (!sessionId) {
    writeUserPreference(
      'chatGutters',
      { fallback: placements, sessions: stored.sessions, order: stored.order },
      // Only the fallback travels: this arrangement was made in a chat that does not exist yet, so it
      // says nothing about any chat that does.
      { fallback: placements },
    );
    return;
  }

  // A drop that lands a widget where it already stood changes nothing, and the document's own
  // recency list is not worth a request: without this the first such drop still wrote, because the
  // store compares the whole key and `order` had moved.
  if (JSON.stringify(stored.sessions[sessionId]) === JSON.stringify(placements)) return;

  const order = [...stored.order.filter((id) => id !== sessionId), sessionId];
  const sessions = { ...stored.sessions, [sessionId]: placements };
  while (order.length > MAX_REMEMBERED_SESSIONS) {
    const dropped = order.shift();
    if (dropped) delete sessions[dropped];
  }
  // The whole document is kept here; only THIS chat's section goes to the server, which merges it.
  // Sending the document would assert every section in it, reverting a chat another device has since
  // arranged — the browser's copy is only refreshed at sign-in. The FALLBACK is left out for the same
  // reason: a drag inside one chat says nothing about how an unarranged chat should open, and this
  // device's copy of it is exactly as stale as the sections beside it.
  writeUserPreference(
    'chatGutters',
    { fallback: stored.fallback, sessions, order },
    { sessions: { [sessionId]: placements }, order: [sessionId] },
  );
}

/** Replaces one widget's placement and leaves every other where it is. */
function withPlacement(
  placements: ChatGutterPlacements,
  widget: GutterWidgetId,
  placement: GutterWidgetPlacement,
): ChatGutterPlacements {
  // A copy and an indexed write rather than a computed key in the literal: `{ ...placements,
  // [widget]: placement }` widens the record to a string index and loses the key type, which is
  // what makes this generic helper worth having instead of a branch per widget.
  const next: ChatGutterPlacements = { ...placements };
  next[widget] = placement;
  return next;
}

/** The widgets on one side, in the order they are drawn. */
export function widgetsOn(placements: ChatGutterPlacements, side: GutterSide): GutterWidgetId[] {
  return GUTTER_WIDGET_ORDER
    .filter((widget) => placements[widget].side === side)
    .sort((left, right) => placements[left].order - placements[right].order);
}

/**
 * Where each widget sits, and the two moves the layout can make.
 *
 * Used by `ChatGutterLayout`, which owns the columns and the drag; the column and the frame are told
 * what to draw and never read this themselves. Both moves write the WHOLE object, so no two widgets
 * can be written against two different readings of the preference, and both write the chat the
 * layout names — never whichever chat a later render happens to be showing.
 */
export function useGutterPlacements(sessionId: string | null): {
  placements: ChatGutterPlacements;
  moveWidget: (widget: GutterWidgetId, side: GutterSide, index: number) => void;
  toggleWidget: (widget: GutterWidgetId) => void;
} {
  const read = useCallback(() => readPlacementsFor(sessionId), [sessionId]);
  const placements = useSyncExternalStore(subscribeToUserPreferences, read, read);

  /**
   * Puts one widget at `index` in a side's stack: the side is rebuilt without it and it is spliced
   * back in, so every other widget on both sides keeps its neighbours and the ranks stay dense. The
   * index is the place the DROP named — the gap the pointer was in — and a widget moved down its own
   * side lands where the gap was, which is one place lower than the naive splice.
   */
  const moveWidget = useCallback((widget: GutterWidgetId, side: GutterSide, index: number) => {
    const current = readPlacementsFor(sessionId);
    const target = widgetsOn(current, side).filter((other) => other !== widget);
    const from = widgetsOn(current, side).indexOf(widget);
    const at = Math.max(0, Math.min(target.length, from !== -1 && index > from ? index - 1 : index));
    target.splice(at, 0, widget);

    let next = current;
    target.forEach((member, order) => {
      next = withPlacement(next, member, { side, order, open: next[member].open });
    });
    // The side it LEFT closes up, so a gap never survives a move across the chat.
    widgetsOn(current, side === 'left' ? 'right' : 'left')
      .filter((other) => other !== widget)
      .forEach((member, order) => {
        next = withPlacement(next, member, { side: side === 'left' ? 'right' : 'left', order, open: next[member].open });
      });
    writePlacementsFor(sessionId, next);
  }, [sessionId]);

  const toggleWidget = useCallback((widget: GutterWidgetId) => {
    const current = readPlacementsFor(sessionId);
    writePlacementsFor(sessionId, withPlacement(current, widget, {
      ...current[widget],
      open: !current[widget].open,
    }));
  }, [sessionId]);

  return { placements, moveWidget, toggleWidget };
}
