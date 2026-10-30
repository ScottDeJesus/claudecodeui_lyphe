import type { DockableFabPosition } from '@/shared/ui';

/**
 * Where her disc rests, kept in `localStorage` under `companion-fab`: PER BROWSER, never the server, since it describes a
 * window — where a button was last dropped in THIS tab's viewport — and a server-side row would push one machine's
 * furniture onto another's (the applications button keeps its place the same way, under `app-switcher`).
 *
 * The record IS the kit's position: `{ docked: true }` or `{ docked: false, x, y }`. Nothing else is remembered; a docked
 * disc is drawn from the dock's own rect, so it carries no coordinates to go stale.
 *
 * Plain functions in a plain module, because the record is data and the provider that holds the state reads it once and
 * writes it back; used by this module's `useCompanionFab`.
 */
const STORAGE_KEY = 'companion-fab';

/** Docked is where a reader who never moved her finds her: in the rail's cell, or in her phone corner where the rail is tucked away. */
const DEFAULT_POSITION: DockableFabPosition = { docked: true };

/**
 * Whether a parsed value is a position this module can hand back. A guard and not a cast, because the value comes from
 * storage, which is to say from wherever the last version of this app, another tab or the reader's own DevTools left it.
 */
function isFabPosition(value: unknown): value is DockableFabPosition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { docked?: unknown; x?: unknown; y?: unknown };
  if (candidate.docked === true) return true;
  return candidate.docked === false && Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

/**
 * The stored position, or docked on absent, unreadable or unparseable content. NEVER THROWS: it runs while the provider
 * mounts, and a stray character in storage must give a working button and not a blank screen. A record that parses but is
 * not a position is the same answer as one that does not parse, because a half-read point would put her somewhere neither
 * the reader nor this app chose.
 */
export function readFabPosition(): DockableFabPosition {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_POSITION;
    const parsed: unknown = JSON.parse(stored);
    if (!isFabPosition(parsed)) return DEFAULT_POSITION;
    return parsed.docked ? DEFAULT_POSITION : { docked: false, x: parsed.x, y: parsed.y };
  } catch {
    // A JSON parse failure, or a browser that refuses storage outright (a hardened profile, a sandboxed frame): nothing was remembered.
    return DEFAULT_POSITION;
  }
}

/**
 * Writes the position back, from the release of a drag. A failed write is swallowed on purpose: the drop is complete by
 * the time this runs and the state the provider holds is the truth for this session, so a storage refusal (quota, a
 * hardened profile) is a persistence that did not happen and never a reason to break the drop.
 */
export function writeFabPosition(position: DockableFabPosition): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Persistence is a convenience here; the position the provider holds is kept for the page's life.
  }
}
