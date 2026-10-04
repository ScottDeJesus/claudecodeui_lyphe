/**
 * The floating chat panel's one piece of persisted state: the size the reader gave it.
 *
 * PER BROWSER, never the server, and under one `localStorage` key, `'chat-host'`, as
 * `{ panel: { width, height } }`. It describes a window — how big the panel was last dragged in THIS
 * tab — and a server-side row would push one machine's furniture onto another's.
 *
 * WHERE THE CHAT IS DRAWN IS NOT IN THE RECORD, and the panel's POSITION is not either. Both are
 * decisions rather than omissions: the chat is home on every load, and the panel stands beside the FAB
 * wherever the FAB is, so a stored position would only be a second answer to a question the FAB
 * already answers. Only furniture is remembered; the room is always the workspace.
 *
 * Nothing here is a React concern, which is why it is a plain module under `utils/` and not a hook: the
 * record is DATA, read once when the panel opens and written once when a resize ends.
 */

const STORAGE_KEY = 'chat-host';

type PanelSize = { width: number; height: number };

/**
 * Whether a value is a size the panel can stand at. Written as a guard rather than a cast because the
 * value comes from storage, which is to say from wherever the last version of this app, another tab, or
 * the reader's own DevTools console left it. Zero and negative extents are refused: a panel with no
 * room in it is not a size anyone chose.
 */
function isPanelSize(value: unknown): value is PanelSize {
  if (typeof value !== 'object' || value === null) return false;
  const { width, height } = value as Partial<PanelSize>;
  return Number.isFinite(width) && Number.isFinite(height) && (width as number) > 0 && (height as number) > 0;
}

/**
 * The stored panel size, or null when there is none worth using.
 *
 * NEVER THROWS, and that is the contract rather than a nicety: this runs while the panel opens, and a
 * reader whose storage holds a stray character must get a panel at its default size, not a blank
 * screen. Absent, unparseable and wrongly shaped content all mean the same thing — nothing was
 * remembered — and the caller takes null as "use the default size".
 *
 * Used by chat-host's panel.
 */
export function readPanelSize(): PanelSize | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    const panel = typeof parsed === 'object' && parsed !== null ? (parsed as { panel?: unknown }).panel : undefined;
    return isPanelSize(panel) ? { width: panel.width, height: panel.height } : null;
  } catch {
    // A JSON parse failure, or a browser that refuses storage outright (a hardened profile, a
    // sandboxed frame). Both mean the same thing to the caller: nothing was remembered.
    return null;
  }
}

/**
 * Writes the panel size back.
 *
 * A size that is not a size is not written, so a bad call cannot leave a record that reads back as
 * junk. A failed write is swallowed on purpose: this runs on a resize RELEASE, which is already
 * complete by the time it is called, so a storage refusal (quota, a hardened profile) is a
 * persistence that did not happen and never a reason to break the resize that triggered it.
 *
 * Used by chat-host's panel, once per resize.
 */
export function writePanelSize(size: PanelSize): void {
  if (!isPanelSize(size)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ panel: { width: size.width, height: size.height } }));
  } catch {
    // Persistence is a convenience here; the size the panel holds is the truth for this session.
  }
}
