import '@/modules/project-workspace/places/places.css';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlaces } from '@/modules/project-workspace/context/PlacesContext';
import { PlacesDial } from '@/modules/project-workspace/places/PlacesWheel';
import { HEAD_PRESS } from '@/shared/constants';
import { cn } from '@/shared/utils';

/**
 * THE ONE WAY TO EVERY OTHER PLACE, the same press in the same corner of every page: the wheel of places folded small (`PlacesDial`),
 * which brings the wheel up (`PlacesWheel`, through `PlacesProvider`) and is seen to grow into it. It comes up AS THE PRESS GOES DOWN,
 * so the press that summoned it can slide on to a place and let go there; let go anywhere else, it stays up to be pressed. A press by
 * key (Enter, Space) brings it up too. Which place is here is the provider's to know, not the page's.
 *
 * It is an object, pressed as itself with no box round it, as a ring is; its size is the head's press (`HEAD_PRESS`): 36 px at a desk,
 * drawn 28 px under a finger and caught at 44.
 *
 * WHAT WAITS ELSEWHERE IS DRAWN ON IT WHERE IT WAITS (the provider's `waiting`): a bead on the dial at that place's bearing, the
 * accent's for a word owed, the green for finished work unseen. `data-mark` says the strongest of them (`menuMark`): `owed` while any
 * place owes a word, else `done`. A reader of the screen hears the places and their words as the press's description; its name stays
 * "Menu".
 *
 * Used by `ScreenHead` (the end of every screen's head), `ChatHead` (the end of the chat's head), `WorkspaceMain` (handed to the Bugs
 * view, the end of its head), `PlacesCorner` (the station's corner) and `home/WorkspaceHome` (the home's head).
 */
export function PlacesMenu() {
  const { t } = useTranslation();
  const { places, waiting, menuMark, openWheel } = usePlaces();
  const markId = useId();

  return (
    <button
      type="button"
      data-places-menu=""
      data-mark={menuMark?.kind}
      // `touch-none`: a finger sliding off the press is the wheel's, never a scroll of the page under it.
      className={cn('places-menu touch-none', HEAD_PRESS)}
      aria-label={t('places.menu')}
      aria-describedby={menuMark === null ? undefined : markId}
      title={t('places.menu')}
      aria-haspopup="menu"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        openWheel(event.currentTarget, event.pointerId);
      }}
      onClick={(event) => {
        // A pointer's press brought it up on the way down; a key's press (no pointer, `detail` 0) arrives here alone.
        if (event.detail === 0) openWheel(event.currentTarget, null);
      }}
    >
      <PlacesDial places={places} waiting={waiting} />
      {menuMark !== null && <span id={markId} hidden>{menuMark.words}</span>}
    </button>
  );
}
