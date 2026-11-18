import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { useCarryEdgeScroll } from '@/modules/sidebar/hooks/useCarryEdgeScroll';
import { boardChatTargetAt, boardFolderTargetAt } from '@/modules/sidebar/utils/boardDropTarget';
import { targetsEqual } from '@/modules/sidebar/utils/simpleChatDropTarget';
import { positionForDrop } from '@/modules/sidebar/utils/simpleChatTree';
import { TOUCH_HOLD_MS } from '@/shared/constants';
import type { SimpleListDragProps, SimpleListDropTarget, SimpleListItem, SimpleListItemRef, SimpleListPosition } from '@/shared/types';
import { dropNow, placeUnder, putDown, takeUp } from '@/shared/ui/sortable/carried';
import type { Grip } from '@/shared/ui/sortable/carried';
import { tickLift } from '@/shared/ui/sortable/touchLift';
import { usePointerDrag } from '@/shared/ui/usePointerDrag';

/** How far a mouse press must travel before it becomes a carry rather than a click. */
const DRAG_THRESHOLD_PX = 5;
/** A press inside these never picks anything up: each of them owns its own job. */
const CONTROL_SELECTOR = 'button, input, [data-no-drag]';
/** A folder's whole column, which is what travels when its name is carried. */
const COLUMN_SELECTOR = '[data-board-folder]';

/** The row or folder a pressed element names: a chat's row carries `data-board-row`, a folder's name carries `data-board-folder-handle`. */
function refOfPressed(element: HTMLElement): SimpleListItemRef | null {
  const sessionId = element.dataset.boardRow;
  if (sessionId) return { kind: 'chat', id: sessionId };
  const folderId = element.dataset.boardFolderHandle;
  return folderId ? { kind: 'folder', id: folderId } : null;
}

/**
 * THE CARRY OF THE SESSIONS BOARD: press a chat's row or a folder's name, carry it, drop it somewhere. It is the simple list's own
 * carry (`useSimpleChatDrag`) for a board whose folders stand side by side: the same gesture (the kit's `usePointerDrag`, kind
 * `sort`: a mouse carries once it has moved past the threshold, a finger once it has held still for `TOUCH_HOLD_MS`, and one that
 * moves first is scrolling the page), the same lifted look (`sortable/carried.ts`), the same table from a drop to a position
 * (`positionForDrop`) and so the same one write (`onMove`, the folder hook's `move`). What a carry does on the list it does here.
 *
 * WHAT IS THE BOARD'S OWN. The carried thing follows the pointer in both directions, kept inside the board's box. A chat is lifted
 * as its row; a folder as its whole column, by its name. Where it would land is read from the board's columns
 * (`boardDropTarget.ts`): a chat lands before or after a chat in any column, or in a folder that holds none, or out of every
 * folder; a folder lands before or after another folder. A release out of reach of every column moves nothing.
 *
 * AS ON THE LIST: a press inside a control is the control's; the click a carry owes is swallowed, so a drop never opens the chat;
 * Escape abandons the carry; a lifted row held at the page's top or bottom edge scrolls the page toward it (`useCarryEdgeScroll`).
 *
 * `onMove` fires once, on release, and only when the drop asks for a place the row does not already hold. Used by `SessionsBoard`,
 * which spreads `dragProps` on every chat row and folder name and puts `boardRef` on its root.
 */
