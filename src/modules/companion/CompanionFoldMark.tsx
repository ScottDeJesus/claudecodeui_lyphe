import type { ReactNode } from 'react';

/**
 * The mark a folded section of her dock wears for what came while it was folded — "1 new" on her notes' count line, "New"
 * or "Edited" on her draft's line: her accent's soft ground and ink, upper case and tracked like the eyebrow beside it,
 * popping in once as it appears (`animate-mark-in`, under `motion-safe:`, so not at all under `prefers-reduced-motion`).
 * The caller keys it by what it marks, so each arrival pops it in again and nothing else does, and passes the data hook a
 * reader finds it by (`data-companion-notes-new`, `data-companion-draft-mark`), which is drawn onto the mark as given.
 *
 * Used by this module's CompanionNotes and CompanionDraftFoldLine, so the two folds' cue is one look.
 */
export function CompanionFoldMark({ children, ...hooks }: { children: ReactNode }) {
  return (
    <span
      {...hooks}
      className="shrink-0 whitespace-nowrap rounded bg-accent-soft px-1.5 text-xs font-medium uppercase leading-4 tracking-[0.14em] text-accent-ink motion-safe:animate-mark-in"
    >
      {children}
    </span>
  );
}
