import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { TOUCH_HOLD_MS } from '@/shared/constants';
import type { SimpleListDragProps, SimpleListDropTarget, SimpleListItem, SimpleListItemRef, SimpleListPosition } from '@/shared/types';
import { useCarryEdgeScroll } from '@/modules/sidebar/hooks/useCarryEdgeScroll';
import { carriedElementOf, chatTargetAt, folderTargetAt, refOfRow, targetsEqual } from '@/modules/sidebar/utils/simpleChatDropTarget';
import { positionForDrop } from '@/modules/sidebar/utils/simpleChatTree';
import { dropNow, placeUnder, putDown, takeUp } from '@/shared/ui/sortable/carried';
import type { Grip } from '@/shared/ui/sortable/carried';
import { tickLift, useHoldPane } from '@/shared/ui/sortable/touchLift';
import { usePointerDrag } from '@/shared/ui/usePointerDrag';

/**
 * The carry of the simple chat list's tree: press a row or a folder's header, carry it, drop it
 * somewhere. The house's other drag — the chat gutters — uses the browser's own drag-and-drop, which
 * never fires from a touch screen and this list is used on a phone; so the gesture is pointer events,
 * run by the kit's one pointer-drag mechanism (`usePointerDrag`, kind `sort`), the same one the
 * sortable lists lift on. A mouse carries once it has moved past the threshold. A finger carries once
 * it has held still on a row for `TOUCH_HOLD_MS`, anywhere on the row that is not a control; one that
 * moves first is scrolling the list, and the row lifts nothing. A lifted row held at the pane's top or
 * bottom edge scrolls the pane toward it (`useCarryEdgeScroll`), so it can reach rows off screen.
 *
 * THE LIFTED ROW LEAVES ITS SLOT AND FOLLOWS THE POINTER, up and down, wearing Verve's lifted state: the
 * kit's own carry (`sortable/carried.ts`, the copy `useSortable` runs). A phone that cannot buzz has
 * nothing else to say the hold has taken. A chat is lifted as its row, a folder as its whole block (its
 * header and its open chats); the slot it left stays as the gap. The marks that say where it would land
 * are drawn above it, so the row under the finger never hides them.
 *
 * What is this hook's own: presses inside a control are left to the control; the click a carry owes
 * is swallowed, so a drop never opens the chat; Escape abandons a carry; and what it carries and
 * reads are the tree's — a carried row is a `SimpleListItemRef`, and the target under the pointer
 * comes from the DOM the list draws, never from the tree, whose drawn order is exactly what the
 * reader sees.
 */

/** How far a mouse press must travel before it becomes a carry rather than a click. */
const DRAG_THRESHOLD_PX = 5;
/** A press inside these never picks a row up: each of them owns its own job. */
const CONTROL_SELECTOR = 'button, input, [data-no-drag]';

/**
 * The carry behind SidebarSimpleList's tree, its one consumer: what is carried, where the pointer
 * says it would land, the handlers every chat row and folder header spreads, and the ref callback of
 * the list's root (`attachList`), which holds the pane still under a lifted finger. `onMove` fires
 * once, on release, and only when `positionForDrop` answers a position the drop really asks for.
 */
