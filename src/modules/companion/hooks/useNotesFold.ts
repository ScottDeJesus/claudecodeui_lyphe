import { useCallback, useState } from 'react';

import { readNotesFolded, writeNotesFolded } from '@/modules/companion/utils/companionPanelStorage';
import type { CompanionNote } from '@/shared/companion-types';

const NONE: ReadonlySet<number> = new Set();

/**
 * Her notes' fold on the panel: whether he keeps them folded to their count line, the one press that turns it, and which
 * of the notes arrived while they were folded — the ones the folded line marks as new until he opens it.
 *
 * THE FOLD is his, kept in this browser (`companion-notes-fold`, read once and written at each press) and never turned by
 * anything she does: a note arriving while the notes are folded leaves them folded. Dismissing the last note takes the
 * section away and leaves the fold as it was, so the next note to arrive comes up folded, marked new.
 *
 * NEW is a note he has not had the chance to see: not among the notes of the first picture this page read (those were up
 * before the page loaded, and are no news), and not on the panel at any moment it was open. Kept here, in the panel that
 * is mounted for the page's life, and not in the notes section, which unmounts with its last note.
 *
 * Used by this module's CompanionPanel, which hands the fold to its notes' scroller (folded, it stands at its one line)
 * and all three to `CompanionNotes`.
 */
export function useNotesFold(notes: CompanionNote[] | null): {
  folded: boolean;
  setFolded: (folded: boolean) => void;
  fresh: ReadonlySet<number>;
} {
  // Whether he keeps her notes folded, read once from this browser's storage; his press writes it back.
  const [folded, setFoldedState] = useState(readNotesFolded);
  // The ids of the notes he has had the chance to see; null until her first picture lands, which seeds it.
  const [seen, setSeen] = useState<ReadonlySet<number> | null>(null);

  // Both updates happen while rendering, which React re-runs at once: the first picture's notes are seen, and every note
  // is seen while the section is open.
  const ids = notes?.map((note) => note.id) ?? null;
  if (ids !== null && (seen === null || (!folded && ids.some((id) => !seen.has(id))))) setSeen(new Set(ids));

  const setFolded = useCallback((next: boolean) => {
    setFoldedState(next);
    writeNotesFolded(next);
  }, []);

  const fresh = ids === null || seen === null ? NONE : new Set(ids.filter((id) => !seen.has(id)));
  return { folded, setFolded, fresh };
}
