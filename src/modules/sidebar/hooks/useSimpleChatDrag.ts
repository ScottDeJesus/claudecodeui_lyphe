import { useCallback, useEffect, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

import type { SimpleListDropTarget, SimpleListItem, SimpleListItemRef, SimpleListPosition } from '@/shared/types';
import { positionForDrop } from '@/modules/sidebar/utils/simpleChatTree';

/**
 * Pointer-event carry for the simple chat list's tree: press a row or a folder's header, carry it,
 * drop it somewhere. The house's other drag — the chat gutters — uses the browser's own
 * drag-and-drop, which never fires from a touch screen and this list is used on a phone; so the
 * gesture is pointer events over window listeners, and a touch starts only at `data-drag-handle`.
 *
 * The 5px threshold below tells a carry from a click; presses inside a control are left to the
 * control; the click a carry owes is swallowed, so a drop never opens the chat; Escape and
 * `pointercancel` abandon the press; and the four window listeners come off on unmount. What it
 * carries and what it reads are the tree's: a carried row is a `SimpleListItemRef`, and the target
 * under the pointer comes from the DOM the list draws, never from the tree — whose drawn order is
 * exactly what the reader sees.
 */

/** How far a press must travel before it becomes a carry rather than a click. */
const DRAG_THRESHOLD_PX = 5;
/** The one element a touch may start a carry from. */
const HANDLE_SELECTOR = '[data-drag-handle]';
/** A press inside these never picks a row up: each of them owns its own job. */
const CONTROL_SELECTOR = 'button, input, [data-no-drag]';
/** The list root, as SidebarSimpleList draws it. */
const LIST_SELECTOR = '[data-testid="simple-chat-list"]';
/** A chat row and a folder's header row: what a carried chat may land on. */
const ROW_OR_HEADER_SELECTOR = '[data-testid="simple-chat-row"], [data-testid="simple-chat-folder"]';
/** One top-level row's block: what a carried folder may land beside. */
const BLOCK_SELECTOR = '[data-testid="simple-chat-block"]';

type DragProps = Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'>;

/** A press being tracked; `carrying` turns true once it has travelled past the threshold. */
type ArmedPress = { item: SimpleListItemRef; pointerId: number; startX: number; startY: number; carrying: boolean };

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
 * says it would land, and the handlers every chat row and folder header spreads. `onMove` fires
 * once, on release, and only when `positionForDrop` answers a position the drop really asks for.
 */
export function useSimpleChatDrag({ items, onMove }: {
  items: SimpleListItem[];
  onMove: (item: SimpleListItemRef, position: SimpleListPosition) => void;
}): {
  dragging: SimpleListItemRef | null;
  dropTarget: SimpleListDropTarget | null;
  dragProps: (item: SimpleListItemRef) => DragProps;
} {
  // The carried row and where it would land: both are drawn onto the rows, so both are state.
  const [dragging, setDragging] = useState<SimpleListItemRef | null>(null);
  const [dropTarget, setDropTarget] = useState<SimpleListDropTarget | null>(null);

  // The tree and callback as they stand right now: the window listeners are installed once per
  // press and must read the current value, never the one the installing render captured.
  const itemsRef = useRef(items);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    itemsRef.current = items;
    onMoveRef.current = onMove;
  }, [items, onMove]);

  // The press in flight, its target, the click a carry owes, the way off window: none may be state.
  const pressRef = useRef<ArmedPress | null>(null);
  const targetRef = useRef<SimpleListDropTarget | null>(null);
  const swallowClickRef = useRef(false);
  const detachRef = useRef<(() => void) | null>(null);

  const setTarget = useCallback((next: SimpleListDropTarget | null) => {
    if (targetsEqual(targetRef.current, next)) return;
    targetRef.current = next;
    setDropTarget(next);
  }, []);

  /** Ends the press: off the window, and — when `commit` — a real move handed to `onMove`. */
  const endPress = useCallback((commit: boolean) => {
    const press = pressRef.current;
    if (!press) return;
    pressRef.current = null;
    detachRef.current?.();
    detachRef.current = null;

    if (press.carrying) {
      // A release is still followed by a click; that one is spent, so a drop never opens the chat.
      swallowClickRef.current = true;
      const target = targetRef.current;
      if (commit && target) {
        // Read here, at release, through the refs: the tree as it stands and the one place the
        // pointer named. `positionForDrop` answers null for a drop that changes nothing.
        const position = positionForDrop(itemsRef.current, press.item, target);
        if (position) onMoveRef.current(press.item, position);
      }
    }

    targetRef.current = null;
    setDragging(null);
    setDropTarget(null);
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const press = pressRef.current;
    if (!press || event.pointerId !== press.pointerId) return;
    if (!press.carrying) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < DRAG_THRESHOLD_PX) return;
      press.carrying = true;
      // Without this, the carry smears a text selection across every row it passes over.
      window.getSelection()?.removeAllRanges();
      setDragging(press.item);
    }
    setTarget(
      press.item.kind === 'chat'
        ? chatTargetAt(event.clientY, press.item.id)
        : folderTargetAt(event.clientY, press.item),
    );
  }, [setTarget]);

  const handlePointerUp = useCallback((event: PointerEvent) => {
    if (event.pointerId !== pressRef.current?.pointerId) return;
    endPress(true);
  }, [endPress]);

  const handlePointerCancel = useCallback((event: PointerEvent) => {
    if (event.pointerId !== pressRef.current?.pointerId) return;
    endPress(false);
  }, [endPress]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') endPress(false);
  }, [endPress]);

  const armPress = useCallback((item: SimpleListItemRef, down: Omit<ArmedPress, 'item' | 'carrying'>) => {
    if (pressRef.current) return;
    pressRef.current = { item, ...down, carrying: false };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);
    detachRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlePointerMove, handlePointerUp, handlePointerCancel, handleKeyDown]);

  // A carry cut short by an unmount must not leave its four listeners behind on window.
  useEffect(() => () => {
    detachRef.current?.();
    detachRef.current = null;
    pressRef.current = null;
  }, []);

  const dragProps = useCallback((item: SimpleListItemRef): DragProps => ({
    onPointerDown: (event) => {
      // Disarmed before every guard below: the click a carry owes is dispatched before the next
      // press can begin, and a press these guards turn away must not eat the click it makes.
      swallowClickRef.current = false;
      // The primary button only: every other one belongs to the browser's own menu.
      if (event.button !== 0) return;
      const pressed = event.target instanceof Element ? event.target : null;
      if (pressed?.closest(CONTROL_SELECTOR)) return;
      // A touch starts a carry at the handle alone; anywhere else stays a scroll.
      if (event.pointerType === 'touch' && !pressed?.closest(HANDLE_SELECTOR)) return;
      armPress(item, { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY });
    },
    onClickCapture: (event) => {
      if (!swallowClickRef.current) return;
      swallowClickRef.current = false;
      if (event.detail === 0) return; // A keyboard's click is not the release that armed this.
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (event) => event.preventDefault(),
  }), [armPress]);

  return { dragging, dropTarget, dragProps };
}
