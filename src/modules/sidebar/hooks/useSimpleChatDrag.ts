import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

import { TOUCH_HOLD_MS } from '@/shared/constants';
import type { SimpleListDropTarget, SimpleListItem, SimpleListItemRef, SimpleListPosition } from '@/shared/types';
import { useCarryEdgeScroll } from '@/modules/sidebar/hooks/useCarryEdgeScroll';
import { positionForDrop } from '@/modules/sidebar/utils/simpleChatTree';
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
/** The list root, as SidebarSimpleList draws it. */
const LIST_SELECTOR = '[data-testid="simple-chat-list"]';
/** A chat row and a folder's header row: what a carried chat may land on. */
const ROW_OR_HEADER_SELECTOR = '[data-testid="simple-chat-row"], [data-testid="simple-chat-folder"]';
/** One top-level row's block: what a carried folder may land beside. */
const BLOCK_SELECTOR = '[data-testid="simple-chat-block"]';

type DragProps = Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'>;

/** A drawn row or folder header, and the box it stands in: what a carry reads under the pointer. */
type DrawnRow = { ref: SimpleListItemRef; top: number; bottom: number; height: number };

/** Whether two refs name the same row. */
const refsEqual = (a: SimpleListItemRef, b: SimpleListItemRef): boolean => a.kind === b.kind && a.id === b.id;

/** Whether two targets ask for the same place, so a pointer that has not moved on re-renders nothing. */
function targetsEqual(a: SimpleListDropTarget | null, b: SimpleListDropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.at !== b.at) return false;
  if (a.at === 'end') return true;
  if (a.at === 'into') return b.at === 'into' && a.folderId === b.folderId;
  if (b.at !== 'row') return false;
  return a.edge === b.edge && refsEqual(a.item, b.item);
}

/** The ref a drawn chat row or folder header names, from the id it carries; null for an element that carries neither. */
function refOfRow(element: HTMLElement): SimpleListItemRef | null {
  const sessionId = element.dataset.sessionId;
  if (sessionId) return { kind: 'chat', id: sessionId };
  const folderId = element.dataset.folderId;
  return folderId ? { kind: 'folder', id: folderId } : null;
}

/** The top-level row a block names, from its `data-item-kind` and `data-item-id`; null for a block that carries neither. */
function refOfBlock(block: HTMLElement): SimpleListItemRef | null {
  const id = block.dataset.itemId;
  const kind = block.dataset.itemKind;
  if (!id || (kind !== 'chat' && kind !== 'folder')) return null;
  return { kind, id };
}

/**
 * What a carried CHAT is over: the drawn chat row or folder header the pointer has entered last —
 * the one whose top edge is at or above the pointer while the next one's is not. Inside a row that
 * is the row itself; in the gap between two rows it is the row above, where a pointer in that gap
 * belongs: the row drawn below a folder's last chat is a top-level one, and answering "before it"
 * reads as a move out of the folder the row still stands in. A chat row splits at its middle; a
 * folder header's top quarter is `before` and the rest is `into`, so a slight aim above a header
 * drops beside the folder and every other aim drops inside it. Above the first drawn row is the
 * top of the list; past the last one is `{ at: 'end' }`, except under the carried row: its own
 * place reaches to the bottom of the list's box, so a press and release there moves nothing.
 */
function chatTargetAt(clientY: number, carriedId: string): SimpleListDropTarget | null {
  const list = document.querySelector(LIST_SELECTOR);
  if (!list) return null;
  const listBottom = list.getBoundingClientRect().bottom;
  let first: SimpleListItemRef | null = null;
  let over: DrawnRow | null = null;
  // Whether any drawn row begins below the pointer: the pointer is among the rows, not past them.
  let drawnBelow = false;
  for (const element of list.querySelectorAll<HTMLElement>(ROW_OR_HEADER_SELECTOR)) {
    const ref = refOfRow(element);
    if (ref === null) continue;
    first ??= ref;
    const { top, bottom, height } = element.getBoundingClientRect();
    // The rows are drawn in the order they stand, so the first the pointer has not reached is below
    // it, and the last it has reached is the one it is over.
    if (clientY < top) {
      drawnBelow = true;
      break;
    }
    over = { ref, top, bottom, height };
  }
  if (over === null) {
    // Above every drawn row: the first row's own top edge, the top of the list.
    return first === null ? null : { at: 'row', item: first, edge: 'before' };
  }
  if (over.ref.kind === 'chat' && over.ref.id === carriedId) {
    // The place the carried row already stands in, named by its own top edge: `refAbove` skips the
    // carried row and answers the row above it in its own container, so this is exactly the
    // position the row holds today. Hand the pointer to the next row instead — as dropping the
    // carried row from the candidates does — and the first row below a folder's last chat, a
    // top-level one, takes the anchor: a press and release inside the row lifts it out of the
    // folder.
    //
    // No row below means this one is the last drawn, and the rule's `{ at: 'end' }` is the answer
    // only past the list's own box: the tail under the row is still the list, so it stays its own
    // place, and the last chat of the last folder can still be carried to the end.
    if (!drawnBelow && clientY > listBottom) return { at: 'end' };
    return { at: 'row', item: over.ref, edge: 'before' };
  }
  if (!drawnBelow && clientY > over.bottom) {
    // Past the last drawn row: the end of the list rather than a row.
    return { at: 'end' };
  }
  if (over.ref.kind === 'chat') {
    return { at: 'row', item: over.ref, edge: clientY < over.top + over.height / 2 ? 'before' : 'after' };
  }
  return clientY < over.top + over.height / 4
    ? { at: 'row', item: over.ref, edge: 'before' }
    : { at: 'into', folderId: over.ref.id };
}

