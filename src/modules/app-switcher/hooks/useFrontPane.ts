import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { EMPTY_SLOT, loneAppOnTheLeft } from '@/modules/app-switcher/utils/paneSlots';
import type { PaneSide, PaneSlot } from '@/shared/types';

/**
 * Which pane is in FRONT — the one the reader's acts (Reload, Close, Open in a new tab) are about —
 * and the way to take one pane down.
 *
 * Mounted by `AppSwitcherProvider`, which owns the panes and hands them in. The front pane is the
 * side whose frame last took focus: a pane is a cross-origin iframe, so the page never hears the
 * click that lands in it, but the window loses focus to the frame, and at that `blur` the
 * document's active element IS that frame. `AppPane` carries `data-pane-side` for exactly this. A move
 * from one frame straight into the other is read at the reader's next press in the page (below).
 */
export function useFrontPane(
  panes: Record<PaneSide, PaneSlot>,
  setPanes: Dispatch<SetStateAction<Record<PaneSide, PaneSlot>>>,
): { frontSide: PaneSide; closePane: (side: PaneSide) => void } {
  // The side whose frame last took focus, which is what "the application in front" means here. State
  // rather than a ref because the FAB's radial and the palette draw their disabled state from it.
  const [frontSide, setFrontSide] = useState<PaneSide>('left');

  // The panes live in the opener, so these are the opener's window. The attribute is read off the
  // element rather than asking its constructor: a frame is not an `instanceof` anything the page can
  // rely on across hosts.
  //
  // Two moments read it, because the page hears about focus moving into a frame exactly once. `blur`
  // fires when focus leaves the page for a frame; moving from one frame straight into the other fires
  // NOTHING in the page (measured, 2026-09-29: no blur, focus or focusin, though `activeElement`
  // changes), so the frame the reader last used is also read at their next press in the page — the
  // capture-phase `pointerdown` lands before the press takes focus off the frame.
  useEffect(() => {
    function takeFrontFromFocus() {
      const side = document.activeElement?.getAttribute('data-pane-side');
      if (side === 'left' || side === 'right') setFrontSide(side);
    }
    window.addEventListener('blur', takeFrontFromFocus);
    window.addEventListener('pointerdown', takeFrontFromFocus, true);
    return () => {
      window.removeEventListener('blur', takeFrontFromFocus);
      window.removeEventListener('pointerdown', takeFrontFromFocus, true);
    };
  }, []);

  // A lone application is always left (`loneAppOnTheLeft`), and a side that empties has no frame to be
  // in front. Without the reset, Close on a survivor that moved left would aim at the empty right.
  const frontAppId = panes[frontSide].appId;
  useEffect(() => {
    if (frontAppId === null) setFrontSide('left');
  }, [frontAppId]);

  const closePane = useCallback((side: PaneSide) => {
    // A survivor moves left, so the layer and the state go on saying one thing.
    setPanes((current) => loneAppOnTheLeft({ ...current, [side]: EMPTY_SLOT }));
  }, [setPanes]);

  // What readers get is the side READ as in front, not the stored one: the effect above runs a commit
  // AFTER the panes change, so for that one render the stored side still names the emptied slot, and
  // every reader would see "no application up" (measured, 2026-09-30: dual screen, the front right pane
  // closed while the left application stayed up — `useCurrentApplication()` read null for a commit, and
  // the chat door, which forgets its route when nothing is up, re-routed inside a visit that never
  // ended). A survivor is always left, so an emptied side reads as the left one at once; the effect
  // still resets the stored side, or a later fill of the right would silently take the front.
  const readSide: PaneSide = frontAppId === null ? 'left' : frontSide;

  return { frontSide: readSide, closePane };
}
