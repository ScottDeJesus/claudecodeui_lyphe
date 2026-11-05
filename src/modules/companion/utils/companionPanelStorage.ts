import type { CompanionFoldSection, CompanionPanelRect } from '@/shared/types';

/**
 * Her panel's furniture, kept per browser in `localStorage` as her disc's place is (`companionFabStorage.ts`): it
 * describes a window — where he left the panel in THIS browser — and a server-side row would push one machine's
 * furniture onto another's. Three records, one key each:
 *
 * - `companion-panel`: where her floating panel stands and how big it is, `{ left, top, width, height }`
 *   (`CompanionPanelRect`), written once at the release of each move or resize. Absent means her default stance.
 * - `companion-notes-fold` and `companion-draft-fold`: `'folded'` while he keeps that section of her dock folded to its one
 *   line (her notes to their count line, her draft to its head row), removed when he opens it again; the two are
 *   independent. Absent means open — the safe direction, since a lost record shows more, never less.
 *
 * Plain functions in a plain module: the records are data, read once when her panel mounts and written back on his
 * press. Used by this module's `useCompanionPanelPlace` and `usePanelFold`.
 */
const PANEL_KEY = 'companion-panel';
/** Each folding section's record. */
const FOLD_KEYS: Record<CompanionFoldSection, string> = { notes: 'companion-notes-fold', draft: 'companion-draft-fold' };
const FOLDED = 'folded';

/**
 * Whether a parsed value is a box the panel can stand in. A guard and not a cast: the value comes from storage, which
 * is to say from wherever the last version of this app, another tab or his own DevTools left it. A box with no room in
 * it is not one anybody chose.
 */
function isPanelRect(value: unknown): value is CompanionPanelRect {
  if (typeof value !== 'object' || value === null) return false;
  const { left, top, width, height } = value as Partial<Record<keyof CompanionPanelRect, unknown>>;
  return Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(width) && Number.isFinite(height)
    && (width as number) > 0 && (height as number) > 0;
}

/**
 * The stored box, or null for her default stance on absent, unreadable or wrongly shaped content. NEVER THROWS: it runs
 * as her panel mounts, and a stray character in storage must give her panel at its default, not a blank screen.
 */
export function readPanelRect(): CompanionPanelRect | null {
  try {
    const stored = window.localStorage.getItem(PANEL_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return isPanelRect(parsed) ? { left: parsed.left, top: parsed.top, width: parsed.width, height: parsed.height } : null;
  } catch {
    // A JSON parse failure, or a browser that refuses storage (a hardened profile, a sandboxed frame): nothing was remembered.
    return null;
  }
}

/**
 * Writes the box back, at the release of a move or a resize. A failed write is swallowed: the drag is complete by the
 * time this runs and the box the panel holds is the truth for this page, so a refusal (quota, a hardened profile) is a
 * persistence that did not happen, never a reason to break the drag.
 */
export function writePanelRect(rect: CompanionPanelRect): void {
  if (!isPanelRect(rect)) return;
  try {
    window.localStorage.setItem(PANEL_KEY, JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
  } catch {
    // Persistence is a convenience here; the box the panel holds is kept for the page's life.
  }
}

/** Whether he left that section of her dock folded in this browser. Never throws: storage that cannot be read is a section left open. */
export function readFolded(section: CompanionFoldSection): boolean {
  try {
    return window.localStorage.getItem(FOLD_KEYS[section]) === FOLDED;
  } catch {
    return false;
  }
}

/** Writes his fold back, on the press: folded is the one value kept, open removes the record. A refusal is swallowed, as above. */
export function writeFolded(section: CompanionFoldSection, folded: boolean): void {
  try {
    if (folded) window.localStorage.setItem(FOLD_KEYS[section], FOLDED);
    else window.localStorage.removeItem(FOLD_KEYS[section]);
  } catch {
    // The fold the panel holds is kept for the page's life.
  }
}
