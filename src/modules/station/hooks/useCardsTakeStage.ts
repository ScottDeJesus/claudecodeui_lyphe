import { useEffect, useRef } from 'react';

import { useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import type { CompanionNote } from '@/shared/companion-types';

/** What this page had seen of her picture when it last looked: the newest card's id, and when her walk last changed. */
type Seen = { noteId: number; walkAt: string | null };

/** The id of the newest card in a list (card ids only grow), or 0 for none. */
function newestId(notes: CompanionNote[]): number {
  return notes.reduce((newest, note) => Math.max(newest, note.id), 0);
}

/**
 * HER NEW CARD AND HER WALK TAKE THE STAGE ("one focus at a time"): a card she puts up, and a walk she starts or moves, are
 * put on the stage the moment her picture says so, whatever stood there. The focus they replace goes onto the back-stack
 * (`setFocus`), so Back returns him to what he was reading.
 *
 * WHAT IS NEW is measured against what this page had seen. The first picture that lands is only noted: its newest card id and
 * its walk's `updatedAt`, so a reload, or opening the station on a conversation that already holds cards and a walk, never
 * steals the stage from the focus the page restores. After that, a card with a higher id than any seen puts
 * `{ kind: 'note', id, label: title }` on the stage (the highest, when several arrive together), and a walk whose `updatedAt`
 * is not the one seen puts `{ kind: 'walk', label }` there. A walk and a card that land in one picture leave the walk on top.
 * Staging what already stands on the stage changes nothing (`setFocus`), so his own Next on the walk stage is not a new focus.
 * A card taken down, a walk ended and his Clear are noted too, and put nothing on the stage.
 *
 * It runs on the picture her frames fold, so no timer and no poll stand behind it.
 *
 * Used by `StationRoute`, once, inside her provider and the station's.
 */
export function useCardsTakeStage(): void {
  const { picture } = useCompanion();
  const { setFocus } = useStation();
  // What this page has seen of her picture; null until the first picture lands. A ref: the effect decides from it, nothing is drawn from it.
  const seen = useRef<Seen | null>(null);

  useEffect(() => {
    if (picture === null) return;
    const now: Seen = { noteId: newestId(picture.notes), walkAt: picture.walk?.updatedAt ?? null };
    const before = seen.current;
    // The newest id only grows: a card taken down never lets a later, lower id read as new.
    seen.current = { noteId: Math.max(before?.noteId ?? 0, now.noteId), walkAt: now.walkAt };
    if (before === null) return;

    if (now.noteId > before.noteId) {
      const card = picture.notes.find((note) => note.id === now.noteId);
      if (card) setFocus({ kind: 'note', id: card.id, label: card.title });
    }
    if (picture.walk !== null && now.walkAt !== before.walkAt) {
      setFocus({ kind: 'walk', label: picture.walk.session.name || picture.walk.session.sessionId });
    }
  }, [picture, setFocus]);
}
