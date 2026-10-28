import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

/** What the provider holds and hands out. One object for the provider's whole life, so no consumer is woken by it. */
type PageAnchors = {
  /** Records `element` as the holder of `key`, displacing whichever element held it. */
  claim(key: string, element: HTMLElement): void;
  /** Clears `key` only if `element` is still its holder: an element displaced earlier has nothing left to clear. */
  release(key: string, element: HTMLElement): void;
  /** The element MOUNTED under `key`, or null: mounted, not drawn — see `usePageAnchors`. */
  element(key: string): HTMLElement | null;
  subscribe(listener: () => void): () => void;
};

/**
 * `null` on purpose, not a filled-in default: the reader below throws outside a provider, so a button that
 * could never hear a registration is a loud mistake and not a guide that silently never moves.
 */
const PageAnchorsContext = createContext<PageAnchors | null>(null);

/** The attribute the provider stamps on every element it holds, so a probe or a console finds the anchors with one selector. */
const ANCHOR_ATTRIBUTE = 'data-page-anchor';

/**
 * THE PAGE'S ANCHORS: the elements a floating guide can point at, registered under stable keys (`PAGE_ANCHOR`).
 *
 * THIS IS A REGISTRY OF ITS OWN, not a topic on the live bus. The bus retains JSON per allow-listed topic and compares
 * each reading by `JSON.stringify`, and it is the vocabulary the widget bridge shows untrusted frames: an element is
 * not JSON, and a rect republished on every scroll would stringify the sidebar sixty times a second for a reader that
 * needs it once per move. So the registry holds ELEMENTS and nothing measured; whoever looks one up measures it then.
 *
 * NO MODULE DEPENDS ON THE GUIDE TO REGISTER. The sidebar's rows, the chat's composer, the file tree and the rail
 * import `usePageAnchor` and know nothing of who reads; the companion's button imports `usePageAnchors` and knows
 * nothing of who registers.
 *
 * THE LAST ELEMENT MOUNTED UNDER A KEY WINS, and an element's unmount clears its own claim and no one else's. The
 * provider stamps `data-page-anchor="<key>"` on each element it HOLDS, and takes it off when the element leaves or is
 * displaced, so the stamps on screen are exactly the registrations (one element carries one stamp, so an element
 * registered under two keys shows only the later).
 *
 * THE REGISTRY HOLDS WHAT IS MOUNTED, NOT WHAT IS DRAWN: see `usePageAnchors`, which is where a reader meets it.
 *
 * The registry lives in refs, not state: it is read synchronously at the moment a guide's target changes, and a
 * registration must never re-render the tree under this provider — the sidebar's rows register on every mount.
 *
 * Mounted by project-workspace's ProjectWorkspaceShell, outside the companion's provider.
 */
export function PageAnchorsProvider({ children }: { children: ReactNode }) {
  // The element holding each key. A ref because it is read synchronously and must never re-render this provider.
  const heldRef = useRef(new Map<string, HTMLElement>());
  // Who asked to hear a registration change. A ref for the same two reasons: it is walked synchronously, and a listener joining must not render.
  const listenersRef = useRef(new Set<() => void>());

  const value = useMemo<PageAnchors>(() => {
    const held = heldRef.current;
    const listeners = listenersRef.current;
    // A listener that throws must not stop the ones behind it hearing the same change.
    const notify = () => {
      listeners.forEach((listener) => {
        try {
          listener();
        } catch (error) {
          console.error('[PageAnchors] a listener threw while hearing a registration change', error);
        }
      });
    };

    return {
      claim(key, element) {
        const previous = held.get(key);
        if (previous === element) return;
        // Displaced, not holding the key any more: its stamp would otherwise name a registration that is gone.
        previous?.removeAttribute(ANCHOR_ATTRIBUTE);
        held.set(key, element);
        element.setAttribute(ANCHOR_ATTRIBUTE, key);
        notify();
      },
      release(key, element) {
        if (held.get(key) !== element) return;
        held.delete(key);
        element.removeAttribute(ANCHOR_ATTRIBUTE);
        notify();
      },
      element: (key) => held.get(key) ?? null,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }, []);

  return <PageAnchorsContext.Provider value={value}>{children}</PageAnchorsContext.Provider>;
}

/**
 * Registers the element this ref lands on under `key` (null registers nothing); the last mounted element of a key wins
 * and unmounting clears it.
 *
 * Used by the sidebar's rows (a chat's row), chat's ChatComposer, the file-tree module's FileTree and
 * project-workspace's RailButton, which put the returned ref on the element a guide should be able to point at.
 *
 * OUTSIDE A PROVIDER THIS REGISTERS NOTHING: the rows and the tree are drawn in surfaces that have no guide above them,
 * and a registrar with nobody to hear it has nothing to get wrong. The returned function keeps one identity per key, so
 * React never detaches and re-attaches it on a plain re-render and listeners hear one registration per mount.
 */
export function usePageAnchor(key: string | null): (element: HTMLElement | null) => void {
  const anchors = useContext(PageAnchorsContext);
  // The element this call site last registered. The ref function is handed `null` on detach and so cannot say which
  // element is leaving; `release` needs it to leave a newer holder of the same key alone.
  const registeredRef = useRef<HTMLElement | null>(null);

  return useCallback(
    (element: HTMLElement | null) => {
      if (anchors === null || key === null) return;
      const leaving = registeredRef.current;
      if (leaving !== null && leaving !== element) {
        anchors.release(key, leaving);
        registeredRef.current = null;
      }
      if (element !== null) {
        anchors.claim(key, element);
        registeredRef.current = element;
      }
    },
    [anchors, key],
  );
}

/**
 * Looks an anchor up and hears registrations change.
 *
 * Used by the companion module's button, which looks an anchor up when its target changes and measures it then; it
 * never reads the registry on a clock. `element` is `null` for a key nothing holds, and the listener is told only THAT
 * a registration changed, never which: the caller looks its own key up again. The returned object keeps one identity
 * for the provider's life, so it is safe in a dependency list.
 *
 * A NON-NULL `element` IS AN ELEMENT THAT IS MOUNTED, WHICH IS NOT AN ELEMENT A GUIDE CAN POINT AT. Measured on the dev
 * client: with Files open the chat view stays mounted and hidden, so `composer:<id>` is held at 0x0 at 0,0; on a phone
 * with the drawer closed every row and `rail:files` is mounted off-screen (44x44 at -329,114); a row scrolled out of the
 * sidebar's own scroller stays held; and a chat floated into another window is the same node under another
 * `ownerDocument`, its rect in that window's coordinates. Only `files-view` is "drawn or absent" (the tree unmounts off
 * the Files view). So the caller measures and refuses a rect with no area, one outside its viewport, and an element
 * whose `ownerDocument` is not its own — falling back to the next anchor — and never flies to a rect it did not check.
 */
export function usePageAnchors(): Pick<PageAnchors, 'element' | 'subscribe'> {
  const anchors = useContext(PageAnchorsContext);
  if (anchors === null) {
    throw new Error('usePageAnchors must be used within a PageAnchorsProvider');
  }
  return anchors;
}
