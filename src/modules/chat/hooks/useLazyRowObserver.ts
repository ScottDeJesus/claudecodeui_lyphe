import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/** How far beyond the viewport a transcript row keeps (or gains) its mounted content. */
const LAZY_ROW_VIEWPORT_MARGIN_PX = 1200;

export type LazyRowObserver = {
  /** Starts watching an element; returns the matching cleanup. */
  observe: (
    element: Element,
    onNearViewportChange: (isNearViewport: boolean) => void,
  ) => () => void;
};

/**
 * One shared IntersectionObserver for every LazyMessageRow of a transcript,
 * rooted at its scroll container. Returns null where IntersectionObserver does
 * not exist (jsdom), which keeps every row permanently mounted — the
 * pre-existing behavior.
 *
 * The observer is built from the HOST window's constructor, and built again when the host changes:
 * an observer belongs to the window that made it, and one rooted at a scroller that has moved to
 * another window's document reports nothing useful. Every element still registered is observed by
 * the new one, so each row keeps its callback across a move.
 */
export function useLazyRowObserver(
  scrollContainerRef: RefObject<HTMLDivElement>,
): LazyRowObserver | null {
  const hostWindow = useHostWindow();
  // The live observer and the window it was built on, so a host change can tell a stale one from a
  // current one. A ref: rows read it from their own effects, and nothing renders from it.
  const observerRef = useRef<{ observer: IntersectionObserver; builtOn: Window } | null>(null);
  const callbacksRef = useRef(new Map<Element, (isNearViewport: boolean) => void>());
  // The host window as of the latest commit, for `observe`, whose identity must stay stable.
  const hostWindowRef = useRef(hostWindow);
  const isSupported = typeof (hostWindow as Window & typeof globalThis).IntersectionObserver !== 'undefined';

  const buildObserver = useCallback((builtOn: Window) => {
    const HostIntersectionObserver = (builtOn as Window & typeof globalThis).IntersectionObserver;
    const observer = new HostIntersectionObserver((observerEntries) => {
      for (const entry of observerEntries) {
        // A zero-sized rect means the row is inside a display:none subtree
        // (the Chat tab is hidden), not that the user scrolled away — keep
        // the row's state, and its recorded height, intact.
        if (
          !entry.isIntersecting
          && entry.boundingClientRect.width === 0
          && entry.boundingClientRect.height === 0
        ) {
          continue;
        }
        callbacksRef.current.get(entry.target)?.(entry.isIntersecting);
      }
    }, {
      root: scrollContainerRef.current,
      rootMargin: `${LAZY_ROW_VIEWPORT_MARGIN_PX}px 0px`,
    });
    return { observer, builtOn };
  }, [scrollContainerRef]);

  useEffect(() => () => {
    observerRef.current?.observer.disconnect();
    observerRef.current = null;
  }, []);

  // A layout effect so the swap lands in the commit that carries the new host, before any row's
  // next observe call could read a stale observer.
  useLayoutEffect(() => {
    hostWindowRef.current = hostWindow;
    const current = observerRef.current;
    if (!current || current.builtOn === hostWindow) return;

    current.observer.disconnect();
    const next = buildObserver(hostWindow);
    observerRef.current = next;
    for (const element of callbacksRef.current.keys()) next.observer.observe(element);
  }, [buildObserver, hostWindow]);

  const observe = useCallback<LazyRowObserver['observe']>((element, onNearViewportChange) => {
    if (!observerRef.current) {
      observerRef.current = buildObserver(hostWindowRef.current);
    }

    callbacksRef.current.set(element, onNearViewportChange);
    observerRef.current.observer.observe(element);
    return () => {
      callbacksRef.current.delete(element);
      observerRef.current?.observer.unobserve(element);
    };
  }, [buildObserver]);

  // Identity-stable so each row's observe effect runs once, not per render.
  return useMemo(() => (isSupported ? { observe } : null), [isSupported, observe]);
}
