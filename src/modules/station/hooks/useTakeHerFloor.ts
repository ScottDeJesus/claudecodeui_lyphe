import { useEffect, useRef } from 'react';

import { useCompanion } from '@/modules/companion';
import { useStationShowing } from '@/shared/context/StationLayerContext';

/**
 * The station is her home, so while it is the page on screen it holds her floor: the page she acts on, and the one that plays her voice. It takes
 * the floor as it comes on screen and whenever its window gains focus — the provider's `takeFloor`, the act that opening her panel also makes, without
 * the panel opening (the workspace's panel is as he left it when he returns) — so an alert she speaks unasked plays where he keeps her. The
 * workspace takes the floor back by its own acts (typing to her, opening her panel); nothing here holds it against them.
 *
 * ONLY WHEN THE FLOOR IS NOT ALREADY THIS PAGE'S. The workspace and the station are one page now, so a switch to the station finds the floor where the workspace's
 * own acts left it; a call made anyway would be a write the server answers with a frame, and her picture, which the whole page draws from, would be
 * re-drawn for nothing on every switch.
 *
 * Used by `StationWhileShowing`, once, inside her provider.
 */
export function useTakeHerFloor(): void {
  const { takeFloor, picture, clientId } = useCompanion();
  const showing = useStationShowing();
  // Whether the floor is this page's, as of the newest picture. A ref: the effect below runs on a switch and a focus, and reads it then.
  const holdsFloorRef = useRef(false);
  useEffect(() => {
    holdsFloorRef.current = picture?.floor === clientId;
  }, [picture?.floor, clientId]);

  useEffect(() => {
    if (!showing) return undefined;
    const take = () => {
      if (!holdsFloorRef.current) takeFloor();
    };
    take();
    window.addEventListener('focus', take);
    return () => window.removeEventListener('focus', take);
  }, [showing, takeFloor]);
}
