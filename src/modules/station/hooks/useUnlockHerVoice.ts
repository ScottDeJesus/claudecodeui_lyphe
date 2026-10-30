import { useEffect } from 'react';

import { useCompanion } from '@/modules/companion';

/**
 * Unlocks the station's audio on its first press. A browser plays nothing before a gesture, and the station is a page she speaks
 * on unasked, so the first `pointerdown` or `keydown` anywhere on it calls the provider's `setOpen(true)` once more: the door
 * that unlocks the page's audio inside it (MAN-9113), the same act that opening her panel is in the workspace. `sendText`
 * unlocks it too, as it always has; no second unlock path exists.
 *
 * The listeners go on in the capture phase, so a press a region stops from bubbling still counts; both go off together at the
 * first gesture of either kind. Event-driven: nothing here polls.
 *
 * Used by `StationRoute`, once, inside her provider.
 */
export function useUnlockHerVoice(): void {
  const { setOpen } = useCompanion();

  useEffect(() => {
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      setOpen(true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [setOpen]);
}
