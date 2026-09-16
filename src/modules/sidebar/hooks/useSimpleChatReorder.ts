import { useCallback, useEffect, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

import type { RecentConversationListItem } from '@/shared/types';

/**
 * Pointer-event reorder for the simple chat list: press a row, carry it, drop it elsewhere.
 * The house's other drag — the chat gutters — uses the browser's own drag-and-drop, which never
 * fires from a touch screen and this list is used on a phone; so the gesture is pointer events
 * over window listeners, and a touch may only pick a row up at `data-drag-handle`.
 */

/** How far a press must travel before it becomes a carry rather than a click. */
const DRAG_THRESHOLD_PX = 5;
/** The one element a touch may start a carry from. */
const HANDLE_SELECTOR = '[data-drag-handle]';
/** A press inside these never picks a row up: each of them owns its own job. */
const CONTROL_SELECTOR = 'button, input, [data-no-drag]';
/** The list and one row, as SidebarSimpleList and SidebarSimpleListRow draw them. */
const LIST_SELECTOR = '[data-testid="simple-chat-list"]';
const ROW_SELECTOR = '[data-testid="simple-chat-row"]';

type DropTarget = { sessionId: string; edge: 'before' | 'after' };
type RowDragProps = Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClickCapture' | 'onDragStart'>;

/** A press being tracked; `carrying` turns true once it has travelled past the threshold. */
type ArmedPress = { sessionId: string; pointerId: number; startX: number; startY: number; carrying: boolean };

/**
 * The edge the pointer is over: the first drawn row whose vertical midpoint sits below `clientY`
 * answers `before`, and past the last of them comes the last row's `after`. The carried row is
 * skipped on purpose — it is drawn in its old place, so a bar on it would be a lie, and counting
 * it would make a drop back onto its own position read as a move.
 */
function findDropTarget(clientY: number, carriedId: string): DropTarget | null {
  const list = document.querySelector(LIST_SELECTOR);
  if (!list) return null;
  let last: string | null = null;
  for (const row of list.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    const sessionId = row.dataset.sessionId;
    if (!sessionId || sessionId === carriedId) continue;
    const { top, height } = row.getBoundingClientRect();
    if (clientY < top + height / 2) return { sessionId, edge: 'before' };
    last = sessionId;
  }
  return last === null ? null : { sessionId: last, edge: 'after' };
}

/**
 * What the drop means for the order: the row the carried one lands under, null when it lands
 * first, and null again when the order is already what the drop asks for — so a no-op never PUTs.
 */
function planDrop(ids: string[], carriedId: string, target: DropTarget): { afterSessionId: string | null } | null {
  const without = ids.filter((id) => id !== carriedId);
  const anchor = without.indexOf(target.sessionId);
  if (anchor === -1) return null;
  const at = target.edge === 'after' ? anchor + 1 : anchor;
  const next = [...without.slice(0, at), carriedId, ...without.slice(at)];
  if (next.every((id, index) => id === ids[index])) return null;
  return { afterSessionId: at === 0 ? null : without[at - 1] };
}

/**
 * The reorder behind SidebarSimpleList's rows, its one consumer: which row is carried, which row's
 * edge it would land on, and the handlers every row spreads. `onMove` fires once, on release, and
 * only when the drop really changes the order.
 */
export function useSimpleChatReorder({ rows, onMove }: {
  rows: RecentConversationListItem[];
  onMove: (sessionId: string, afterSessionId: string | null) => void;
}): {
  draggingId: string | null;
  dropTarget: DropTarget | null;
  rowDragProps: (sessionId: string) => RowDragProps;
} {
  // The carried row and the edge it would land on: both are drawn onto the rows, so both are state.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // The rows and callback as they stand right now: the window listeners are installed once per
  // press and must read the current value, never the one the installing render captured.
  const rowsRef = useRef(rows);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    rowsRef.current = rows;
    onMoveRef.current = onMove;
  }, [rows, onMove]);

  // The press in flight, its edge, the click a carry owes, the way off window: none may be state.
  const pressRef = useRef<ArmedPress | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const swallowClickRef = useRef(false);
  const detachRef = useRef<(() => void) | null>(null);

  const setTarget = useCallback((next: DropTarget | null) => {
    const previous = targetRef.current;
    if (previous === next) return;
    if (previous && next && previous.sessionId === next.sessionId && previous.edge === next.edge) return;
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
        const plan = planDrop(rowsRef.current.map((row) => row.sessionId), press.sessionId, target);
        if (plan) onMoveRef.current(press.sessionId, plan.afterSessionId);
      }
    }

    targetRef.current = null;
    setDraggingId(null);
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
      setDraggingId(press.sessionId);
    }
    setTarget(findDropTarget(event.clientY, press.sessionId));
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

  const armPress = useCallback((sessionId: string, down: Omit<ArmedPress, 'sessionId' | 'carrying'>) => {
    if (pressRef.current) return;
    pressRef.current = { sessionId, ...down, carrying: false };
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

  const rowDragProps = useCallback((sessionId: string): RowDragProps => ({
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
      armPress(sessionId, { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY });
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

  return { draggingId, dropTarget, rowDragProps };
}
