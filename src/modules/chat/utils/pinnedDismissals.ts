import { useSyncExternalStore } from 'react';

/**
 * What this browser's reader has taken out of the pinned rows.
 *
 * ONE LIST FOR BOTH KINDS OF PIN, and one list for every conversation. A pin's id is unique on its
 * own — an `Agent` tool id or a launcher's launch id — so a second store would only be a second
 * thing to remember to write, and the reader's act is the same act either way: this one is done
 * with me, take it away. What they dismissed is a fact about THEM and this browser, not about the
 * conversation, which is why it lives here rather than in a transcript.
 *
 * Held in `localStorage` so a reload does not bring a dismissed row back: a finished agent's row
 * has no other way to leave, and the transcript it was read from will still be there tomorrow.
 * A SECOND TAB is why the list is read again on the `storage` event rather than held from mount —
 * the reader may have the same chat open twice, and one tab's dismissal is the same reader's act.
 *
 * ONE SNAPSHOT FOR EVERY COPY OF THE ROWS. While the desktop gutters show, the rows are drawn
 * twice — once for the widget's list and once for the tab count beside it — so a per-component
 * `useState` seeded from storage would give each copy its own reading and a dismissal made in one
 * would leave the other stale. This module holds the one list they all read, and every dismissal
 * is written here.
 */
const DISMISSED_STORAGE_KEY = 'cloudcli.pinned-agents.dismissed';

/**
 * The ceiling on remembered dismissals. Ids are minted forever, so the list has to stop growing
 * somewhere; the cap is far above any strip a reader could work through, and the oldest go first.
 */
const DISMISSED_CAP = 500;

/**
 * The list every subscriber reads, as the last write left it. `null` until something first asks,
 * so a document that never opens a chat never touches storage. Its IDENTITY is what
 * `useSyncExternalStore` compares, so a snapshot is replaced only by a dismissal (or by another
 * tab's, below) — never rebuilt per read, which would re-render every reader on every render.
 */
let dismissed: Set<string> | null = null;

const listeners = new Set<() => void>();

/** Whether the cross-tab listener is attached — it follows the subscribers, and nothing else. */
let listening = false;

/**
 * Another tab's dismissal, which `localStorage` reports here and nowhere else. Without this the
 * snapshot would be this document's reading alone: a second tab's dismissal would never show, and
 * this tab's next `dismissPin` would write the list it holds — dropping whatever the other tab had
 * added since. Re-read whole rather than merged: storage is the one list, this is a copy of it.
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== DISMISSED_STORAGE_KEY) return;
  dismissed = readDismissed();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Attached with the first reader and dropped with the last, so a document that never opens a
  // chat never listens either.
  if (!listening) {
    window.addEventListener('storage', onStorage);
    listening = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && listening) {
      window.removeEventListener('storage', onStorage);
      listening = false;
    }
  };
}

function getSnapshot(): Set<string> {
  if (dismissed === null) dismissed = readDismissed();
  return dismissed;
}

/**
 * The reader's dismissals, shared by every copy of the pinned rows — the strip above the chat box
 * and the gutter's Subagents widget read the one list. Drawn by the chat module
 * (`hooks/usePinnedSubagentRows.ts`), which both of those go through.
 */
export function useDismissedPins(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * The reader's act, in one place: take these rows away for good. Written through to storage, then
 * published as the new snapshot so every copy of the rows drops them in the same frame.
 *
 * IT TAKES A LIST because the widget's "Clear completed" is ONE act on many rows, and dismissing
 * them one at a time would be one storage write and one publish per row — every copy of the list
 * re-rendered N times, with the rows shrinking under the reader's cursor on each. Ids already
 * dismissed cost nothing; a call with nothing new in it publishes nothing at all, so a press with
 * no work in it cannot repaint the strip.
 */
export function dismissPins(ids: string[]): void {
  const current = getSnapshot();
  const added = ids.filter((id) => !current.has(id));
  if (added.length === 0) return;

  const next = new Set(current);
  for (const id of added) next.add(id);
  writeDismissed(next);
  dismissed = next;
  for (const listener of listeners) listener();
}

/** One row, through the same door. */
export function dismissPin(id: string): void {
  dismissPins([id]);
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    // Unreadable or unavailable storage is not a failure: the strip simply offers everything,
    // which is the state the reader started in.
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids].slice(-DISMISSED_CAP)));
  } catch {
    // Storage full or unavailable: the dismissal still holds for this page's life.
  }
}
