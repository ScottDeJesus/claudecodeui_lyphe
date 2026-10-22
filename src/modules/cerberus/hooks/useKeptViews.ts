import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { CerberusView } from '@/shared/types';

/**
 * The views the tab keeps mounted (`hidden`) once shown, as Fleet is: Tours and Bulletins hold a place a person left (the
 * open tour, pano and face; the open carrier and page) and read on open and on a press, never on a timer or while hidden,
 * so left mounted they cost nothing. Fleet is kept too, but it is always mounted and keeps its place in the document.
 * History and Catalog hold no place and are mounted only while they show.
 */
const KEPT_VIEWS: readonly CerberusView[] = ['tours', 'bulletins'];

/**
 * What the Cerberus panel's kept views need from the panel: which views have been shown at least once, and where each
 * was scrolled to when it was left.
 *
 * The views share ONE scroller (the panel's `ScrollArea`), so its offset follows whichever view is taller and another
 * view's own height takes a kept view's place in it. A kept view's offset is therefore kept here: written as the view
 * is left (`leaving`, called by the strip's press before it changes the view, while the view is still laid out), read
 * as it returns. A first show starts at the top.
 *
 * Used by the cerberus module's `CerberusPanel`, which hands `shownOnce` to each `KeptView`.
 */
export function useKeptViews(view: CerberusView, scrollerRef: RefObject<HTMLElement | null>): {
  shownOnce: ReadonlySet<CerberusView>;
  leaving: (next: CerberusView) => void;
} {
  // The views shown at least once. A kept view mounts on its first show and stays mounted after, so "has it ever been
  // shown" outlives the view being shown, and a mount has to be drawn: state, not a ref.
  const [shownOnce, setShownOnce] = useState<ReadonlySet<CerberusView>>(() => new Set([view]));
  // Set while rendering: React renders again at once, before anything is drawn, so a view's first frame is already mounted.
  if (!shownOnce.has(view)) setShownOnce(new Set(shownOnce).add(view));

  // Where each kept view was scrolled to when it was last left. A ref: written as a view is left, read as it returns,
  // and nothing draws from it.
  const offsetsRef = useRef(new Map<CerberusView, number>());
  const leaving = (next: CerberusView) => {
    if (next !== view && KEPT_VIEWS.includes(view)) offsetsRef.current.set(view, scrollerRef.current?.scrollTop ?? 0);
  };

  // A kept view comes back where it was left: the offset is written once its panel is out of `hidden` (this runs after the
  // commit that unhid it, before paint, so there is no frame at the other view's offset).
  useLayoutEffect(() => {
    if (KEPT_VIEWS.includes(view) && scrollerRef.current !== null) scrollerRef.current.scrollTop = offsetsRef.current.get(view) ?? 0;
  }, [view, scrollerRef]);

  return { shownOnce, leaving };
}
