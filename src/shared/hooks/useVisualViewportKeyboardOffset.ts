import { useEffect } from 'react';

/**
 * Keeps the fixed workspace shell above the virtual keyboard in iOS Safari: writes `--keyboard-height` on the root from
 * the visual viewport's `resize`, which a fixed frame's `bottom` reads. Consumed by project-workspace's route (the
 * workspace shell) and by the station's route (the station's root), each of which draws such a frame.
 *
 * It also writes the value once as it mounts. The two routes take turns on a phone (`/` and `/station`, the station a lazy
 * chunk with a gap while it loads), so a keyboard that closed while neither was mounted sent its `resize` to no one, and
 * the variable would otherwise keep the number from before: the new route's frame would stand that high over a dead band.
 */
export function useVisualViewportKeyboardOffset() {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }

    const updateKeyboardHeight = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - visualViewport.height);
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    };

    updateKeyboardHeight();
    visualViewport.addEventListener('resize', updateKeyboardHeight);
    return () => visualViewport.removeEventListener('resize', updateKeyboardHeight);
  }, []);
}
