import { useEffect } from 'react';

import { useCompanion } from '@/modules/companion';

/** The events a press can arrive as, anywhere on the page: a mouse's `pointerdown`, a finger's `pointerup`, a key's `keydown`. */
const PRESS_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;

/**
 * Unlocks the station's audio on his first real gesture. A browser plays nothing before a gesture, and the station is a page she
 * speaks on unasked, so a press anywhere on it calls the provider's `setOpen(true)` once more: the door that unlocks the page's
 * audio inside it (MAN-9113), the same act that opening her panel is in the workspace. `sendText` unlocks it too, as it always
 * has; no second unlock path exists.
 *
 * THE LISTENERS STAND UNTIL ONE CALL HAS RUN INSIDE A USER ACTIVATION (`navigator.userActivation.isActive`), because only such a
 * call unlocks anything. Which event carries the activation depends on the pointer: a mouse's `pointerdown` does, but a finger's
 * `pointerdown` does not (its `pointerup`, `touchend` and a key's `keydown` do; Escape never). A one-shot spent on a phone's
 * `pointerdown` unlocked nothing and left every alert she speaks unasked silent, so all three events are heard and none takes
 * the listeners off until a call found the activation live.
 *
 * A CALL IS MADE ONLY INSIDE AN ACTIVATION. `setOpen(true)` also asks the server for her floor, and the browser refuses a
 * `resume()` made outside one, so a call on a finger's `pointerdown` that ends in `pointercancel` (a swipe: no `pointerup` ever
 * comes) would cost a floor request and a refused resume for every swipe until the first tap. The press that matters is the tap's
 * own `pointerup`. A browser with no `userActivation` cannot say, so its first press calls and takes the listeners off, as it
 * always did.
 *
 * The listeners go on in the capture phase, so a press a region stops from bubbling still counts. Event-driven: nothing here polls.
 *
 * Used by `StationRoute`, once, inside her provider.
 */
export function useUnlockHerVoice(): void {
  const { setOpen } = useCompanion();

  useEffect(() => {
    function standDown() {
      PRESS_EVENTS.forEach((type) => window.removeEventListener(type, unlock, true));
    }
    function unlock() {
      // The call below runs synchronously inside this event's dispatch, so the activation read here is the one it runs under.
      if (!(navigator.userActivation?.isActive ?? true)) return;
      setOpen(true);
      standDown();
    }
    PRESS_EVENTS.forEach((type) => window.addEventListener(type, unlock, true));
    return standDown;
  }, [setOpen]);
}
