import '@/modules/project-workspace/places/places.css';

import { Menu as MenuIcon } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlaces } from '@/modules/project-workspace/context/PlacesContext';
import { PlaceMarkDot } from '@/modules/project-workspace/places/PlaceMarkDot';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

type PlacesMenuProps = {
  /** Classes for the press, whose size is its page's to say (the home's corner, the chat's head, the row by the companion's name). */
  triggerClassName?: string;
};

/**
 * THE ONE WAY TO EVERY OTHER PLACE, the same press on each page: the menu mark, which brings up the wheel of places (`PlacesWheel`,
 * through `PlacesProvider`). It comes up AS THE PRESS GOES DOWN, so the press that summoned it can slide on to a place and let go
 * there; let go anywhere else, it stays up to be pressed. A press by key (Enter, Space) brings it up too. Which place is here is the
 * provider's to know, not the page's.
 *
 * WHAT WAITS ELSEWHERE IS MARKED ON IT (the provider's `menuMark`): the accent's bead while a place away from here owes a word, else the
 * green tick while one has finished work unseen. A reader of the screen hears the places and their words as the press's description;
 * its name stays "Menu".
 *
 * Used by `home/WorkspaceHome` (its head's end), `ChatHead` (the end of the chat's head), `ScreenHead` (the end of every other screen's
 * head), `WorkspaceMain` (handed to the Bugs view, the end of its head) and, through this module's barrel, the station module's
 * `StationKaylee` (the last press in the row by the companion's name).
 */
export function PlacesMenu({ triggerClassName }: PlacesMenuProps) {
  const { t } = useTranslation();
  const { menuMark, openWheel } = usePlaces();
  const markId = useId();

  return (
    <Button
      type="button"
      data-places-menu=""
      data-mark={menuMark?.kind}
      variant="outline"
      size="icon"
      // `touch-none`: a finger sliding off the press is the wheel's, never a scroll of the page under it. `relative`: the mark's corner.
      className={cn('relative touch-none', triggerClassName)}
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
      <MenuIcon aria-hidden="true" />
      {menuMark !== null && (
        <>
          <PlaceMarkDot kind={menuMark.kind} />
          <span id={markId} hidden>{menuMark.words}</span>
        </>
      )}
    </Button>
  );
}
