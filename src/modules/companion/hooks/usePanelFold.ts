import { useCallback, useState } from 'react';

import { readFolded, writeFolded } from '@/modules/companion/utils/companionPanelStorage';
import type { CompanionFoldSection } from '@/shared/types';

/**
 * One fold of her panel's dock, her notes' or her draft's: whether he keeps the section folded to its one line, the one
 * press that turns it, and what of the section he last had the chance to see, which its folded line measures news against.
 *
 * THE FOLD is his, kept in this browser (`companion-notes-fold`, `companion-draft-fold`: read once, written at each press)
 * and never turned by anything she does: what she puts in the section while it is folded leaves it folded, and the section
 * emptying leaves the fold as it was. The two sections' folds are independent.
 *
 * SEEN is what he has had the chance to see: the section in the first picture this page read (it was up before the page
 * loaded, and is no news), then the section at every moment it is open, and an empty section at once, folded or not (it
 * hides nothing, so whatever comes into it next has arrived), and what he did himself, handed to `see` (the draft's echo of
 * his own save: he wrote it, so it is seen by definition). `now` is the section as the picture holds it: undefined until
 * her first picture lands, null while the section is empty. `same(seen, now)` says whether `now` holds nothing that `seen`
 * did not. Kept here, in the panel that is mounted for the page's life, and not in the section, which unmounts when it
 * empties: the next thing to arrive must still come up folded and marked.
 *
 * Used by this module's useNotesFold and useDraftFold, which say what news is for their own section.
 */
export function usePanelFold<T>(
  section: CompanionFoldSection,
  now: T | null | undefined,
  same: (seen: T, now: T) => boolean,
): { folded: boolean; setFolded: (folded: boolean) => void; seen: T | null; see: (value: T) => void } {
  // Whether he keeps the section folded, read once from this browser's storage; his press writes it back.
  const [folded, setFoldedState] = useState(() => readFolded(section));
  // What of the section he has had the chance to see, boxed so that a section seen empty (a box holding null) is told from
  // her first picture not landed yet (no box).
  const [seen, setSeen] = useState<{ value: T | null } | null>(null);

  // Set while rendering, which React re-runs at once, so no render is drawn with the old `seen`.
  if (now !== undefined) {
    const renew = seen === null
      || (now === null ? seen.value !== null : !folded && (seen.value === null || !same(seen.value, now)));
    if (renew) setSeen({ value: now });
  }

  const setFolded = useCallback((next: boolean) => {
    setFoldedState(next);
    writeFolded(section, next);
  }, [section]);
  const see = useCallback((value: T) => setSeen({ value }), []);

  return { folded, setFolded, seen: seen?.value ?? null, see };
}