export function useSimpleChatDrag({ items, onMove }: {
  items: SimpleListItem[];
  onMove: (item: SimpleListItemRef, position: SimpleListPosition) => void;
}): {
  dragging: SimpleListItemRef | null;
  dropTarget: SimpleListDropTarget | null;
  dragProps: SimpleListDragProps;
  attachList: (element: HTMLElement | null) => void;
} {
  // The carried row and where it would land: both are drawn onto the rows, so both are state.
  const [dragging, setDragging] = useState<SimpleListItemRef | null>(null);
  const [dropTarget, setDropTarget] = useState<SimpleListDropTarget | null>(null);

  // The tree and callback as they stand right now: the release reads them and must see the current
  // value, never the one the render that started the carry captured.
  const itemsRef = useRef(items);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    itemsRef.current = items;
    onMoveRef.current = onMove;
  }, [items, onMove]);

  // The row a press landed on (set when the kit accepts the press), the row lifted from it, its
  // target, the click a carry owes, and an Escape taken mid-carry: none may be state.
  const pressedRef = useRef<SimpleListItemRef | null>(null);
  const carriedRef = useRef<SimpleListItemRef | null>(null);
  const targetRef = useRef<SimpleListDropTarget | null>(null);
  const swallowClickRef = useRef(false);
  const abandonedRef = useRef(false);
  // The row (or folder header) a press landed on, and the element lifted from it: the kit's `Grip`, held for as long as the carry has it.
  const pressedElementRef = useRef<HTMLElement | null>(null);
  const gripRef = useRef<Grip | null>(null);
  // The list's root, as `attachList` was handed it: where the pointer's capture goes at the lift.
  const listRef = useRef<HTMLElement | null>(null);

  const setTarget = useCallback((next: SimpleListDropTarget | null) => {
    if (targetsEqual(targetRef.current, next)) return;
    targetRef.current = next;
    setDropTarget(next);
  }, []);

  /** Reads the row or end the pointer at `pointerY` is over and makes it the target. */
  const retarget = useCallback((pointerY: number) => {
    const carried = carriedRef.current;
    if (carried === null || abandonedRef.current) return;
    setTarget(carried.kind === 'chat' ? chatTargetAt(pointerY, carried.id) : folderTargetAt(pointerY, carried));
  }, [setTarget]);

  /** Keeps the lifted row under the pointer and reads what it is over: on a move, and when the pane scrolled under a still pointer. */
  const followPointer = useCallback((pointerY: number) => {
    // `null`: the row stays on the list's rail, so a drifting finger never makes the pane scroll sideways.
    if (gripRef.current !== null) placeUnder(gripRef.current, null, pointerY);
    retarget(pointerY);
  }, [retarget]);
  const { begin: beginEdgeScroll, follow: followEdgeScroll, end: endEdgeScroll } = useCarryEdgeScroll(followPointer);

  const { onPointerDown, handleProps } = usePointerDrag({
    kind: 'sort',
    threshold: DRAG_THRESHOLD_PX,
    holdMs: TOUCH_HOLD_MS,
    // Hears only a press that may START the gesture (a second finger never reaches it), so the row
    // it names is the one the hold lifts.
    accept: (event) => {
      // React bubbles a press from a PORTAL (the row's open action menu) through the component tree to
      // this row, though the portal is not inside it: only a press that landed in the row's own DOM counts.
      if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return false;
      if (event.target.closest(CONTROL_SELECTOR)) return false;
      pressedRef.current = refOfRow(event.currentTarget);
      pressedElementRef.current = event.currentTarget;
      return pressedRef.current !== null;
    },
    // At the lift, not the press: a capture taken at the press would re-target the click that follows
    // it, and the row's own link and fold toggle would never hear a tap. And on the LIST, not the row:
    // `:hover` follows the capture, so a row that kept it would stay washed while it is carried.
    captureOnStart: (handle) => listRef.current ?? handle,
    onStart: ({ x, y }) => {
      carriedRef.current = pressedRef.current;
      abandonedRef.current = false;
      if (listRef.current !== null) beginEdgeScroll(listRef.current, y);
      // Without this, the carry smears a text selection across every row it passes over.
      window.getSelection()?.removeAllRanges();
      // The row leaves its slot and follows the pointer: on a phone that cannot buzz, the one sign the hold has taken.
      const element = pressedElementRef.current === null || carriedRef.current === null
        ? null
        : carriedElementOf(pressedElementRef.current, carriedRef.current);
      if (element !== null) {
        gripRef.current = { element, ...takeUp(element, x, y) };
        placeUnder(gripRef.current, null, y);
      }
      tickLift();
      setDragging(carriedRef.current);
    },
    onMove: ({ y }) => {
      followEdgeScroll(y);
      followPointer(y);
    },
    onEnd: ({ cancelled }) => {
      endEdgeScroll();
      const carried = carriedRef.current;
      const target = targetRef.current;
      const abandoned = abandonedRef.current;
      const grip = gripRef.current;
      pressedRef.current = null;
      pressedElementRef.current = null;
      carriedRef.current = null;
      targetRef.current = null;
      abandonedRef.current = false;
      gripRef.current = null;
      // A press that never lifted is a click, and the click is the row's own.
      if (carried === null) return;
      // A release is still followed by a click; that one is spent, so a drop never opens the chat.
      swallowClickRef.current = true;
      // A carry the browser took away (a palm, a system gesture) or the reader abandoned is not a drop.
      // Read here, at release, through the refs: the tree as it stands and the one place the pointer
      // named. `positionForDrop` answers null for a drop that changes nothing.
      const position = cancelled || abandoned || target === null ? null : positionForDrop(itemsRef.current, carried, target);
      // Where the row is drawn now, read before the list changes under it: it settles from there.
      const from = grip === null ? null : grip.element.getBoundingClientRect();
      // At once, so the row never shows a frame in its old slot between the drop and the list that has it.
      flushSync(() => {
        setDragging(null);
        setDropTarget(null);
        if (position) onMoveRef.current(carried, position);
      });
      if (grip !== null && from !== null) putDown(grip.element, from);
    },
  });

  // The pane held still while a row is in the hand (`touchLift.ts`).
  const holdPane = useHoldPane(() => carriedRef.current !== null);
  const attachList = useCallback((element: HTMLElement | null) => {
    listRef.current = element;
    holdPane(element);
  }, [holdPane]);

  // Escape abandons the carry: the marks come off at once and the release that follows commits nothing.
  useEffect(() => {
    if (dragging === null) return undefined;
    const abandon = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      abandonedRef.current = true;
      endEdgeScroll();
      setTarget(null);
      setDragging(null);
      // The row goes back to its slot at once; the release that follows commits nothing.
      const grip = gripRef.current;
      gripRef.current = null;
      if (grip !== null) putDown(grip.element);
    };
    window.addEventListener('keydown', abandon);
    return () => window.removeEventListener('keydown', abandon);
  }, [dragging, setTarget, endEdgeScroll]);

  // A list torn down mid-carry takes the row out of the hand where it stands.
  useEffect(() => () => {
    if (gripRef.current !== null) dropNow(gripRef.current.element);
    gripRef.current = null;
  }, []);

  // One object for every row and header: the row a press lands on is read off the row itself, so
  // there is nothing per-row to close over.
  const dragProps = useMemo<SimpleListDragProps>(() => ({
    ...handleProps,
    onPointerDown: (event) => {
      // Disarmed before the kit's own guards: the click a carry owes is dispatched before the next
      // press can begin, and a press those guards turn away must not eat the click it makes.
      swallowClickRef.current = false;
      onPointerDown(event);
    },
    onClickCapture: (event) => {
      if (!swallowClickRef.current) return;
      swallowClickRef.current = false;
      if (event.detail === 0) return; // A keyboard's click is not the release that armed this.
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (event) => event.preventDefault(),
  }), [onPointerDown, handleProps]);

  return { dragging, dropTarget, dragProps, attachList };
}
