import { useCallback, useSyncExternalStore } from 'react';

import type { ChatGutterPlacements, GutterSlotId, GutterWidgetId, GutterWidgetPlacement } from '@/shared/types';
import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Where the gutter widgets sit and whether they are open, as one server-backed preference.
 *
 * THE SERVER IS THE SOURCE OF TRUTH, the same as for every other preference: a placement made on
 * the phone is there on the desktop at its next sign-in. Nothing else records this arrangement —
 * the gutters are a browser-side layout of the chat, and the app has no second copy of it.
 *
 * The stored value is whatever an older build wrote, so it is PARSED and never trusted: an entry
 * that is missing, names a corner that is not one of the four, or carries an `open` that is not a
 * boolean falls back to that widget's default, and a widget whose corner is already taken is moved
 * to a free one — a layout that cannot exist (two widgets in one corner) is repaired rather than
 * rendered. The defaults put `runner` and `memory` in opposite top corners, collapsed, which is the
 * state that costs the chat nothing, and `subagents` in the bottom-left, open.
 *
 * WHERE THE WIDGETS ARE LISTED. `DEFAULT_PLACEMENTS` below is the one place the compiler proves
 * every widget is named: it is typed `ChatGutterPlacements`, a `Record<GutterWidgetId, …>`, so an id
 * added to the union fails to typecheck there until it is given a corner. The order is READ OFF that
 * record rather than spelled a second time, because a list written separately could quietly omit a
 * widget — and a widget that is placed but never asked about simply never draws.
 */

const DEFAULT_PLACEMENTS: ChatGutterPlacements = {
  runner: { slot: 'top-left', open: false },
  memory: { slot: 'top-right', open: false },
  subagents: { slot: 'bottom-left', open: true },
};

/**
 * The widgets, in the order their corners are claimed when a stored record has to be repaired, and
 * the order the layout asks about: a slot draws the FIRST widget in this list that names it.
 */
export const GUTTER_WIDGET_ORDER: readonly GutterWidgetId[] =
  Object.keys(DEFAULT_PLACEMENTS) as GutterWidgetId[];

const SLOTS: readonly GutterSlotId[] = ['top-left', 'bottom-left', 'top-right', 'bottom-right'];

function isSlot(value: unknown): value is GutterSlotId {
  return typeof value === 'string' && (SLOTS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One widget's stored corner, or `null` when the record does not hold a usable one. */
function parsePlacement(value: unknown): GutterWidgetPlacement | null {
  if (!isRecord(value)) {
    return null;
  }

  const { slot, open } = value;
  return isSlot(slot) && typeof open === 'boolean' ? { slot, open } : null;
}

/**
 * The stored placements, repaired widget by widget.
 *
 * A slot draws whoever claims it, so two widgets in ONE corner would draw one widget twice and
 * leave the other corner empty — a shape with no answer. Each widget is therefore placed in turn:
 * its own stored corner when nothing holds it, else its default corner when that is free, else the
 * first slot left. A widget added to the list after a record was written — `subagents`, whose id an
 * older build never stored — is simply a widget whose entry is missing, and takes its default.
 */
function parsePlacements(raw: unknown): ChatGutterPlacements {
  const taken = new Set<GutterSlotId>();
  // Seeded from the defaults rather than built empty: the record is complete by TYPE, not by a cast,
  // and a widget the order list somehow left out keeps its default corner instead of vanishing.
  const result: ChatGutterPlacements = { ...DEFAULT_PLACEMENTS };

  for (const widget of GUTTER_WIDGET_ORDER) {
    const parsed = isRecord(raw) ? parsePlacement(raw[widget]) : null;
    const wanted = parsed ?? DEFAULT_PLACEMENTS[widget];
    const slot = !taken.has(wanted.slot)
      ? wanted.slot
      : !taken.has(DEFAULT_PLACEMENTS[widget].slot)
        ? DEFAULT_PLACEMENTS[widget].slot
        : SLOTS.find((candidate) => !taken.has(candidate)) ?? DEFAULT_PLACEMENTS[widget].slot;

    result[widget] = { slot, open: wanted.open };
    taken.add(slot);
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
let lastRaw: unknown;
let lastPlacements: ChatGutterPlacements = DEFAULT_PLACEMENTS;

function readPlacements(): ChatGutterPlacements {
  const raw = readUserPreference<unknown>('chatGutters', null);
  if (raw === lastRaw) {
    return lastPlacements;
  }

  lastRaw = raw;
  lastPlacements = parsePlacements(raw);
  return lastPlacements;
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

/**
 * Where each widget sits, and the two moves the layout can make.
 *
 * Used by `ChatGutterLayout`, which owns the slots and the drag; the frame and the slot are told
 * what to draw and never read this themselves. Both moves write the WHOLE object, so no two widgets
 * can be written against two different readings of the preference.
 */
export function useGutterPlacements(): {
  placements: ChatGutterPlacements;
  moveWidget: (widget: GutterWidgetId, slot: GutterSlotId) => void;
  toggleWidget: (widget: GutterWidgetId) => void;
} {
  const placements = useSyncExternalStore(subscribeToUserPreferences, readPlacements, readPlacements);

  const moveWidget = useCallback((widget: GutterWidgetId, slot: GutterSlotId) => {
    const current = readPlacements();

    // Dropping onto a corner another widget holds SWAPS the two: that widget takes the corner this
    // one just left, so a drop can never empty a slot and leave a widget undrawn — and with three
    // widgets and four corners, asking WHO holds the target is the only honest way to find it.
    const occupant = GUTTER_WIDGET_ORDER.find(
      (other) => other !== widget && current[other].slot === slot,
    );
    const moved = withPlacement(current, widget, { slot, open: current[widget].open });
    writeUserPreference('chatGutters', occupant === undefined
      ? moved
      : withPlacement(moved, occupant, { slot: current[widget].slot, open: current[occupant].open }));
  }, []);

  const toggleWidget = useCallback((widget: GutterWidgetId) => {
    const current = readPlacements();
    writeUserPreference('chatGutters', withPlacement(current, widget, {
      slot: current[widget].slot,
      open: !current[widget].open,
    }));
  }, []);

  return { placements, moveWidget, toggleWidget };
}
