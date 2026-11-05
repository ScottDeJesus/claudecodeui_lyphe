import { useCallback, useContext, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { createStableContext } from '@/shared/context/stableContext';

/** Answers whether the page the reader sits in is held right now. Outside any `HeldPage` nothing is held. */
type IsPageHeld = () => boolean;

const HeldPageContext = createStableContext<IsPageHeld>(import.meta.hot, 'HeldPageContext', () => false);

/**
 * Whether the page this component belongs to (the workspace, or Kaylee Station) is the one held out of reach, as a FUNCTION to call when a key
 * arrives. For the `keydown` listeners a view binds to the `document` or the `window`: inert and `visibility: hidden` keep a held page from being seen,
 * focused and pressed, and do not stop a listener bound outside it, so a key typed on the page on screen would otherwise act in the held one (an Escape
 * aborting a chat that is running there, a Ctrl+S saving an editor nobody sees). A listener's handler returns at once while this says true.
 *
 * A function over a ref and not a boolean in state, so a switch of pages re-renders nobody: the held page's tree is never woken to learn it was held.
 * Read by the chat (the global Escape that aborts a turn), the PRD editor's shortcuts, the files browser's keyboard trap, the roadmap's celebration,
 * the affected-areas mark screen, the chat gutters' and the widgets' fullscreen Escape.
 */
export function useIsPageHeld(): IsPageHeld {
  return useContext(HeldPageContext);
}

/** Used by `HeldPage` (shared/ui), which draws every page of the app that can be held: it says, for everything inside, whether this page is held. */
export function HeldPageStateProvider({ held, children }: { held: boolean; children: ReactNode }) {
  // The newest `held`, written after each commit and read when a key arrives.
  const heldRef = useRef(held);
  useLayoutEffect(() => {
    heldRef.current = held;
  }, [held]);
  const isHeld = useCallback(() => heldRef.current, []);
  return <HeldPageContext.Provider value={isHeld}>{children}</HeldPageContext.Provider>;
}
