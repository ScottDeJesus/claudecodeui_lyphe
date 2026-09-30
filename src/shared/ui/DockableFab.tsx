import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { usePointerDrag } from '@/shared/ui/usePointerDrag';
import { cn } from '@/shared/utils';

export type DockableFabPosition = { docked: true } | { docked: false; x: number; y: number };

type DockableFabProps = {
  label: string;                  // aria-label AND tooltip text; every word arrives as a prop
  icon: ReactNode;                // the glyph; the kit draws no icon of its own
  position: DockableFabPosition;  // controlled — the owner persists it
  dockRect: DOMRect | null;       // where the dock is, measured by the owner; null = nowhere to dock
  active?: boolean;               // renders as aria-expanded and the pressed wash
  indicator?: boolean;            // a dot on the rim: it is the reader's turn. Drawn inside the one button
  onPress: (press: { keyboard: boolean }) => void;  // a click that did not end a drag — a tap, a mouse click, Enter or Space; `keyboard` is true when no pointer was behind it
  onDragStart?: () => void;       // once, when a gesture becomes a drag: the first move past the threshold
  onPositionChange: (next: DockableFabPosition) => void;  // exactly once per drag, at release
  onRectChange?: (rect: DOMRect) => void;                 // the button's measured rect, after every placement and window resize
};

type FabPoint = { x: number; y: number };

/** The gap the FAB keeps from every edge of the SAFE area. */
const VIEWPORT_EDGE_PX = 8;

/** How close a release must land to the dock's centre to be taken as a drop back into it. */
const DOCK_SNAP_RADIUS_PX = 64;

/** The FAB's drawn size (`--vv-fab-size` in surfaces.css), for the clamp on a node whose own box
 *  cannot be measured yet. The 44px catch around it is a pseudo-element and never part of the box. */
const FAB_SIZE_PX = 28;

/**
 * How far in from one side of the viewport the FAB may sit: the side's safe-area inset plus the edge
 * gap. The app is `viewport-fit=cover` and runs standalone, so `100vw`/`100dvh` reach under the
 * notch, the status bar and the home indicator, where a FAB is covered or unreachable. Where there
 * is no inset, `env()` falls back to 0 and this is the bare 8px.
 */
function safeEdge(side: 'top' | 'right' | 'bottom' | 'left'): string {
  return `calc(env(safe-area-inset-${side}, 0px) + ${VIEWPORT_EDGE_PX}px)`;
}

/**
 * The kit's own resting corner, for a FAB that has no usable place of its own: told to dock with no
 * dock, or handed a point that is not a number. Bottom-right, spelt in the FAB's live size and inside
 * the safe area, so it clears both edges at either floating size. Where a FAB that was never moved
 * first appears is the OWNER's default, not this — the owner resolves that before the kit sees a
 * position.
 */
const RESTING_CORNER: CSSProperties = {
  left: 'calc(100vw - var(--vv-fab-size) - env(safe-area-inset-right, 0px) - 16px)',
  top: 'calc(100dvh - var(--vv-fab-size) - env(safe-area-inset-bottom, 0px) - 56px)',
};

/**
 * A floating point, held on screen by CSS rather than trusted. A stored `x`/`y` was measured on
 * whatever window the reader had then — a point saved at 1800px on a desktop is off a 390px phone —
 * and the FAB is the reader's only way out of a pane, so the clamp is `clamp()` against the live
 * viewport's safe area and the FAB's own `--vv-fab-size`. No resize listener can be late for it. A
 * record that parsed but holds no number would make the browser drop `left`/`top` and paint at
 * (0,0), over the dock's corner, so a non-finite point rests in the corner instead.
 */
function onScreen({ x, y }: FabPoint): CSSProperties {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return RESTING_CORNER;
  return {
    left: `clamp(${safeEdge('left')}, ${x}px, calc(100vw - var(--vv-fab-size) - ${safeEdge('right')}))`,
    top: `clamp(${safeEdge('top')}, ${y}px, calc(100dvh - var(--vv-fab-size) - ${safeEdge('bottom')}))`,
  };
}

/**
 * The one place left/top come from: the held point, the dock's rect, or the stored x/y. Docked, the
 * FAB is CENTRED on the dock, so the dock's own size never has to repeat `--vv-fab-size`, and the
 * centre the snap measures to is the centre the FAB lands on.
 */
