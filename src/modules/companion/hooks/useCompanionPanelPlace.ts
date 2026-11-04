import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { clampPanelRect, keyboardCorner, movePanelRect, resizePanelRect } from '@/modules/companion/utils/companionPanelGeometry';
import { readPanelRect, writePanelRect } from '@/modules/companion/utils/companionPanelStorage';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { CompanionPanelHandle, CompanionPanelRect } from '@/shared/types';
import { isPlainPress } from '@/shared/ui/sortable/freePress';
import { usePointerDrag } from '@/shared/ui/usePointerDrag';
import { resizeObserverIn } from '@/shared/utils';

type Size = { width: number; height: number };
type ResizeDelta = { dx: number; dy: number };
type ResizeHandlers = { onResize: (delta: ResizeDelta) => void; onResizeEnd: (delta: ResizeDelta) => void };

/** Where her panel floats, and so moves and resizes: Tailwind's `lg` (the panel's own `lg:` stance), under a fine pointer. */
const FLOATING_QUERY = '(min-width: 1024px) and (pointer: fine)';

/** The browser's one answer, made once: `matchMedia` hands back a live object every read and subscriber shares. */
const floatingQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(FLOATING_QUERY) : null;

function subscribeFloating(listener: () => void): () => void {
  floatingQuery?.addEventListener('change', listener);
  return () => floatingQuery?.removeEventListener('change', listener);
}

const readFloating = () => floatingQuery?.matches ?? false;

/** The room of the shell the panel is placed in (its containing block, `offsetParent`); null while the panel is not drawn. */
function measureRoom(panel: HTMLElement): Size | null {
  const shell = panel.offsetParent;
  return shell instanceof HTMLElement ? { width: shell.clientWidth, height: shell.clientHeight } : null;
}

/** The panel's box as it is drawn, in its shell: whatever drew it, her default stance's classes or a stored box. */
function boxOf(panel: HTMLElement): CompanionPanelRect {
  return { left: panel.offsetLeft, top: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight };
}

/** One length of a computed style, in px. */
const px = (value: string) => Number.parseFloat(value) || 0;

/** The rows `element` lays out: its children in the flow, a `display: contents` wrapper's own children in its place. Out of the flow (the grips) and undrawn rows are skipped. */
function flowRows(element: Element, view: Window): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(element.children)) {
    const style = view.getComputedStyle(child);
    if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') continue;
    if (style.display === 'contents') rows.push(...flowRows(child, view));
    else rows.push(child);
  }
  return rows;
}

/**
 * The least height one row stands in, its vertical margins with it, read off its computed style by three rules. A row
 * that does not give way (`flex-shrink: 0`, or an automatic minimum) stands at its height: her header, a failure's
 * banner, the composer, the walkthrough, the action waiting for his word (whole: it is what will happen). A row that
 * gives way and states a floor — a `min-height` past its padding and border — stands at it: the log's 3.5rem, the notes'
 * 4.75rem, the draft card's own floor (`useCardFloor`: its sends and its field at 88px). A row that gives way and states
 * none stands at its padding and border plus the floors of the rows it holds — summed down a column with its gaps, the
 * tallest across a row — whether or not it scrolls: that is the dock, so at the panel's least every card it holds stands
 * at its own floor, in sight, and none is scrolled out of a strip of padding.
 */
function floorOf(element: Element, view: Window): number {
  const style = view.getComputedStyle(element);
  const margins = px(style.marginTop) + px(style.marginBottom);
  if (style.flexShrink === '0' || style.minHeight === 'auto') return element.getBoundingClientRect().height + margins;
  const chrome = px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  const stated = px(style.minHeight);
  if (stated > chrome) return stated + margins;
  const held = flowRows(element, view).map((row) => floorOf(row, view));
  const across = style.display.endsWith('flex') && style.flexDirection.startsWith('row');
  const rows = across ? Math.max(0, ...held) : held.reduce((sum, height) => sum + height, 0) + Math.max(held.length - 1, 0) * px(style.rowGap);
  return chrome + rows + margins;
}

/**
 * The least height her content stands in, read off the panel as it is drawn: its border and the floor of each of its rows
 * (`floorOf`). Measured, never written down: her focus row, a failure, his long message or a card arriving in the dock
 * moves it, and the panel is drawn no shorter, so the composer is never cut at the panel's edge and no docked card is
 * hidden by the panel's size.
 */
function contentFloor(panel: HTMLElement): number {
  const view = panel.ownerDocument.defaultView;
  if (!view) return 0;
  const own = view.getComputedStyle(panel);
  const rows = flowRows(panel, view).reduce((sum, row) => sum + floorOf(row, view), 0);
  return Math.ceil(px(own.borderTopWidth) + px(own.borderBottomWidth) + rows);
}

