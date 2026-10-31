import { useEffect } from 'react';

/** The least gap, in px, that is a keyboard: a real one is over a hundred, a fractional viewport leaves under one. */
const KEYBOARD_MARK_FLOOR_PX = 2;

/**
 * Keeps the fixed workspace shell above the virtual keyboard in iOS Safari: writes `--keyboard-height` on the root from
 * the visual viewport's `resize`, which a fixed frame's `bottom` reads. Consumed by project-workspace's route (the
 * workspace shell) and by the station's route (the station's root), each of which draws such a frame.
 *
 * It writes the keyboard's MARK in the same handler: `data-keyboard` on html, `up` while the keyboard's height is 2 px or more
 * (a fractional viewport, a zoom or a rounded `innerHeight`, leaves under a pixel and is no keyboard), else `down`. One
 * attribute for CSS to key on (`html[data-keyboard=up]`), written with the number it is read from, so the two never disagree and no
 * second listener exists. The station's phone arrangement is its reader: its bar and pending line step aside under `up`.
 *
 * THE MARK IS THE VISUAL VIEWPORT'S: it sees a keyboard that covers the page (iOS Safari and the home-screen app). A browser that
 * resizes the LAYOUT viewport for its keyboard instead (Android, `interactive-widget=resizes-content` in index.html) leaves no gap
 * between `innerHeight` and the visual viewport, so the mark stays `down` there; and a pinch-zoomed page reads as a gap, as
 * `--keyboard-height` already did.
 *
 * It also writes both once as it mounts. The two routes take turns on a phone (`/` and `/station`, the station a lazy
 * chunk with a gap while it loads), so a keyboard that closed while neither was mounted sent its `resize` to no one, and
 * the variable and the mark would otherwise keep what they held before: the new route's frame would stand that high over a
 * dead band.
 */
export function useVisualViewportKeyboardOffset() {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }

    const updateKeyboardHeight = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - visualViewport.height);
      const root = document.documentElement;
      root.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
      root.dataset.keyboard = keyboardHeight >= KEYBOARD_MARK_FLOOR_PX ? 'up' : 'down';
    };

    updateKeyboardHeight();
    visualViewport.addEventListener('resize', updateKeyboardHeight);
    return () => visualViewport.removeEventListener('resize', updateKeyboardHeight);
  }, []);
}
