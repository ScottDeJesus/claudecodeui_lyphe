import { useEffect, useLayoutEffect, useRef } from 'react';

import { CHAT_TOGGLE_KEY } from '@/shared/constants';

/**
 * Used by project-workspace's WorkspaceFrame: Ctrl (⌘ on a Mac) plus `CHAT_TOGGLE_KEY` presses the chat's door
 * from anywhere in the workspace, and from inside the chat's picture-in-picture window.
 *
 * THE LISTENER IS ON `window`, IN THE CAPTURE PHASE, so it hears the key before the composer's textarea, the
 * editor or a framed page's host element can take it, and the press reaches `toggle` whatever has focus. It
 * calls `preventDefault()` first and `toggle` after, inside the same keydown: a window that opens from a user
 * gesture needs the press to be the one that asked.
 *
 * A KEY PRESSED IN THE PICTURE-IN-PICTURE WINDOW REACHES THAT WINDOW AND NEVER THE OPENER, so the same
 * listener is bound to `pipWindow` too while one is open (the effect is keyed on it, and a window that closes
 * takes its binding down in the cleanup). `toggle` in the window is the collapse, and the chat comes home.
 *
 * It claims the exact chord and nothing else: no Alt (AltGr on some layouts reports Ctrl+Alt and types a
 * character), and not a repeat — a held key would otherwise flap the chat open and shut.
 *
 * `toggle` is read through a ref written in a layout effect, so a listener bound once still calls the latest
 * one; a toggle that changes with the chat's state is never a press behind.
 */
export function useChatHotkey(toggle: () => void, pipWindow: Window | null): void {
  const latestToggle = useRef(toggle);
  useLayoutEffect(() => {
    latestToggle.current = toggle;
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key !== CHAT_TOGGLE_KEY || event.repeat) return;
      event.preventDefault();
      latestToggle.current();
    }

    window.addEventListener('keydown', handleKeyDown, true);
    pipWindow?.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      pipWindow?.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [pipWindow]);
}
