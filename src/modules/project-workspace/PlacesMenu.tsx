import { Menu as MenuIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePlaces } from '@/modules/project-workspace/context/PlacesContext';
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
 * Used by `home/WorkspaceHome` (its head's end), `ChatHead` (the end of the chat's head), `WorkspaceMain` (handed to the Bugs view, the end
 * of its head) and, through this module's barrel, the station module's `StationKaylee` (the last press in the row by the companion's name).
 */
export function PlacesMenu({ triggerClassName }: PlacesMenuProps) {
  const { t } = useTranslation();
  const { openWheel } = usePlaces();

  return (
    <Button
      type="button"
      data-places-menu=""
      variant="outline"
      size="icon"
      // `touch-none`: a finger sliding off the press is the wheel's, never a scroll of the page under it.
      className={cn('touch-none', triggerClassName)}
      aria-label={t('places.menu')}
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
    </Button>
  );
}