/** The inline box a stored box is drawn by. `right` and `bottom` are let go, or her default stance's classes would pin the far sides. */
function boxStyle(rect: CompanionPanelRect): CSSProperties {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: 'auto', bottom: 'auto' };
}

/** The inline properties a box is drawn by, inline or straight onto the panel. */
const BOX_PROPERTIES = ['left', 'top', 'width', 'height', 'right', 'bottom'] as const;

/** Draws a box straight onto the panel, while a drag is in his hand: the same properties `boxStyle` sets, so the render at release finds them already there. */
function draw(panel: HTMLElement, rect: CompanionPanelRect): void {
  Object.assign(panel.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, right: 'auto', bottom: 'auto' });
}

/**
 * Where her panel stands while it FLOATS — from lg, under a fine pointer — and the drags that move and resize it. Used by
 * this module's CompanionPanel: the panel's inline box, the header's press, and one pair of handlers per grip of
 * `CompanionPanelGrips`. Below lg, or under a finger, `floating` is false, nothing is drawn inline and the panel is the
 * sheet (or the column) its classes make it.
 *
 * WITH NOTHING STORED, NOTHING IS DRAWN INLINE: her default stance is the panel's own classes (the right edge, 12px in, the
 * full height less 12px top and bottom, 400px wide), so a browser in which he never moved her sees exactly what it saw
 * before. The first move or resize starts from that box as it is drawn (`boxOf`).
 *
 * THE BOX DRAWN is the stored one held inside the shell (`clampPanelRect`) at every render, against the room and the
 * content's floor as last measured — at open, after every render of the panel, and on every resize of the shell or of a
 * row of the panel (a ResizeObserver: the window's resizes, his message growing, a header row wrapping; events, never a
 * poll). A box stored on a bigger window shrinks to fit a smaller one and grows back with it. The stored box changes only
 * at the release of his move or resize, written once (`writePanelRect`).
 *
 * A DRAG IS DRAWN STRAIGHT ONTO THE PANEL (`draw`), every move clamped live, and put in state once at its release: the
 * panel holds her whole log, and a render of it on every pointer move is a drag that stutters. While one is in his hand,
 * nothing here sets state, so no render can draw the stored box back over the one under his pointer.
 *
 * THE MOVE is a press on the header's empty space (`isPlainPress`: a press on any control in it stays the control's),
 * on the kit's drag (`usePointerDrag`, kind `move`): the frames under it go inert for the drag, its capture is taken
 * only once the drag begins (a click or a double-click on her name behaves as it always did), and a selection its first
 * pixels began is let go. A move keeps the size he chose. THE RESIZE is the eight grips, each moving the sides it names
 * (`resizePanelRect`), with the floor read again once the box is drawn at its new width, where a header row may have
 * wrapped.
 */
