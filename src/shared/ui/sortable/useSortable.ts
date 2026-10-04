import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { isFreePress, SORTABLE_ITEM_ATTRIBUTE } from '@/shared/ui/sortable/freePress';
import { reconcile, sameOrder } from '@/shared/ui/sortable/carryState';
import type { Carry } from '@/shared/ui/sortable/carryState';
import { useDropHold } from '@/shared/ui/sortable/dropHold';
import { edgeStep, radiusOf, restoreScrollOffsets, scrollerOf, scrollOffsetsWithin, slideFrom, surfaceBehind } from '@/shared/ui/sortable/motion';
import { layoutRectOf, moveKey, slotAt } from '@/shared/ui/sortable/slotAt';
import { usePointerDrag } from '@/shared/ui/usePointerDrag';
import type { PointerDragPoint } from '@/shared/ui/usePointerDrag';

/** How long a finger holds still on a free spot before it lifts the card. */
const TOUCH_HOLD_MS = 400;

/** How far the pointer, or the pane under it, must travel after one reorder before the next may happen. */
const REORDER_TRAVEL_PX = 8;

/** What a list's owner spreads on one item's root element. The attribute marks the item for `isFreePress`, so a list nested inside an item never arms the list around it. */
type SortableItemProps = {
  ref: (element: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  'data-sortable-item': '';
};

/** What `useSortable` hands back: the order to draw, the list's element handle, and each item's props. */
export type SortableList = {
  order: readonly string[];
  attachList: (element: HTMLElement | null) => void;
  itemProps: (key: string) => SortableItemProps;
};

/**
 * ONE SORTABLE CAPABILITY for any list or grid: items picked up by a free press and put down in
 * another place, the others making room live. It knows nothing about what an item is — it is handed
 * the keys in their committed order and says, on a drop, which key moved and the whole order it now
 * stands in; what that order MEANS, and where it is kept, is the caller's.
 *
 * WHAT THE READER SEES, AND NOTHING MORE. The carried item follows the pointer (a translate on the item
 * itself). The list is reordered DURING the carry — React re-renders the keys in their preview order —
 * so a column or a wrapping grid lays itself out around the gap, and each neighbour slides to its new
 * place (`slideFrom`; nothing slides under `prefers-reduced-motion`). No drop line, no ghost, no
 * handle, no highlight: the only marks of a carry are on the carried item, on the neighbours as they
 * move, and the kit's own drag classes on `<body>`.
 *
 * WHERE A CARRY BEGINS (`isFreePress`): a free press — never on a control, a field, or a track swiped
 * sideways. A mouse carries once it moves past the threshold (the text selection it could have begun is
 * cleared). A finger carries after holding still for `TOUCH_HOLD_MS`; one that moves first is
 * scrolling. Once lifted, the pane must not scroll under the finger: the list carries a `touchmove`
 * listener that cancels it, set for the list's whole life — `touch-action` cannot be changed under a
 * touch already running, and a listener met only after the touch began is not reliably allowed to cancel.
 *
 * THE CLICK THAT ENDS A CARRY IS SWALLOWED. NEAR THE PANE'S TOP OR BOTTOM EDGE the pane scrolls itself
 * (`edgeStep`), the item stays under the pointer and the slot is re-read as the list moves beneath it.
 * A CANCELLED carry (the browser took the touch) puts the card back. THE POLL DOES NOT RESET A CARRY:
 * the preview order lives here and is `reconcile`d against the keys on each render; a carried item
 * whose key leaves the list is let go. A drop calls `onReorder` once and clears the preview in the same
 * batch, so the list never draws the old order between the two.
 *
 * A STORE THAT ANSWERS LATER KEEPS THE DROP'S ORDER MEANWHILE. When `onReorder` returns a promise (a write
 * whose next reading is what redraws the keys), the order the drop made stays drawn until the store has
 * caught up (`useDropHold`). A synchronous `onReorder` is untouched.
 *
 * Used by `RunnerPanel` and `RunnerWidgetBody` (runner-tab): the tab's wall and decks, and the widget's
 * column, reordering the lane's cards; and by `MilestoneFocus` and `EpicCard` (roadmap): the milestone's
 * epics and an epic's features, a list nested inside an item of the other.
 */
export function useSortable({ keys, onReorder }: {
  keys: readonly string[];                                              // the items' keys in their committed order
  onReorder: (carried: string, order: readonly string[]) => void | Promise<boolean>; // a drop that moved something: the key carried, the whole order it now stands in; a promise answers whether the store took it
}): SortableList {
  // The order drawn WHILE a carry is in the hand (`null` otherwise: the keys' own order stands). Essential, not
  // derivable: a reorder happens live, before the drop, in an order nothing else yet says.
  const [preview, setPreview] = useState<readonly string[] | null>(null);
  // The order a drop made, drawn until the store it was written to has caught up (`dropHold.ts`).
  const { heldOrder, hold } = useDropHold(keys);

  const elements = useRef(new Map<string, HTMLElement>());
  const listElement = useRef<HTMLElement | null>(null);
  const pressedKey = useRef<string | null>(null);
  const carry = useRef<Carry | null>(null);
  const swallowClick = useRef<((event: Event) => void) | null>(null);
  // The order on screen: the carry's preview, else the drop still being written (`dropHold.ts`), else the keys' own.
  const drawn = preview !== null ? reconcile(preview, keys) : heldOrder !== null ? reconcile(heldOrder, keys) : keys;
  // The latest keys, drawn order and callback, read by handlers that outlive a render; written in an effect, never during render.
  const latest = useRef({ keys, drawn, onReorder });
  useEffect(() => { latest.current = { keys, drawn, onReorder }; });

  /** The preview order, reconciled with whatever the list holds now. */
  const orderNow = (): readonly string[] => {
    const held = carry.current?.order;
    return held === undefined ? latest.current.keys : reconcile(held, latest.current.keys);
  };

  /** The carried item drawn under the pointer, whatever its slot in the layout has become. */
  const place = (active: Carry) => {
    const slot = layoutRectOf(active.element);
    active.element.style.transform = `translate(${active.pointerX - active.grabX - slot.left}px, ${active.pointerY - active.grabY - slot.top}px)`;
  };

  /** Puts the list in `next` order NOW (the layout is current when this returns) and slides every other item from where it was drawn. */
  const reorder = (active: Carry, next: readonly string[]) => {
    const others = [...elements.current].filter(([key]) => key !== active.key);
    const drawn = new Map(others.map(([key, element]) => [key, element.getBoundingClientRect()]));
    active.slides.forEach((slide) => slide.cancel());
    active.slides.clear();
    active.order = next;
    const scrolled = scrollOffsetsWithin(elements.current.values());
    flushSync(() => setPreview(next));
    restoreScrollOffsets(scrolled);
    for (const [key, element] of others) {
      const from = drawn.get(key);
      const slide = from === undefined ? null : slideFrom(element, from);
      if (slide !== null) active.slides.set(key, slide);
    }
    place(active);
  };

  /** Reads the slot under the pointer and, if it is another place than the carried item's, moves it there. */
  const retarget = (active: Carry) => {
    const scroll = active.scroller?.scrollTop ?? 0;
    // A reorder is earned: after one the pointer (or pane) must travel again, so the layout it caused cannot argue it back.
    const travel = Math.hypot(active.pointerX - active.reference.x, active.pointerY - active.reference.y)
      + Math.abs(scroll - active.reference.scroll);
    if (travel < REORDER_TRAVEL_PX) return;
    const boxes = active.order.flatMap((key) => {
      const element = elements.current.get(key);
      return element === undefined ? [] : [{ key, rect: layoutRectOf(element) }];
    });
    const slot = slotAt(active.pointerX, active.pointerY, boxes, active.key);
    if (slot === null) return;
    const next = moveKey(active.order, active.key, slot);
    if (sameOrder(next, active.order)) return;
    reorder(active, next);
    active.reference = { x: active.pointerX, y: active.pointerY, scroll };
  };

  /** One frame of the carry: the pane scrolls toward the edge the pointer is at, and the item stays under the pointer whatever moved. */
  const frame = () => {
    const active = carry.current;
    if (active === null) return;
    const { scroller } = active;
    let scrolled = false;
    if (scroller !== null) {
      const step = edgeStep(scroller, active.pointerY);
      if (step !== 0) scroller.scrollTop += step;
      // A pane that moved — by this edge, or by the reader's own wheel — moved the slots under the pointer.
      scrolled = scroller.scrollTop !== active.seenScroll;
      active.seenScroll = scroller.scrollTop;
    }
    // Every frame: the lane can change the layout under a stationary pointer (an ask band opening), and the item stays in the hand.
    place(active);
    if (scrolled) retarget(active);
    active.frame = requestAnimationFrame(frame);
  };

  /** Lets go of the carried item's inline marks once it has settled into its slot. */
  const clearMarks = (element: HTMLElement) => {
    element.style.position = '';
    element.style.zIndex = '';
    element.style.willChange = '';
    element.style.backgroundColor = '';
    element.style.borderRadius = '';
  };

  /** `clearMarks` for a settled item — unless it has been taken up again, whose marks they now are. */
  const letGo = (element: HTMLElement) => {
    if (carry.current?.element !== element) clearMarks(element);
  };

  /** Ends the carry: the item settles into its slot, the click that follows is swallowed, and `dropped` is the order a drop commits — `null` when nothing is to be committed. */
  const settle = (active: Carry, dropped: readonly string[] | null) => {
    cancelAnimationFrame(active.frame);
    carry.current = null;
    const drawn = active.element.getBoundingClientRect();
    active.element.style.transform = '';
    const slide = slideFrom(active.element, drawn);
    if (slide === null) clearMarks(active.element);
    else void slide.finished.then(() => letGo(active.element), () => letGo(active.element));
    window.getSelection()?.removeAllRanges();
    // One tick, so this gesture's own click still finds the listener.
    setTimeout(() => {
      if (swallowClick.current !== null) window.removeEventListener('click', swallowClick.current, true);
      swallowClick.current = null;
    }, 0);
    if (dropped !== null) {
      const pending = latest.current.onReorder(active.key, dropped);
      if (pending !== undefined) hold(dropped, pending);
    }
    setPreview(null);
  };

  const begin = ({ x, y }: PointerDragPoint) => {
    const key = pressedKey.current;
    const element = key === null ? undefined : elements.current.get(key);
    if (key === null || element === undefined) return;
    const slot = layoutRectOf(element);
    // A carry begins from what the operator sees, which a drop still being written has already moved.
    const order = latest.current.drawn;
    const scroller = scrollerOf(listElement.current ?? element);
    const active: Carry = {
      key,
      element,
      grabX: x - slot.left,
      grabY: y - slot.top,
      pointerX: x,
      pointerY: y,
      startOrder: order,
      order,
      scroller,
      reference: { x, y, scroll: scroller?.scrollTop ?? 0 },
      seenScroll: scroller?.scrollTop ?? 0,
      frame: 0,
      slides: new Map(),
    };
    carry.current = active;
    // A slide still running (the item grabbed again mid-settle) would out-rank the carry's transform.
    element.getAnimations().forEach((running) => running.cancel());
    // Above its neighbours, on its own layer, backed with its ground in its card's corners (a translucent card hides what it passes over).
    element.style.position = 'relative';
    element.style.zIndex = '30';
    element.style.willChange = 'transform';
    element.style.backgroundColor = surfaceBehind(element);
    element.style.borderRadius = radiusOf(element);
    window.getSelection()?.removeAllRanges();
    swallowClick.current = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', swallowClick.current, true);
    // A finger has no other sign the card has come up: where the device can, it says so in the hand.
    navigator.vibrate?.(8);
    setPreview(order);
    place(active);
    active.frame = requestAnimationFrame(frame);
  };

  const follow = ({ x, y }: PointerDragPoint) => {
    const active = carry.current;
    if (active === null) return;
    active.pointerX = x;
    active.pointerY = y;
    place(active);
    retarget(active);
  };

  const finish = ({ moved, cancelled }: { moved: boolean; cancelled: boolean }) => {
    const active = carry.current;
    if (active === null) return;
    // A carry the browser took away (a palm, a system gesture) is not a drop: the card goes back.
    if (cancelled) {
      if (!sameOrder(active.order, active.startOrder)) reorder(active, active.startOrder);
      settle(active, null);
      return;
    }
    // Moved = the carry's own reorders; what a drop commits is the order NOW (a card the poll added mid-carry is in it).
    settle(active, moved && !sameOrder(active.order, active.startOrder) ? orderNow() : null);
  };

  const { onPointerDown } = usePointerDrag({
    kind: 'sort',
    holdMs: TOUCH_HOLD_MS,
    // `accept` hears only a press that may START the gesture (a second finger never reaches it), so the key is the one the hold lifts.
    accept: (event) => {
      if (!isFreePress(event.target, event.currentTarget)) return false;
      pressedKey.current = [...elements.current].find(([, element]) => element === event.currentTarget)?.[0] ?? null;
      return pressedKey.current !== null;
    },
    // On the LIST, which no reorder moves (a handle React moves in the DOM drops its capture).
    captureOnStart: (handle) => listElement.current ?? handle,
    onStart: begin,
    onMove: follow,
    onEnd: finish,
  });

  // A carried item whose key has left the list (dropped or put away elsewhere) has nothing to be put down as: let go, nothing committed.
  useEffect(() => {
    const active = carry.current;
    if (active !== null && !keys.includes(active.key)) settle(active, null);
  });

  // The frame loop and the click guard end with the list, whatever the gesture was doing.
  useEffect(() => () => {
    const active = carry.current;
    if (active !== null) {
      cancelAnimationFrame(active.frame);
      clearMarks(active.element);
      active.element.style.transform = '';
    }
    carry.current = null;
    if (swallowClick.current !== null) window.removeEventListener('click', swallowClick.current, true);
  }, []);

  /** Cancels a `touchmove` while an item is in the hand, so the pane does not scroll under the finger. */
  const holdPane = useCallback((event: TouchEvent) => {
    if (carry.current !== null) event.preventDefault();
  }, []);

  const attachList = useCallback((element: HTMLElement | null) => {
    listElement.current?.removeEventListener('touchmove', holdPane);
    listElement.current = element;
    element?.addEventListener('touchmove', holdPane, { passive: false }); // a cancelling listener is ignored unless it says it may cancel
  }, [holdPane]);

  const itemProps = useCallback((key: string): SortableItemProps => ({
    ref: (element) => {
      if (element === null) elements.current.delete(key);
      else elements.current.set(key, element);
    },
    onPointerDown,
    [SORTABLE_ITEM_ATTRIBUTE]: '',
  }), [onPointerDown]);

  return { order: drawn, attachList, itemProps };
}
