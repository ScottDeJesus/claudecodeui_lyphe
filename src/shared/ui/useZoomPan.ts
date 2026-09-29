import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';

/** Fit-to-screen is the floor: a viewer that zooms OUT past fit only shows more backdrop. */
const MIN_SCALE = 1;
/** Eight times fit: enough to read the smallest label of a large diagram on a laptop. */
const MAX_SCALE = 8;
/** What one press of `+` / `−` multiplies the scale by. */
const BUTTON_STEP = 1.5;
/** Where a double-click or double-tap lands when it zooms in. */
const DOUBLE_TAP_SCALE = 2;
/** How far a press may travel and still be a tap rather than a pan. */
const TAP_SLOP_PX = 6;
/** Two taps this close in time, and within DOUBLE_TAP_RADIUS_PX, are a double-tap. */
const DOUBLE_TAP_WINDOW_MS = 320;
const DOUBLE_TAP_RADIUS_PX = 32;
/** Exponential zoom rate per wheel-delta pixel: a 100px mouse-wheel notch is about 25%. */
const WHEEL_ZOOM_RATE = 0.0022;
/** A trackpad pinch arrives as `ctrl`+wheel with small deltas, so it needs a steeper rate. */
const PINCH_WHEEL_ZOOM_RATE = 0.01;
/**
 * The most a single `ctrl`+wheel event may zoom by, in delta pixels. A pinch sends many events of a
 * few pixels each, but a mouse-wheel notch with Ctrl held is one event of 100 or more — at the
 * pinch rate that is 2.7× per notch, two notches from the ceiling. Capped, it lands beside a plain notch.
 */
const PINCH_WHEEL_MAX_DELTA_PX = 25;
/** Firefox reports wheel deltas in lines; this converts them to the pixels the rates above expect. */
const LINE_DELTA_PX = 16;

/**
 * Where the content sits: `x`/`y` are the translation from the stage centre in CSS pixels, applied
 * BEFORE the scale, and `animated` says whether the change should ease (a button press) or land at
 * once (a wheel tick, a finger).
 */
type View = { scale: number; x: number; y: number; animated: boolean };

const FIT: View = { scale: 1, x: 0, y: 0, animated: false };

type Point = { x: number; y: number };

/** The stage centre: the pivot for a button press and for a pan, which zoom about nothing in particular. */
const CENTRE: Point = { x: 0, y: 0 };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Zoom and pan for the `Lightbox`: wheel and trackpad pinch (`ctrl`+wheel) about the cursor, two-finger
 * pinch, drag to pan, double-click or double-tap to toggle fit and 2×, and the three step functions
 * the buttons and keys call.
 *
 * Hand-rolled on Pointer Events rather than taken from a package: the whole model is one translate
 * and one scale about a fixed origin, mouse, touch and pen arrive through the same events, and a
 * library's wrapper elements would have re-laid-out the two contents this serves (a sized image, a
 * sized SVG card). What stays out of scope, on purpose: Safari's desktop trackpad pinch, which
 * arrives as its own non-standard `gesture*` events instead of `ctrl`+wheel.
 *
 * Lives beside its only consumer and out of the barrel, as `usePointerDrag` does.
 *
 * The transform is applied to `contentRef`'s element with the ORIGIN AT ITS CENTRE (the CSS default),
 * and `stageRef`'s element is the untransformed frame whose centre that origin is pinned to. Both are
 * measured on demand, never cached; a resize only has to re-clamp the view it leaves behind.
 */