export function useCompanionPanelPlace(panelRef: RefObject<HTMLElement>, open: boolean): {
  floating: boolean;
  style: CSSProperties | undefined;
  onMovePress: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  resizeBy: (handle: CompanionPanelHandle) => ResizeHandlers;
  keyboardCorner: 'bottom-left' | 'bottom-right';
} {
  const floating = useSyncExternalStore(subscribeFloating, readFloating, () => false);
  const hostWindow = useHostWindow();
  // What he last moved or resized her panel to in this browser, read once; null for her default stance. Written at the
  // release of each drag and never by a clamp, so a box held in by a smaller window comes back when the window grows.
  const [stored, setStored] = useState<CompanionPanelRect | null>(readPanelRect);
  // The shell's room, measured while the panel floats and is open: the drawn box is held inside it at every render, and a
  // window resized under the panel reaches a render through nothing else.
  const [room, setRoom] = useState<Size | null>(null);
  // The least height her content stands in (`contentFloor`), measured the same way: the drawn box never goes under it.
  const [floor, setFloor] = useState(0);
  // The drag in his hand — which handle, the box at its press and the box drawn at its last move — or null. A ref: a drag
  // is drawn straight onto the panel, and the box goes into state once, at its release.
  const gesture = useRef<{ handle: CompanionPanelHandle | 'move'; base: CompanionPanelRect; rect: CompanionPanelRect } | null>(null);
  const active = floating && open;

  const measure = useCallback(() => {
    const panel = panelRef.current;
    // While a drag is in his hand it draws the box itself; a render now would draw the stored box over it.
    if (!panel || gesture.current) return;
    const measured = measureRoom(panel);
    if (measured) setRoom((was) => (was?.width === measured.width && was.height === measured.height ? was : measured));
    setFloor(contentFloor(panel));
  }, [panelRef]);

  // After every render: a row that came or went with this render (a failure's banner, the dock) moves the floor.
  useLayoutEffect(() => {
    if (active) measure();
  });

  // Between renders: the shell's own resizes (the window's) and each row's (his message growing, a header row wrapping).
  useEffect(() => {
    const panel = panelRef.current;
    const shell = panel?.offsetParent;
    if (!active || !panel || !shell) return undefined;
    const observer = resizeObserverIn(hostWindow, measure);
    observer?.observe(shell);
    for (const row of Array.from(panel.children)) observer?.observe(row);
    return () => observer?.disconnect();
  }, [active, panelRef, hostWindow, measure]);

  /** Draws the box `compute` gives for the room and floor as they are now, and keeps it as the drag's latest box. */
  const follow = (compute: (roomNow: Size, floorNow: number) => CompanionPanelRect) => {
    const panel = panelRef.current;
    const held = gesture.current;
    const roomNow = panel ? measureRoom(panel) : null;
    if (!panel || !held || !roomNow) return;
    let rect = compute(roomNow, contentFloor(panel));
    draw(panel, rect);
    // At its new width a row of her header may have wrapped: the floor is read again from the box as drawn, and a box that
    // went under it is drawn again at it.
    const after = contentFloor(panel);
    if (after > rect.height) {
      rect = compute(roomNow, after);
      draw(panel, rect);
    }
    held.rect = rect;
  };

  /**
   * The drag's release: its box is stored, in state and in this browser, and the room and floor are read again for the
   * render it causes. A move keeps the size he chose (or her default's), whatever this window holds it to: a move changes
   * where she stands, never her size.
   */
  const commit = () => {
    const held = gesture.current;
    if (!held) return;
    gesture.current = null;
    const rect = held.handle === 'move'
      ? { ...held.rect, width: stored?.width ?? held.base.width, height: stored?.height ?? held.base.height }
      : held.rect;
    setStored(rect);
    writePanelRect(rect);
    measure();
  };

  /** Starts the drag of `handle` from the box as drawn, unless that drag is already in his hand. */
  const hold = (handle: CompanionPanelHandle | 'move') => {
    const panel = panelRef.current;
    if (!panel) return null;
    if (gesture.current?.handle !== handle) {
      const base = boxOf(panel);
      gesture.current = { handle, base, rect: base };
    }
    return gesture.current;
  };

  const move = usePointerDrag({
    kind: 'move',
    accept: (event) => isPlainPress(event.target, event.currentTarget),
    captureOnStart: (handle) => handle,
    onStart: () => {
      // A press on her name may have begun a selection in the first pixels of travel: a drag selects nothing.
      panelRef.current?.ownerDocument.getSelection()?.removeAllRanges();
      gesture.current = null;
      hold('move');
    },
    onMove: ({ dx, dy }) => {
      const held = gesture.current;
      if (held?.handle === 'move') follow((roomNow, floorNow) => movePanelRect(held.base, dx, dy, roomNow, floorNow));
    },
    onEnd: ({ dx, dy, moved }) => {
      const held = gesture.current;
      if (held?.handle !== 'move' || !moved) return;
      follow((roomNow, floorNow) => movePanelRect(held.base, dx, dy, roomNow, floorNow));
      commit();
    },
  });

  const resizeBy = (handle: CompanionPanelHandle): ResizeHandlers => ({
    onResize: (delta) => {
      const held = hold(handle);
      if (held) follow((roomNow, floorNow) => resizePanelRect(held.base, handle, delta, roomNow, floorNow));
    },
    onResizeEnd: (delta) => {
      const held = hold(handle);
      if (!held) return;
      follow((roomNow, floorNow) => resizePanelRect(held.base, handle, delta, roomNow, floorNow));
      commit();
    },
  });

  // A drag cut short by the panel closing or ceasing to float (Escape in her composer, the window narrowed past lg) ends
  // where he left it. A panel that no longer floats keeps none of the drag's inline box: from here its classes draw it.
  // The render's own `commit` (it reads the stored size), kept in an effect and never during a render React may discard.
  const latestCommit = useRef(commit);
  useEffect(() => {
    latestCommit.current = commit;
  });
  useEffect(() => {
    const panel = panelRef.current;
    if (active || !gesture.current) return;
    latestCommit.current();
    if (!floating && panel) for (const property of BOX_PROPERTIES) panel.style.removeProperty(property);
  }, [active, floating, panelRef]);

  const drawn = floating && stored && room ? clampPanelRect(stored, room, floor) : null;
  return {
    floating,
    style: drawn ? boxStyle(drawn) : undefined,
    onMovePress: floating ? move.onPointerDown : undefined,
    resizeBy,
    keyboardCorner: keyboardCorner(drawn, room),
  };
}