function fabPlacement(
  position: DockableFabPosition,
  dockRect: DOMRect | null,
  heldPoint: FabPoint | null,
): CSSProperties {
  if (heldPoint) return onScreen(heldPoint);
  if (!position.docked) return onScreen(position);
  if (!dockRect) return RESTING_CORNER;
  const centreX = dockRect.left + dockRect.width / 2;
  const centreY = dockRect.top + dockRect.height / 2;
  return {
    left: `calc(${centreX}px - var(--vv-fab-size) / 2)`,
    top: `calc(${centreY}px - var(--vv-fab-size) / 2)`,
  };
}

/**
 * The button's rect as it is PLACED: `getBoundingClientRect()` with the button's own press and hover
 * scale divided back out.
 *
 * The bare rect is the paint, and the paint breathes — `.vv-fab:hover` scales the circle to 1.06 and
 * `:active` to 0.92 about its centre (surfaces.css), so the bare width is 29.68 under a pointer and 28
 * at rest. A caller that stands something beside the FAB would twitch a pixel or two on every hover,
 * and would carry a stale rect forever once a transition settled with no event to say so (there is
 * none under `prefers-reduced-motion`). Both scales are about the centre, so the centre is exact and
 * only the size is put back. The current matrix is read rather than assumed, so a report taken
 * mid-transition still divides out the scale that rect was drawn at.
 */
function placedRect(node: HTMLButtonElement): DOMRect {
  const drawn = node.getBoundingClientRect();
  const scale = new DOMMatrixReadOnly(getComputedStyle(node).transform).a;
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return drawn;
  const width = drawn.width / scale;
  const height = drawn.height / scale;
  return new DOMRect(
    drawn.left + (drawn.width - width) / 2,
    drawn.top + (drawn.height - height) / 2,
    width,
    height,
  );
}

/**
 * The held point, clamped so the whole button stays on screen. The point is the button's TOP-LEFT, so
 * the button's own live box is what the far edge is measured against — a full circle off the right
 * edge is a way out of a pane with none of its hit area left. `onScreen` clamps again in CSS, which is
 * what keeps a STORED point honest against a window that has since changed size; this clamp is what
 * keeps the point the owner is handed worth storing.
 */
function clampToViewport(point: FabPoint, node: HTMLButtonElement | null): FabPoint {
  const rect = node?.getBoundingClientRect();
  const width = rect && rect.width > 0 ? rect.width : FAB_SIZE_PX;
  const height = rect && rect.height > 0 ? rect.height : FAB_SIZE_PX;
  const maxX = Math.max(VIEWPORT_EDGE_PX, window.innerWidth - width - VIEWPORT_EDGE_PX);
  const maxY = Math.max(VIEWPORT_EDGE_PX, window.innerHeight - height - VIEWPORT_EDGE_PX);
  return {
    x: Math.min(maxX, Math.max(VIEWPORT_EDGE_PX, point.x)),
    y: Math.min(maxY, Math.max(VIEWPORT_EDGE_PX, point.y)),
  };
}

/**
 * Whether a release landed close enough to the dock's centre to be a drop into it.
 *
 * A rect of zero size is not a dock, and neither is a missing one: `position.docked` is what the owner
 * persists, and the owner hands the kit a rect that is real or hands it nothing at all. Snapping to the
 * centre of a rect the page has not measured would pin the button to a point nobody can see, let alone
 * reach — and this button is the reader's way back out of a pane.
 */
function overDock(release: FabPoint, dockRect: DOMRect | null): boolean {
  if (!dockRect || dockRect.width === 0 || dockRect.height === 0) return false;
  const centreX = dockRect.left + dockRect.width / 2;
  const centreY = dockRect.top + dockRect.height / 2;
  return Math.hypot(release.x - centreX, release.y - centreY) <= DOCK_SNAP_RADIUS_PX;
}