export function useBoardCarry({ items, onMove }: {
  items: SimpleListItem[];
  onMove: (item: SimpleListItemRef, position: SimpleListPosition) => void;
}): {
  dragging: SimpleListItemRef | null;
  dropTarget: SimpleListDropTarget | null;
  dragProps: SimpleListDragProps;
  boardRef: RefObject<HTMLDivElement>;
} {
  // The carried thing and where it would land: both are drawn onto the board, so both are state.
  const [dragging, setDragging] = useState<SimpleListItemRef | null>(null);
  const [dropTarget, setDropTarget] = useState<SimpleListDropTarget | null>(null);

  // The tree and callback as they stand right now: the release reads them and must see the current value, never the one the render
  // that started the carry captured.
  const itemsRef = useRef(items);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    itemsRef.current = items;
    onMoveRef.current = onMove;
  }, [items, onMove]);

  // What a press landed on, what was lifted from it, its target, the pointer's last place across the page (the edge scroll knows
  // only how far down it is), the click a carry owes and an Escape taken mid-carry: none may be state.
  const pressedRef = useRef<SimpleListItemRef | null>(null);
  const pressedElementRef = useRef<HTMLElement | null>(null);
  const carriedRef = useRef<SimpleListItemRef | null>(null);
  const targetRef = useRef<SimpleListDropTarget | null>(null);
  const pointerXRef = useRef(0);
  const swallowClickRef = useRef(false);
  const abandonedRef = useRef(false);
  const gripRef = useRef<Grip | null>(null);
  // The board's root, put on it by the caller: where the pointer's capture goes at the lift, and the box the carry stays in.
  const boardRef = useRef<HTMLDivElement>(null);

  const setTarget = useCallback((next: SimpleListDropTarget | null) => {
    if (targetsEqual(targetRef.current, next)) return;
    targetRef.current = next;
    setDropTarget(next);
  }, []);

  /** Reads what the pointer is over and makes it the target. */
  const retarget = useCallback((x: number, y: number) => {
    const carried = carriedRef.current;
    const board = boardRef.current;
    if (carried === null || board === null || abandonedRef.current) return;
    setTarget(carried.kind === 'chat' ? boardChatTargetAt(board, x, y, carried.id) : boardFolderTargetAt(board, x, y, carried));
  }, [setTarget]);

  /**
   * Draws the lifted thing under the pointer, kept inside the board's own box: it never leaves its slot (the gap it leaves is the
   * point), so one drawn past the board's end would add to the page's scrollable overflow with every pixel the page scrolled, and
   * the edge loop would find no end.
   */
  const placeLifted = useCallback((x: number, y: number) => {
    const grip = gripRef.current;
    if (grip === null) return;
    let left = x - grip.grabX;
    let top = y - grip.grabY;
    if (boardRef.current !== null) {
      const board = boardRef.current.getBoundingClientRect();
      const lifted = grip.element.getBoundingClientRect();
      left = Math.min(Math.max(left, board.left), Math.max(board.left, board.right - lifted.width));
      top = Math.min(Math.max(top, board.top), Math.max(board.top, board.bottom - lifted.height));
    }
    placeUnder(grip, left + grip.grabX, top + grip.grabY);
  }, []);

  // The page scrolled under a still pointer, or a frame passed: the edge scroll knows the pointer's height, and its place across is
  // the last one a move gave.
  const followScrolled = useCallback((y: number) => {
    placeLifted(pointerXRef.current, y);
    retarget(pointerXRef.current, y);
  }, [placeLifted, retarget]);
  const placeOnFrame = useCallback((y: number) => placeLifted(pointerXRef.current, y), [placeLifted]);
  const { begin: beginEdgeScroll, follow: followEdgeScroll, end: endEdgeScroll } = useCarryEdgeScroll(followScrolled, placeOnFrame);

  const { onPointerDown, handleProps } = usePointerDrag({
    kind: 'sort',
    threshold: DRAG_THRESHOLD_PX,
    holdMs: TOUCH_HOLD_MS,
    accept: (event) => {
      // React bubbles a press from a PORTAL (a row's open menu) through the component tree to this row, though the portal is not
      // inside it: only a press that landed in the row's own DOM counts.
      if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return false;
      if (event.target.closest(CONTROL_SELECTOR)) return false;
      pressedRef.current = refOfPressed(event.currentTarget);
      pressedElementRef.current = event.currentTarget;
      return pressedRef.current !== null;
    },
    // At the lift, not the press: a capture taken at the press would re-target the click that follows it, and the row's own link
    // would never hear a tap. And on the BOARD, not the row: `:hover` follows the capture, so a row that kept it would stay washed.
    captureOnStart: (handle) => boardRef.current ?? handle,
    onStart: ({ x, y }) => {
      carriedRef.current = pressedRef.current;
      abandonedRef.current = false;
      pointerXRef.current = x;
      if (boardRef.current !== null) beginEdgeScroll(boardRef.current, y);
      // Without this, the carry smears a text selection across everything it passes over.
      window.getSelection()?.removeAllRanges();
      const pressed = pressedElementRef.current;
      const element = pressed === null || !pressed.isConnected || carriedRef.current === null
        ? null
        : carriedRef.current.kind === 'folder' ? pressed.closest<HTMLElement>(COLUMN_SELECTOR) : pressed;
      if (element !== null) {
        gripRef.current = { element, ...takeUp(element, x, y) };
        placeLifted(x, y);
      }
      tickLift();
      setDragging(carriedRef.current);
    },
    onMove: ({ x, y }) => {
      pointerXRef.current = x;
      followEdgeScroll(y);
      placeLifted(x, y);
      retarget(x, y);
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
      // A carry the browser took away or the reader abandoned is not a drop. `positionForDrop` answers null for a drop that changes nothing.
      const position = cancelled || abandoned || target === null ? null : positionForDrop(itemsRef.current, carried, target);
      // Where the thing is drawn now, read before the board changes under it: it settles from there.
      const from = grip === null ? null : grip.element.getBoundingClientRect();
      // At once, so the row never shows a frame in its old slot between the drop and the board that has it.
      flushSync(() => {
        setDragging(null);
        setDropTarget(null);
        if (position) onMoveRef.current(carried, position);
      });
      if (grip !== null && from !== null) putDown(grip.element, from);
    },
  });

  // Escape abandons the carry: the marks come off at once and the release that follows commits nothing.
  useEffect(() => {
    if (dragging === null) return undefined;
    const abandon = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      abandonedRef.current = true;
      endEdgeScroll();
      setTarget(null);
      setDragging(null);
      const grip = gripRef.current;
      gripRef.current = null;
      if (grip !== null) putDown(grip.element);
    };
    window.addEventListener('keydown', abandon);
    return () => window.removeEventListener('keydown', abandon);
  }, [dragging, setTarget, endEdgeScroll]);

  // A board torn down mid-carry takes the thing out of the hand where it stands.
  useEffect(() => () => {
    if (gripRef.current !== null) dropNow(gripRef.current.element);
    gripRef.current = null;
  }, []);

  // One object for every row and folder name: what a press lands on is read off the element itself, so there is nothing to close over.
  const dragProps = useMemo<SimpleListDragProps>(() => ({
    ...handleProps,
    onPointerDown: (event) => {
      // Disarmed before the kit's own guards: the click a carry owes is dispatched before the next press can begin, and a press
      // those guards turn away must not eat the click it makes.
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

  return { dragging, dropTarget, dragProps, boardRef };
}
