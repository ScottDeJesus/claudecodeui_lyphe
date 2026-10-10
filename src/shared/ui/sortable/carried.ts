import { radiusOf, slideFrom, surfaceBehind } from '@/shared/ui/sortable/motion';
import { layoutRectOf } from '@/shared/ui/sortable/slotAt';

/**
 * THE ITEM IN THE HAND, for any list that carries one: how it is lifted off its slot, how it stays
 * under the pointer, and how it is put down. One copy, so a lifted card and a lifted chat row move,
 * look and settle alike — and a list that cannot buzz the hand (an iPhone has no `navigator.vibrate`)
 * still shows, by the item leaving its place and following the finger, that the hold has taken.
 *
 * WHAT THE ITEM WEARS: a translate that keeps it under the pointer; a place above its neighbours
 * and on its own layer; the ground it was lifted from (`surfaceBehind`) and that ground's corners
 * (`radiusOf`), so it hides what it passes over; and `data-carried`, which `surfaces.css` draws
 * Verve's lifted state off. All of it is written on the element, none of it through React, so the
 * list's render never has to know.
 *
 * Every mark is written by `takeUp` and taken off by `putDown` (after the settling slide) or by
 * `dropNow` (at once). An item picked up again mid-slide keeps its marks: the new carry owns them.
 *
 * Used by `useSortable` (the runner, roadmap and dispatcher lists) and `useSimpleChatDrag` (the
 * sidebar's chat list).
 */

/** The attribute an item wears for as long as a pointer holds it; `surfaces.css` draws the lifted state off it. */
const CARRIED_ATTRIBUTE = 'data-carried';

/** Above every neighbour. The marks that say where the item lands sit one step higher (Tailwind's `z-40`), so the carried item never hides them. */
const CARRIED_Z_INDEX = '30';

/** The items in a hand right now, so a slide that ends after the item was taken up again does not strip the new carry's marks. */
const inHand = new WeakSet<HTMLElement>();

/** An item in the hand and where inside it the pointer took it: all `placeUnder` needs to keep it under the pointer. */
export type Grip = { element: HTMLElement; grabX: number; grabY: number };

/** Lets go of the inline marks `takeUp` wrote. */
function clearMarks(element: HTMLElement): void {
  element.style.position = '';
  element.style.zIndex = '';
  element.style.willChange = '';
  element.style.backgroundColor = '';
  element.style.borderRadius = '';
  element.removeAttribute(CARRIED_ATTRIBUTE);
}

/** Lifts `element` off its slot with the pointer at (`x`, `y`); answers where inside the element the pointer took it. */
export function takeUp(element: HTMLElement, x: number, y: number): Pick<Grip, 'grabX' | 'grabY'> {
  const slot = layoutRectOf(element);
  inHand.add(element);
  // A slide still running (the item grabbed again mid-settle) would out-rank the carry's transform.
  element.getAnimations().forEach((running) => running.cancel());
  // Above its neighbours, on its own layer, backed with its ground in its card's corners (a translucent card hides what it passes over).
  element.style.position = 'relative';
  element.style.zIndex = CARRIED_Z_INDEX;
  element.style.willChange = 'transform';
  element.style.backgroundColor = surfaceBehind(element);
  element.style.borderRadius = radiusOf(element);
  element.setAttribute(CARRIED_ATTRIBUTE, '');
  return { grabX: x - slot.left, grabY: y - slot.top };
}

/**
 * Draws the item under the pointer at (`x`, `y`), whatever its slot in the layout has become. A `null` `x`
 * keeps the item on the list's own rail — it follows the pointer up and down and not sideways — for a
 * list whose pane would otherwise grow a horizontal scroll under a drifting finger.
 */
export function placeUnder(grip: Grip, x: number | null, y: number): void {
  const slot = layoutRectOf(grip.element);
  const dx = x === null ? 0 : x - grip.grabX - slot.left;
  grip.element.style.transform = `translate(${dx}px, ${y - grip.grabY - slot.top}px)`;
}

/**
 * Puts the item down: it slides from where it was drawn (`from`, the box it is in now unless the caller
 * read it before the list changed) to its slot as the layout has it now, and the marks come off once it
 * has settled — at once under `prefers-reduced-motion`, or for an item the list has since removed.
 */
export function putDown(element: HTMLElement, from: DOMRect = element.getBoundingClientRect()): void {
  inHand.delete(element);
  element.style.transform = '';
  const slide = element.isConnected ? slideFrom(element, from) : null;
  if (slide === null) {
    clearMarks(element);
    return;
  }
  const letGo = () => { if (!inHand.has(element)) clearMarks(element); };
  void slide.finished.then(letGo, letGo);
}

/** Takes the item out of the hand where it stands, no slide: for a list that is going away mid-carry. */
export function dropNow(element: HTMLElement): void {
  inHand.delete(element);
  clearMarks(element);
  element.style.transform = '';
}
