import { useCallback, useState } from 'react';

import { readFabPosition, writeFabPosition } from '@/modules/companion/utils/companionFabStorage';
import type { DockableFabPosition } from '@/shared/ui';
import { dockableRect, sameRect } from '@/shared/utils';

/** What the provider hands on about her disc and the rail cell that is its seat; the context documents each field. */
type CompanionFabState = {
  fabPosition: DockableFabPosition;
  moveFab: (next: DockableFabPosition) => void;
  dockRect: DOMRect | null;
  registerDock: (rect: DOMRect | null) => void;
  fabAway: boolean;
  setFabAway: (away: boolean) => void;
};

/**
 * Used by this module's CompanionProvider, once per page: the three things her disc (CompanionFab, mounted over the whole
 * workspace) and her rail cell (CompanionDock, mounted in the rail) have to agree on, and which neither owns. The disc
 * reads the rest and the rect to dock to; the cell reports the rect and reads whether the disc rests in it or is out on a
 * look; so the meeting place is the provider both stand under.
 *
 * `registerDock` believes a rect only while it is on screen (`dockableRect`), and keeps the object it found when the
 * answer is the same place (`sameRect`): the cell re-reports on every resize, and a fresh rect with the same numbers would
 * render the provider for nothing.
 */
export function useCompanionFab(): CompanionFabState {
  // Where she rests, read once from this browser's storage and set at the release of a drag. State because the disc and the
  // cell both draw from it; the storage is written beside it, from the same release, so a reload straight after a drop finds it.
  const [fabPosition, setFabPosition] = useState(readFabPosition);
  // The rail cell's rect while the rail is docked and on screen, else null. State because the disc is drawn centred on it.
  const [dockRect, setDockRect] = useState<DOMRect | null>(null);
  // Whether a look holds her disc away from its seat. State because the cell shows its quiet ring while it does, and the
  // disc, which knows the look, is not the cell's parent.
  const [fabAway, setFabAway] = useState(false);

  const moveFab = useCallback((next: DockableFabPosition) => {
    setFabPosition(next);
    writeFabPosition(next);
  }, []);

  const registerDock = useCallback((rect: DOMRect | null) => {
    setDockRect((current) => {
      const next = dockableRect(rect);
      return sameRect(current, next) ? current : next;
    });
  }, []);

  return { fabPosition, moveFab, dockRect, registerDock, fabAway, setFabAway };
}
