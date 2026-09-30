import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import type { HostMove, HostWindowValue } from '@/shared/types';

/**
 * WHICH WINDOW THIS SUBTREE IS DRAWN IN. The live chat can be drawn in the opener's own `window` or
 * in a picture-in-picture window, and a line of code that binds to `window` or `document` by name
 * binds to the OPENER whichever one the chat is standing in — a keydown listener that never hears a
 * key pressed in the floating window, a portal that lands in a page the reader is not looking at.
 * Code that touches a window reads it here instead.
 *
 * OUTSIDE A PROVIDER EVERY READER GETS THE GLOBAL `window`, which is why this seam changes nothing at
 * home: a reader with no provider above it is handed the very object it used to name directly.
 *
 * THE VALUE IS SET IN ONE PLACE: chat-host's `moveTo`, the one function that carries the chat's node
 * from one host to another. One place moves the chat, so taking the seam back out means changing
 * that one function and nothing else.
 */
const HostWindowContext = createContext<HostWindowValue | null>(null);

/** Used by chat-host's `ChatHostSlot` (around the live chat's portal) and `ChatHostWindow` (around a floating host's header), which build the value from the window the chat is standing in. */
export function HostWindowProvider({ value, children }: { value: HostWindowValue; children: ReactNode }) {
  return <HostWindowContext.Provider value={value}>{children}</HostWindowContext.Provider>;
}

/**
 * The window this component is drawn in; the global `window` outside a provider.
 *
 * Used by the kit's overlays and the chat, widgets and gutter modules for every line that binds a
 * listener, a portal, a measurement or a frame to a window. Put the result in the dependency list of
 * the effect that binds it: a move to another window is then a re-bind, not a leak on the old one.
 */
export function useHostWindow(): Window {
  return useContext(HostWindowContext)?.hostWindow ?? window;
}

/**
 * Calls the LATEST `listener` on every move of the chat between hosts, synchronously; nothing outside
 * a provider.
 *
 * The listener is held in a ref so a caller can pass an inline function without re-subscribing on
 * every render — a subscription re-made each render would open a gap in which a move goes unheard.
 * The ref is written in an effect, never during render: a render React discards must not leave its
 * callback behind. It is a LAYOUT effect, declared BEFORE the subscribing one: a move is emitted from
 * a layout effect (chat-host's `moveTo`), and layout effects all run before any passive effect of the
 * same commit, so a passive write would leave the ref holding the render BEFORE the one that
 * committed the move — a stale closure at exactly the 'before' phase that flushes what a closing
 * window would lose. (`usePointerDrag`'s passive write is safe only because its callers fire from DOM
 * events.)
 *
 * The subscription is a LAYOUT effect keyed on `subscribeMove`, so a component that mounts in the
 * same commit as a move is already listening when the 'after' phase fires straight behind it.
 */
export function useHostMove(listener: (move: HostMove) => void): void {
  const subscribeMove = useContext(HostWindowContext)?.subscribeMove;

  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
  });

  useLayoutEffect(() => {
    if (!subscribeMove) return undefined;
    return subscribeMove((move) => latest.current(move));
  }, [subscribeMove]);
}
