import { Check } from 'lucide-react';

import type { PlaceMark } from '@/shared/types';

/**
 * A mark of what waits, drawn on the top right corner of what it marks (its parent places it): the accent's bead, breathing, for a word
 * owed; the green tick for finished work not yet seen. Hidden from a reader of the screen, who hears the mark's words as the marked
 * press's description. Drawn by this module's `PlacesWheel`, on a place's glyph (the menu draws what waits as beads on its dial).
 */
export function PlaceMarkDot({ kind }: { kind: PlaceMark['kind'] }) {
  return (
    <span className="places-mark" data-mark={kind} aria-hidden="true">
      {kind === 'done' && <Check strokeWidth={4} />}
    </span>
  );
}
