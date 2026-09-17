import type { DockableFabPosition } from '@/shared/ui';

/**
 * The switcher's one piece of persisted state: where the FAB sits, whether dual screen is on, and
 * how wide the divider stands.
 *
 * PER BROWSER, never the server. It describes a window — where a button was last dragged in THIS
 * tab's viewport — and a server-side row would push one machine's furniture onto another's. It
 * lives in `localStorage` under one key, `'app-switcher'`.
 *
 * WHICH APPLICATIONS ARE OPEN IS NOT IN THE RECORD, and that is a decision rather than an
 * omission. A window that reopens onto somebody else's application instead of onto the workspace
 * is a surprise — the workspace is what this app opens to, every time — and every pane up is an
 * iframe loading on the first paint, so the reader pays for it in time to first paint as well.
 * Only furniture is remembered; the room is always the workspace.
 *
 * Nothing here is a React concern, which is why it is a plain module under `utils/` and not a
 * hook: the record is DATA, and the provider that owns the state reads it once and writes it back.
 */

const STORAGE_KEY = 'app-switcher';

/** At or above this width the FAB starts docked in the sidebar header; below it, it floats. */
const DOCK_MIN_WIDTH = 768;

/**
 * The floating default's inset, in px, from the window's bottom-right corner to the FAB's own
 * top-left corner: 72 leaves the button's right edge 44px off the right of the window, 112 its foot
 * 84px above the bottom edge (measured at 390x844, 2026-09-17). The retired hub's numbers, carried
 * over when the button was 56px and kept when it became 28 — which is why the gaps read wider than
 * the margin they once meant.
 *
 * 84px up is NOT clear of a phone's chat composer, which docks to the same edge: the 44px catch
 * around the dot covers the right end of the composer's first line, and a press there opens the
 * sheet instead of placing the caret. Left as it stands, deliberately — no pair of fixed insets
 * clears a composer whose height follows the text in it and the keyboard, and lifting the button
 * past the composer puts that same 44px catch in the middle of the conversation's scroll, where a
 * press meant for the text moves the button.
 */
const FAB_DEFAULT_INSET_X = 72;
const FAB_DEFAULT_INSET_Y = 112;

/** The divider's starting share of the layer — the midpoint of the 0.15–0.85 range it is clamped to. */
const DEFAULT_RATIO = 0.5;

export type AppSwitcherRecord = {
  fab: { docked: boolean; x: number; y: number };
  dual: boolean;
  ratio: number;
};

/**
 * The record's FAB, in the shape the kit's `DockableFab` takes.
 *
 * The two mappers below are the record's shape and belong with it rather than with the provider that
 * happens to hold the state: the reverse mapper is what a provider writes back, and a second
 * spelling of it is how a stored pair of numbers starts meaning something else.
 */
export function fabPositionOf(fab: AppSwitcherRecord['fab']): DockableFabPosition {
  return fab.docked ? { docked: true } : { docked: false, x: fab.x, y: fab.y };
}

/**
 * The FAB back in the record's shape. A DOCKED position carries `0, 0`: a docked FAB is drawn from the
 * dock's own rect, so its coordinates are not the reader's to remember, and storing a stale pair would
 * only be read again the moment the button left the dock.
 */
export function fabRecordOf(position: DockableFabPosition): AppSwitcherRecord['fab'] {
  if (position.docked) return { docked: true, x: 0, y: 0 };
  return { docked: false, x: position.x, y: position.y };
}

/**
 * The position a reader who has never touched the FAB starts from.
 *
 * Docked from 768px up, floating below it — the operator's "on mobile it floats from the start".
 * A docked FAB carries `0, 0` because a docked FAB's coordinates come from the dock's own rect,
 * not from the record; the two numbers are simply the shape the record already has.
 */
function defaultRecord(): AppSwitcherRecord {
  const docked = window.innerWidth >= DOCK_MIN_WIDTH;
  return {
    fab: docked
      ? { docked: true, x: 0, y: 0 }
      : { docked: false, x: window.innerWidth - FAB_DEFAULT_INSET_X, y: window.innerHeight - FAB_DEFAULT_INSET_Y },
    dual: false,
    ratio: DEFAULT_RATIO,
  };
}

/**
 * Whether a parsed value is a record this module can hand back. Written as a guard rather than a
 * cast because the value comes from storage, which is to say from wherever the last version of
 * this app, another tab, or the reader's own DevTools console left it.
 */
function isAppSwitcherRecord(value: unknown): value is AppSwitcherRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AppSwitcherRecord>;
  const fab = candidate.fab as Partial<AppSwitcherRecord['fab']> | undefined;
  if (typeof fab !== 'object' || fab === null) return false;
  return (
    typeof fab.docked === 'boolean' &&
    Number.isFinite(fab.x) &&
    Number.isFinite(fab.y) &&
    typeof candidate.dual === 'boolean' &&
    Number.isFinite(candidate.ratio)
  );
}

/**
 * The stored record, or the defaults on absent, unreadable or unparseable content.
 *
 * NEVER THROWS, and that is the contract rather than a nicety: this is called while a provider
 * mounts, and a reader whose storage holds a stray character must get a working FAB, not a blank
 * screen and a console full of exceptions. A record that parses but is not the right shape is the
 * same answer as a record that does not parse — the defaults — because a half-read record would
 * put the button somewhere neither the reader nor this app chose.
 */
export function readAppSwitcherRecord(): AppSwitcherRecord {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return defaultRecord();
    const parsed: unknown = JSON.parse(stored);
    return isAppSwitcherRecord(parsed) ? parsed : defaultRecord();
  } catch {
    // A JSON parse failure, or a browser that refuses storage outright (a hardened profile, a
    // sandboxed frame). Both mean the same thing to the caller: nothing was remembered.
    return defaultRecord();
  }
}

/**
 * Writes the record back.
 *
 * A failed write is swallowed on purpose. This runs on a drag RELEASE and on a switch flip, both
 * of which are already complete by the time it is called — the FAB has moved, the panes have
 * changed — so a storage refusal (quota, a hardened profile) is a persistence that did not happen
 * and never a reason to break the interaction that triggered it.
 */
export function writeAppSwitcherRecord(record: AppSwitcherRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Persistence is a convenience here; the state the caller holds is the truth for this session.
  }
}
