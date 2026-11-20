import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { KanbanBoardDialogMode } from '@/modules/kanban/KanbanBoardDialog';

/**
 * Carries the server's refusal of a board's repositories to the board dialog.
 *
 * TWO REFUSALS, BOTH IN THE SERVER'S WORDS. The 409 `KANBAN_BOARD_NEEDS_REPOS` that a refused Autonomy
 * switch answers with opens the dialog on Repositories, with the sentence above the list. The 400 for a
 * repositories list the server would not take is said under the field, and the dialog stays open over
 * the draft.
 *
 * ONE REFUSAL AT A TIME. A newer one replaces the older, because the dialog shows one sentence.
 *
 * IT IS CLEARED WHEN THE DIALOG CLOSES, and by a write that lands, so a sentence never outlives the box
 * it explained.
 *
 * WHY A MODULE STORE AND NOT REACT STATE. The board hook that meets the refusal and the panel that opens
 * the dialog share no prop, and the panel is mounted once, so there is one reader.
 */

/** A refusal the board hook publishes and the panel reads. */
export type BoardReposRefusal = {
  /**
   * `needs-repos` is the 409 of the Autonomy switch on a board with no repository; `refused` a list of
   * repositories the server would not take.
   */
  kind: 'needs-repos' | 'refused';
  /** The server's own words, shown as they came. */
  sentence: string;
};

let held: BoardReposRefusal | null = null;
const listeners = new Set<() => void>();

/**
 * Called by the board hook with a refusal when a write is refused, and with `null` when a write lands.
 * Every listener is called on a change; the same object already held is a no-op.
 */
export function sayBoardReposRefusal(next: BoardReposRefusal | null): void {
  if (next === held) return;
  held = next;
  listeners.forEach((listener) => listener());
}

/**
 * The dialog's two sentences, and the one act a `needs-repos` refusal asks for: opening the dialog on
 * Repositories. `dialog` is the dialog's current mode; `setDialog` is the panel's state setter.
 */
export function useBoardReposPrompt(
  dialog: KanbanBoardDialogMode,
  setDialog: (mode: KanbanBoardDialogMode) => void,
): { notice: string | null; refusal: string | null } {
  const said = useSyncExternalStore(subscribe, snapshot);
  const shownRef = useRef(dialog);

  // Runs once per refusal. Re-running it when the dialog closes would reopen the box the reader just
  // closed, so `dialog` is deliberately not in these deps.
  useEffect(() => {
    if (said?.kind === 'needs-repos') setDialog('repos');
  }, [said, setDialog]);

  // Cleared on the CLOSE, never on a dialog that was never open, because the refusal that opens the
  // dialog arrives while it is still closed.
  useEffect(() => {
    const previous = shownRef.current;
    shownRef.current = dialog;
    if (previous !== null && dialog === null) sayBoardReposRefusal(null);
    // A refusal of a list belongs to the dialog that sent it; one that landed after that dialog closed
    // must not stand in the next. A `needs-repos` refusal is kept, because it is what opened the dialog.
    if (previous === null && dialog !== null && held?.kind === 'refused') sayBoardReposRefusal(null);
  }, [dialog]);

  return {
    notice: said?.kind === 'needs-repos' ? said.sentence : null,
    refusal: said?.kind === 'refused' ? said.sentence : null,
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): BoardReposRefusal | null {
  return held;
}