/**
 * The house floating action button: an accent circle the reader can drag anywhere on screen and
 * drop back into a dock.
 *
 * It is ONE `position: fixed` node for its whole life. Docked, its left/top are read from
 * `dockRect`; floating, from `x`/`y`. It is never unmounted into the dock's header and back out,
 * because a node that unmounts mid-drag loses its pointer capture and the drag dies in the
 * reader's hand. A `docked` position with no `dockRect` floats bottom-right instead of painting
 * at a remembered ghost.
 *
 * `onRectChange` hands the owner the button's MEASURED rect, after every placement and on every window
 * resize. The owner cannot compute it: a floating position is a CSS `clamp()` against the live
 * viewport, so its pixels exist only after layout. The button is measured where it stands and stays
 * one node — the report reads it, it never wraps or remounts it. The rect is where the button is
 * placed, not how it is painted this instant: see `placedRect`.
 *
 * `indicator` draws a dot on the button's rim, INSIDE the one button: the dot is a child of the node the
 * pointer is already captured on, so showing and hiding it never remounts the FAB, and its press and its
 * drag are the button's. It means it is the reader's turn (an answer finished, or a run is waiting on them);
 * what that means in words is the owner's, which puts it into `label` — the label is also the tooltip, so
 * the reader who hovers the FAB is told what the dot is. The dot is decoration to a screen reader for that
 * reason, and paints in `surfaces.css`.
 *
 * One size, in `surfaces.css`: 28px drawn, docked or floating, inside a 44px round catch that is a
 * pseudo-element — so every rect this file reads is the circle the reader sees, and a press up to
 * 22px from its centre still starts a drag.
 *
 * The press is the CLICK, never the pointer release. On a touch screen the browser dispatches the
 * tap's click after the release, hit-tested at the finger's point in whatever is on screen by then —
 * and what this button opens is drawn over it. Opened on the release, the surface caught its own
 * opening tap: on its backdrop, which shut it again at once, or on an item inside it, which
 * pressed that item. So the release only records whether the gesture moved, and the click that ends a
 * drag is swallowed; every other click — a tap, a mouse click, Enter or Space — presses.
 *
 * `onPress` says HOW it was pressed: `keyboard` is true for a click with no pointer behind it
 * (`detail === 0`: Enter, Space, a screen reader), so an owner that opens a menu can move focus into it
 * for the reader who pressed with keys and leave it on the button for the one who tapped.
 * `onDragStart` fires once per drag, on the first move past the threshold, so an owner can put away
 * what the button opened before the button starts to move out from under it.
 *
 * The tooltip is the native `title`: the library `Tooltip` measures a wrapper element, and a
 * wrapper around a fixed node sits in the caller's flow at zero size, somewhere else entirely.
 */