/**
 * What a carried FOLDER is over: the first block whose bottom edge is at or below the pointer, and
 * the last one when the pointer is past them all. Above a block's middle is `before` and the rest
 * is `after` — a folder lives at the top level, so those are the only two places it can land.
 * A folder cannot land inside itself or another folder, and its own block is skipped for that.
 */
function folderTargetAt(clientY: number, carried: SimpleListItemRef): SimpleListDropTarget | null {
  const list = document.querySelector(LIST_SELECTOR);
  if (!list) return null;
  const blocks = [...list.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].filter((block) => {
    const item = refOfBlock(block);
    return item !== null && !refsEqual(item, carried);
  });
  if (blocks.length === 0) return null;
  let chosen = blocks[blocks.length - 1];
  for (const block of blocks) {
    if (clientY <= block.getBoundingClientRect().bottom) {
      chosen = block;
      break;
    }
  }
  const item = refOfBlock(chosen);
  if (item === null) return null;
  const { top, height } = chosen.getBoundingClientRect();
  return { at: 'row', item, edge: clientY < top + height / 2 ? 'before' : 'after' };
}

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
  dragProps: DragProps;
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
  // The list's root, as `attachList` was handed it: where the pointer's capture goes at the lift.
  const listRef = useRef<HTMLElement | null>(null);

  const setTarget = useCallback((next: SimpleListDropTarget | null) => {
    if (targetsEqual(targetRef.current, next)) return;
    targetRef.current = next;
    setDropTarget(next);
  }, []);

  /** Reads the row or end the pointer at `pointerY` is over and makes it the target: on a move, and when the pane scrolled under a still pointer. */
  const retarget = useCallback((pointerY: number) => {
    const carried = carriedRef.current;
    if (carried === null || abandonedRef.current) return;
    setTarget(carried.kind === 'chat' ? chatTargetAt(pointerY, carried.id) : folderTargetAt(pointerY, carried));
  }, [setTarget]);
  const { begin: beginEdgeScroll, follow: followEdgeScroll, end: endEdgeScroll } = useCarryEdgeScroll(retarget);

  const { onPointerDown } = usePointerDrag({
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
      return pressedRef.current !== null;
    },
    // At the lift, not the press: a capture taken at the press would re-target the click that follows
    // it, and the row's own link and fold toggle would never hear a tap. And on the LIST, not the row:
    // `:hover` follows the capture, so a row that kept it would stay washed while it is carried.
    captureOnStart: (handle) => listRef.current ?? handle,
    onStart: ({ y }) => {
      carriedRef.current = pressedRef.current;
      abandonedRef.current = false;
      if (listRef.current !== null) beginEdgeScroll(listRef.current, y);
      // Without this, the carry smears a text selection across every row it passes over.
      window.getSelection()?.removeAllRanges();
      tickLift();
      setDragging(carriedRef.current);
    },
    onMove: ({ y }) => {
      followEdgeScroll(y);
      retarget(y);
    },
    onEnd: ({ cancelled }) => {
      endEdgeScroll();
      const carried = carriedRef.current;
      const target = targetRef.current;
      const abandoned = abandonedRef.current;
      pressedRef.current = null;
      carriedRef.current = null;
      targetRef.current = null;
      abandonedRef.current = false;
      // A press that never lifted is a click, and the click is the row's own.
      if (carried === null) return;
      // A release is still followed by a click; that one is spent, so a drop never opens the chat.
      swallowClickRef.current = true;
      setDragging(null);
      setDropTarget(null);
      // A carry the browser took away (a palm, a system gesture) or the reader abandoned is not a drop.
      if (cancelled || abandoned || target === null) return;
      // Read here, at release, through the refs: the tree as it stands and the one place the pointer
      // named. `positionForDrop` answers null for a drop that changes nothing.
      const position = positionForDrop(itemsRef.current, carried, target);
      if (position) onMoveRef.current(carried, position);
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
    };
    window.addEventListener('keydown', abandon);
    return () => window.removeEventListener('keydown', abandon);
  }, [dragging, setTarget, endEdgeScroll]);

  // One object for every row and header: the row a press lands on is read off the row itself, so
  // there is nothing per-row to close over.
  const dragProps = useMemo<DragProps>(() => ({
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
  }), [onPointerDown]);

  return { dragging, dropTarget, dragProps, attachList };
}
