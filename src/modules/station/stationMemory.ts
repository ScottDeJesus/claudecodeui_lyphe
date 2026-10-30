import type { StationFocus } from '@/shared/station-types';
import type { StationPrefKey, StationRegion } from '@/shared/types';

/** The localStorage key the station keeps its one record under: per device, as a window's size and its pointer are. */
export const STATION_STORAGE_KEY = 'kaylee-station';

/** How many focuses Back can return through: the newest ten, the oldest dropped as an eleventh is pushed. */
export const BACK_STACK_DEPTH = 10;

/**
 * What the station remembers on this device: the focus on the stage and the focuses Back returns through (newest last),
 * the scroll of each region that registered one, and the regions' own preferences. Written whole, as one record.
 */
export type StationRecord = {
  focus: StationFocus | null;
  stack: StationFocus[];
  scroll: Partial<Record<StationRegion, number>>;
  prefs: Partial<Record<StationPrefKey, unknown>>;
};

/** The preferences a record may hold: a stored key outside this list is from another build and is dropped on read. Each is a flag. */
const PREF_KEYS: readonly StationPrefKey[] = ['stripCollapsed', 'cornerOpen', 'compact', 'asleepOpen', 'completeOpen'];

/** A record with nothing remembered: a first visit, or a stored record that could not be read. */
export function emptyStationRecord(): StationRecord {
  return { focus: null, stack: [], scroll: {}, prefs: {} };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * Whether `value` is a focus this build can put on the stage: the kind's own fields all present and typed (the server's
 * presence check holds the same shapes). A stored focus is data from an older build or a hand-edited store, so it is
 * checked before it is believed; one that fails is dropped, never repaired.
 */
export function isStationFocus(value: unknown): value is StationFocus {
  if (!isRecord(value) || typeof value.label !== 'string') return false;
  switch (value.kind) {
    case 'chat':
    case 'followups':
      return isText(value.sessionId);
    case 'card':
      return isText(value.plan);
    case 'ask':
      return isText(value.sessionId) && isText(value.requestId);
    case 'check':
      return isText(value.node) && isText(value.key);
    case 'note':
      return typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id >= 1;
    case 'walk':
      return true;
    case 'page':
      return isText(value.pageId) && (value.blockId === null || isText(value.blockId));
    default:
      return false;
  }
}

/**
 * Which thing a focus is, as one string: its kind and the fields that name it, never its label (a label is what the
 * thing is called today). Two focuses with the same key are the same thing, so pressing what is already on the stage
 * changes nothing, and the stage's body is keyed by it so a different thing starts at the top.
 */
export function focusKey(focus: StationFocus): string {
  switch (focus.kind) {
    case 'chat':
    case 'followups':
      return `${focus.kind}:${focus.sessionId}`;
    case 'card':
      return `card:${focus.plan}`;
    case 'ask':
      return `ask:${focus.sessionId}:${focus.requestId}`;
    case 'check':
      return `check:${focus.node}:${focus.key}`;
    case 'note':
      return `note:${focus.id}`;
    case 'walk':
      return 'walk';
    case 'page':
      return `page:${focus.pageId}:${focus.blockId ?? ''}`;
  }
}

/**
 * `stack` less the focuses on its end that are `focus` itself: Back never returns to what is already on the stage. A thing
 * cleared with ✕ and staged again, or reached again from the one before it, would otherwise leave itself as its own Back — a
 * press drawn that changes nothing.
 */
export function backableFrom(stack: StationFocus[], focus: StationFocus | null): StationFocus[] {
  if (focus === null) return stack;
  const here = focusKey(focus);
  let end = stack.length;
  while (end > 0 && focusKey(stack[end - 1]) === here) end -= 1;
  return end === stack.length ? stack : stack.slice(0, end);
}

/** The record this device holds, read as the station mounts. A missing, unreadable or foreign record is an empty one. */
export function readStationRecord(): StationRecord {
  let raw: unknown;
  try {
    const stored = window.localStorage.getItem(STATION_STORAGE_KEY);
    if (stored === null) return emptyStationRecord();
    raw = JSON.parse(stored);
  } catch (error) {
    console.warn('[Station] Could not read the stored record; starting with an empty one:', error);
    return emptyStationRecord();
  }
  if (!isRecord(raw)) return emptyStationRecord();

  const scroll: StationRecord['scroll'] = {};
  if (isRecord(raw.scroll)) {
    for (const [region, top] of Object.entries(raw.scroll)) {
      if (typeof top === 'number' && Number.isFinite(top) && top >= 0) scroll[region as StationRegion] = top;
    }
  }
  const prefs: StationRecord['prefs'] = {};
  if (isRecord(raw.prefs)) {
    for (const key of PREF_KEYS) {
      // A flag stored as anything else (a hand-edited record, another build's) reads as no preference, so its region keeps its default.
      if (typeof raw.prefs[key] === 'boolean') prefs[key] = raw.prefs[key];
    }
  }
  const focus = isStationFocus(raw.focus) ? raw.focus : null;
  const stack = backableFrom(Array.isArray(raw.stack) ? raw.stack.filter(isStationFocus).slice(-BACK_STACK_DEPTH) : [], focus);
  return { focus, stack, scroll, prefs };
}

/** Writes the record. A store that refuses (full, or private browsing) is said once per failure and the station carries on in memory. */
export function writeStationRecord(record: StationRecord): void {
  try {
    window.localStorage.setItem(STATION_STORAGE_KEY, JSON.stringify(record));
  } catch (error) {
    console.warn('[Station] Could not store the record; this window keeps it in memory only:', error);
  }
}