export function useZoomPan() {
  const surfaceRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // The rendered view. State because the transform and the buttons' disabled ends must repaint; the
  // ref beside it is the same value for the window listeners, which are bound once and would
  // otherwise read a stale render.
  const [view, setView] = useState<View>(FIT);
  const viewRef = useRef<View>(FIT);

  // Every finger or button currently down on the surface, by pointer id, at its last seen position.
  const pointers = useRef(new Map<number, Point>());
  // `moved` is true once the gesture became a pan or a pinch — the overlay reads it to swallow the
  // click that follows a drag. `lastTap` feeds the double-tap test.
  const gesture = useRef({ moved: false, startX: 0, startY: 0, lastTapAt: 0, lastTapX: 0, lastTapY: 0 });

  const commit = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
  }, []);

  /** A client-space point as an offset from the stage centre, which is where the scale is anchored. */
  const toStagePoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  }, []);

  /**
   * Multiplies the scale by `ratio` keeping the content under `pivot` still, then shifts by
   * (`shiftX`, `shiftY`). Every gesture is this one move: a wheel tick is a ratio about the cursor, a
   * pan is a shift with ratio 1, a pinch is both, a button is a ratio about the centre.
   *
   * The result is clamped so the content never leaves empty backdrop on an axis where it is larger
   * than the stage, and centres on an axis where it is not.
   */
  const transform = useCallback((ratio: number, pivot: Point, shiftX: number, shiftY: number, animated: boolean) => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const current = viewRef.current;
    const scale = clamp(current.scale * ratio, MIN_SCALE, MAX_SCALE);
    const effectiveRatio = scale / current.scale;
    const overflowX = Math.max(0, (content.offsetWidth * scale - stage.clientWidth) / 2);
    const overflowY = Math.max(0, (content.offsetHeight * scale - stage.clientHeight) / 2);
    const next = {
      scale,
      x: clamp(pivot.x - (pivot.x - current.x) * effectiveRatio + shiftX, -overflowX, overflowX),
      y: clamp(pivot.y - (pivot.y - current.y) * effectiveRatio + shiftY, -overflowY, overflowY),
      animated,
    };
    // A drag pushed against the clamp, or a resize that left the view where it was, changes nothing.
    if (next.scale === current.scale && next.x === current.x && next.y === current.y && next.animated === current.animated) return;
    commit(next);
  }, [commit]);

  const zoomIn = useCallback(() => transform(BUTTON_STEP, CENTRE, 0, 0, true), [transform]);
  const zoomOut = useCallback(() => transform(1 / BUTTON_STEP, CENTRE, 0, 0, true), [transform]);
  const fit = useCallback(() => commit({ ...FIT, animated: true }), [commit]);

  // A resize or a phone turned on its side moves the clamp under a view that was legal a moment
  // ago: without this the content sits off its edge, with a band of empty backdrop, until the next
  // gesture snaps it back. Both boxes are watched because the content is sized in viewport units.
  // The re-clamp is a move by nothing, so it cannot feed back into the sizes it reacts to.
  useEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return undefined;
    const observer = new ResizeObserver(() => transform(1, CENTRE, 0, 0, false));
    observer.observe(stage);
    observer.observe(content);
    return () => observer.disconnect();
  }, [transform]);

  // Wheel and trackpad pinch. Bound natively and NON-passive: React's own `onWheel` is passive, and a
  // passive listener cannot stop the page from scrolling or the browser from zooming the whole page
  // on `ctrl`+wheel — the exact thing a pinch is.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const deltaPx = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_DELTA_PX : 1);
      const zoomPx = event.ctrlKey ? clamp(deltaPx, -PINCH_WHEEL_MAX_DELTA_PX, PINCH_WHEEL_MAX_DELTA_PX) : deltaPx;
      const rate = event.ctrlKey ? PINCH_WHEEL_ZOOM_RATE : WHEEL_ZOOM_RATE;
      transform(Math.exp(-zoomPx * rate), toStagePoint(event.clientX, event.clientY), 0, 0, false);
    };
    surface.addEventListener('wheel', handleWheel, { passive: false });
    return () => surface.removeEventListener('wheel', handleWheel);
  }, [transform, toStagePoint]);

  // Pointer moves and releases are heard on the window, never on the element with pointer capture:
  // capture retargets the `click` that ends a press to the capturing element, and the overlay needs
  // the click's real target to tell the backdrop from the content. The window still hears a drag
  // that leaves the browser, and a touch's implicit capture keeps its events flowing.
  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;
      const current = { x: event.clientX, y: event.clientY };
      const state = gesture.current;

      if (pointers.current.size === 1) {
        // Below the slop the press is still a tap; `previous` stays the press point, so the first pan
        // step after the slop is measured from where the finger came down and nothing lurches.
        if (!state.moved && Math.hypot(current.x - state.startX, current.y - state.startY) < TAP_SLOP_PX) return;
        state.moved = true;
        pointers.current.set(event.pointerId, current);
        transform(1, CENTRE, current.x - previous.x, current.y - previous.y, false);
        return;
      }

      // Two fingers (a third is ignored): the scale follows the spread between them, and the content
      // follows the midpoint, so a pinch that also drifts pans as it zooms.
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (!other) return;
      const previousSpread = Math.hypot(previous.x - other.x, previous.y - other.y);
      const currentSpread = Math.hypot(current.x - other.x, current.y - other.y);
      const previousMid = toStagePoint((previous.x + other.x) / 2, (previous.y + other.y) / 2);
      const currentMid = toStagePoint((current.x + other.x) / 2, (current.y + other.y) / 2);
      pointers.current.set(event.pointerId, current);
      state.moved = true;
      if (previousSpread === 0) return;
      transform(currentSpread / previousSpread, previousMid, currentMid.x - previousMid.x, currentMid.y - previousMid.y, false);
    };

    const handleRelease = (event: PointerEvent) => {
      if (!pointers.current.delete(event.pointerId)) return;
      const state = gesture.current;
      // A finger lifted from a pinch leaves the other one to carry on as a pan from where it stands.
      if (pointers.current.size > 0) {
        state.moved = true;
        return;
      }
      if (event.type === 'pointercancel' || state.moved) return;

      // A tap. Two of them close together in time and place are a double-tap, on a mouse as well as
      // a finger: detected here rather than from `dblclick`, which a touch screen does not send.
      const isDoubleTap = event.timeStamp - state.lastTapAt < DOUBLE_TAP_WINDOW_MS
        && Math.hypot(event.clientX - state.lastTapX, event.clientY - state.lastTapY) < DOUBLE_TAP_RADIUS_PX;
      if (!isDoubleTap) {
        state.lastTapAt = event.timeStamp;
        state.lastTapX = event.clientX;
        state.lastTapY = event.clientY;
        return;
      }
      state.lastTapAt = 0;
      if (viewRef.current.scale > MIN_SCALE) {
        commit({ ...FIT, animated: true });
      } else {
        transform(DOUBLE_TAP_SCALE / viewRef.current.scale, toStagePoint(event.clientX, event.clientY), 0, 0, true);
      }
    };

    // A window that loses focus mid-gesture (an alert, a tab switch) never sends the release.
    const handleBlur = () => pointers.current.clear();

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleRelease);
    window.addEventListener('pointercancel', handleRelease);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleRelease);
      window.removeEventListener('pointercancel', handleRelease);
      window.removeEventListener('blur', handleBlur);
    };
  }, [transform, toStagePoint, commit]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Only the primary button pans; a right-click opens the browser's menu and sends no release.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const state = gesture.current;
    if (pointers.current.size === 0) {
      state.moved = false;
      state.startX = event.clientX;
      state.startY = event.clientY;
    } else {
      // A second finger makes the press a pinch, which is never a tap and never a click.
      state.moved = true;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }, []);

  /** True when the press that is ending was a pan or pinch, so the overlay must not treat its click as "close". */
  const wasDrag = useCallback(() => gesture.current.moved, []);

  return {
    surfaceRef,
    stageRef,
    contentRef,
    scale: view.scale,
    x: view.x,
    y: view.y,
    animated: view.animated,
    canZoomIn: view.scale < MAX_SCALE,
    canZoomOut: view.scale > MIN_SCALE,
    onPointerDown,
    wasDrag,
    zoomIn,
    zoomOut,
    fit,
  };
}
