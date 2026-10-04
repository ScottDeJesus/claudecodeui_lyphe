import { useEffect, useState } from 'react';

/** The room the panel is laid out in, in CSS pixels: the window's width, and its height less the virtual keyboard. */
function readViewport(): { width: number; height: number } {
  // `--keyboard-height` is set on the root element by project-workspace's `useVisualViewportKeyboardOffset`
  // and is unset on a machine with no virtual keyboard, where parsing it gives NaN and means 0.
  const keyboardHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height'),
  );
  return {
    width: window.innerWidth,
    height: window.innerHeight - (Number.isFinite(keyboardHeight) ? keyboardHeight : 0),
  };
}

/**
 * The viewport the floating panel stands in, kept current: `innerWidth` by `innerHeight` less the
 * keyboard, re-read on every window resize and every visual-viewport resize.
 *
 * WHY BOTH EVENTS. A desktop resize fires the window's; a virtual keyboard on iOS Safari shrinks the
 * VISUAL viewport and leaves `innerHeight` alone, so the keyboard's rise is only heard there. The workspace's
 * keyboard hook listens on the same visual viewport and was mounted before this panel, so by the time this
 * listener runs on the same event the variable it writes is already current.
 *
 * Used by this module's `useFloatingPanel`; the panel is drawn in the opener's own window, so the global
 * `window` is the right one.
 */
export function usePanelViewport(): { width: number; height: number } {
  // The measured room, in state because the panel must re-lay-out when it changes and nothing
  // else carries it into a render. An unchanged measurement keeps the old object, so a resize event that
  // changed nothing (the keyboard hook's, say) re-renders nothing.
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const update = () => {
      const next = readViewport();
      setViewport((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    // The window may have changed between the render that measured it and this effect.
    update();
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return viewport;
}