export function DockableFab({
  label,
  icon,
  position,
  dockRect,
  active = false,
  indicator = false,
  onPress,
  onDragStart,
  onPositionChange,
  onRectChange,
}: DockableFabProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [heldPoint, setHeldPoint] = useState<FabPoint | null>(null);
  // Where the reader's finger landed, as an offset from the button's CENTRE. Without it the first
  // pixel of movement would teleport the button so that the pointer sat on its corner — half a circle
  // of jump. From the centre and not the corner because the centre is what the dock snap measures to
  // and what a docked FAB is placed on, and it is the one point the `:hover` and `:active` scales in
  // surfaces.css leave where it was — a press on the 44px catch lands up to 22px from it.
  const grab = useRef<FabPoint>({ x: 0, y: 0 });
  // Whether the last pointer gesture ended as a drag: its click, if the browser sends one, is not a press.
  const dragEnded = useRef(false);
  // Whether this gesture's start has been announced to `onDragStart`, so the first move says it and the
  // rest do not. Rearmed on every press; a ref because nothing draws from it.
  const dragAnnounced = useRef(false);

  // The top-left that keeps the grabbed point under the pointer, for whatever size the box is now.
  function heldFrom(x: number, y: number): FabPoint {
    const rect = buttonRef.current?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : FAB_SIZE_PX;
    const height = rect && rect.height > 0 ? rect.height : FAB_SIZE_PX;
    return clampToViewport(
      { x: x - grab.current.x - width / 2, y: y - grab.current.y - height / 2 },
      buttonRef.current,
    );
  }

  const drag = usePointerDrag({
    kind: 'fab',
    onMove: ({ x, y }) => {
      if (!dragAnnounced.current) {
        dragAnnounced.current = true;
        onDragStart?.();
      }
      setHeldPoint(heldFrom(x, y));
    },
    onEnd: ({ x, y, moved }) => {
      setHeldPoint(null);
      // The hook owns what counts as a drag, so this button and the click guard below can never
      // disagree about what the reader just did. A release that never moved presses through its click.
      dragEnded.current = moved;
      if (!moved) return;
      // The DROP point is the pointer, not the button's corner: that is what the reader aimed.
      if (overDock({ x, y }, dockRect)) {
        onPositionChange({ docked: true });
        return;
      }
      onPositionChange({ docked: false, ...heldFrom(x, y) });
    },
  });

  const docked = heldPoint === null && position.docked && dockRect !== null;

  // The latest `onRectChange`, so a caller that passes a new function every render never re-binds the
  // resize listener below or re-fires the report. A LAYOUT effect, declared BEFORE the one that
  // reports: effects run in declaration order, so the report of a commit reads this commit's callback.
  const rectListener = useRef(onRectChange);
  useLayoutEffect(() => {
    rectListener.current = onRectChange;
  });

  // Every input to `fabPlacement`, as numbers and booleans rather than the objects they arrive in:
  // an owner that builds `position` or `dockRect` fresh each render would otherwise report on every
  // render, and this list is what "the placement changed" means.
  const fixedX = position.docked ? null : position.x;
  const fixedY = position.docked ? null : position.y;
  const dockLeft = dockRect?.left;
  const dockTop = dockRect?.top;
  const dockWidth = dockRect?.width;
  const dockHeight = dockRect?.height;
  const heldX = heldPoint?.x;
  const heldY = heldPoint?.y;

  // The measured rect, after every placement — docked, floating, each move of a drag. A LAYOUT effect
  // so a drag's every move reports before the browser paints, and so the reader of the rect never
  // trails the button by a frame. The owner's own `left`/`top` cannot stand in for it: floating, the
  // position is a CSS `clamp()`, so the pixels the button lands on exist only once layout has run.
  useLayoutEffect(() => {
    if (buttonRef.current) rectListener.current?.(placedRect(buttonRef.current));
  }, [position.docked, fixedX, fixedY, dockLeft, dockTop, dockWidth, dockHeight, heldX, heldY]);

  // A window resize moves a floating button without any prop changing, for the same `clamp()`'s
  // reason, so it reports too. The FAB belongs to the opener's own window, never a picture-in-picture
  // one, so this is the global `window`. Bound once for the button's life; the callback is read
  // through the ref. Passive: nothing paints on a resize event that a layout effect would have to beat.
  useEffect(() => {
    function reportAfterResize() {
      if (buttonRef.current) rectListener.current?.(placedRect(buttonRef.current));
    }
    window.addEventListener('resize', reportAfterResize);
    return () => window.removeEventListener('resize', reportAfterResize);
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    // A touch drag sends no click, so the last drag's flag must not swallow this gesture's.
    dragEnded.current = false;
    dragAnnounced.current = false;
    // Measured off the live box rather than derived from the stored point: docked, the button is
    // centred on the dock and its top-left is nowhere near the x/y the record holds.
    const rect = buttonRef.current?.getBoundingClientRect();
    grab.current = rect
      ? { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) }
      : { x: 0, y: 0 };
    drag.onPointerDown(event);
  }

  function handleClickCapture(event: MouseEvent<HTMLButtonElement>) {
    // A pointer click that ends a drag would press the button the reader was only moving out of the
    // way. A click with no pointer behind it (`detail === 0`: Enter, Space, a screen reader) never
    // ends a drag, whatever the last gesture was.
    if (event.detail !== 0 && dragEnded.current) {
      dragEnded.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onPress({ keyboard: event.detail === 0 });
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      aria-expanded={active}
      title={label}
      onPointerDown={handlePointerDown}
      onClickCapture={handleClickCapture}
      style={fabPlacement(position, dockRect, heldPoint)}
      className={cn(
        'vv-fab inline-flex items-center justify-center',
        docked && 'vv-fab--docked',
        active && 'vv-fab--active',
      )}
    >
      <span aria-hidden="true" className="vv-fab__glyph inline-flex items-center justify-center">
        {icon}
      </span>
      {indicator && <span aria-hidden="true" className="vv-fab__dot" />}
    </button>
  );
}
