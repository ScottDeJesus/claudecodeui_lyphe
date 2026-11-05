import { usePanelFold } from '@/modules/companion/hooks/usePanelFold';
import type { CompanionNote } from '@/shared/companion-types';

const NONE: ReadonlySet<number> = new Set();

/** Whether every note on the panel now is one he has had the chance to see: her notes' one news is a note he has not. */
const noNewNote = (seen: readonly number[], now: readonly number[]): boolean => now.every((id) => seen.includes(id));

/**
 * Her notes' fold on the panel (`usePanelFold`, section `notes`): whether he keeps them folded to their count line, the one
 * press that turns it, and which of the notes arrived while they were folded — the ones the folded line marks as new until
 * he opens it. A note arriving while the notes are folded leaves them folded; dismissing the last note takes the section
 * away and leaves the fold as it was, so the next note to arrive comes up folded, marked new.
 *
 * NEW is a note he has not had the chance to see: not among the notes of the first picture this page read (those were up
 * before the page loaded, and are no news), and not on the panel at any moment it was open.
 *
 * Used by this module's CompanionPanel, which hands the fold to its notes' scroller (folded, it stands at its one line)
 * and all three to `CompanionNotes`.
 */
export function useNotesFold(notes: CompanionNote[] | null): {
  folded: boolean;
  setFolded: (folded: boolean) => void;
  fresh: ReadonlySet<number>;
} {
  // The section as the picture holds it: undefined before her first picture, null while there is no note.
  const ids = notes === null ? undefined : notes.length > 0 ? notes.map((note) => note.id) : null;
  const { folded, setFolded, seen } = usePanelFold('notes', ids, noNewNote);
  const fresh = ids === undefined || ids === null ? NONE : new Set(ids.filter((id) => !(seen?.includes(id) ?? false)));
  return { folded, setFolded, fresh };
}
