import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';

import {
  ZOOM_BUTTON_STEP,
  ZOOM_DOUBLE_TAP_RADIUS_PX,
  ZOOM_DOUBLE_TAP_SCALE,
  ZOOM_DOUBLE_TAP_WINDOW_MS,
  ZOOM_TAP_SLOP_PX,
} from '@/shared/constants';
import { isElementLike, wheelZoomRatio } from '@/shared/utils';

/** The zoom never goes below the fit: zooming out past it only shows backdrop. */
const MIN_ZOOM = 1;

/** 2.5 times the fit: enough to read a feature dot's neighbourhood on a phone. */
const MAX_ZOOM = 2.5;

type Point = { x: number; y: number };

/**
 * The drawing point a zoom holds still, and where on screen it must stand once the drawing is resized:
 * `u`, `v` are the point in drawing units (px at scale 1), `x`, `y` its wanted client position.
 */
type ZoomAnchor = { u: number; v: number; x: number; y: number };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function distance(from: Point, to: Point): number {
  return Math.hypot(from.x - to.x, from.y - to.y);
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

type TreeZoomInput = {
  /** The tree's own scroller; the gestures are heard on it and a zoom places its scroll. */
  paneRef: RefObject<HTMLDivElement>;
  /** The roadmap on screen: a switch to another one puts the zoom back at 1. */
  roadmapName: string;
  /** The scale the tree's fit computes (1, or the height fit clamped to [0.6, 1]); the zoom multiplies it. */
  fitScale: number;
};

/**
 * The tree's own zoom, as a factor the user sets over the fit: the drawing is drawn at
 * `fitScale × zoom` (the `scale` it returns), and `zoom` runs from 1 (the fit) to 2.5.
 *
 * - THE GESTURES, heard on the pane with native listeners: two-finger pinch (Pointer Events, a map of
 *   the fingers down by id; the zoom is the zoom when the second finger landed times the spread since, read
 *   from both fingers' current places once per animation frame, so a drag that holds the spread asks for no
 *   zoom, and a clamp keeps nothing of either finger's half-move), `ctrl`+wheel (a trackpad pinch arrives as one; read by the same
 *   `wheelZoomRatio` the Lightbox zooms by, and non-passive so the browser's own page zoom is stopped),
 *   and a double-tap or double-click on one node (or on empty drawing twice), which toggles between the fit and 2× (the click that ends it is
 *   swallowed: a touch screen aims it at the layout the zoom just made; the first tap's own click is not). A plain wheel is not heard: it
 *   scrolls the pane as it always did. A pinch that a finger leaves, and a press that travelled, is no tap.
 * - THE PINCH AGAINST THE SCROLL. The pane scrolls natively, and Chromium takes a two-finger gesture
 *   from the page (a `pointercancel` after about six moves) unless the pane's `touch-action` leaves
 *   the pinch out: the pane carries `pan-x pan-y`, which keeps both scroll axes and drops the browser's
 *   own pinch-zoom, so every move of both fingers arrives here. Measured on the live pane at 390×660:
 *   `manipulation` 6 moves then `pointercancel`, `pan-x pan-y` 24 of 24, and a `touchmove`
 *   `preventDefault` 24 of 24 as well; switching `touch-action` to `none` on the second `pointerdown`
 *   fails, because the browser reads it when the first touch starts. A finger already scrolling when
 *   the second lands is the browser's by then, and no variant that keeps the scroll takes it back.
 * - THE ANCHOR. Every zoom is one move: the drawing point under `from` (the pinch's midpoint, the wheel's
 *   cursor, the double-tap, or for a button the pane's visible centre) ends under `to` (the same point,
 *   or the pinch's new midpoint, so a drifting pinch pans as it zooms). The point is read off the svg's
 *   box before the zoom, the zoom is committed at once (`flushSync`, so the next event of a pinch reads
 *   a drawing already resized), and the pane is scrolled in the same commit, in a layout effect, so no
 *   frame draws the resized drawing at the old scroll. This hook owns the scroll of a zoom;
 *   `useTreePane`, called after it, holds the drawing's centre only across a scale change that is
 *   not a zoom (a resize).
 * - THE STATE. The zoom is per mounted tree, starts at 1, is not stored, and returns to 1 when the
 *   roadmap on screen changes.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, so the Roadmap tab, the chat gutter's widget and
 * the widget at full screen all zoom.
 */
export function useTreeZoom({ paneRef, roadmapName, fitScale }: TreeZoomInput) {
  // The user's zoom, for the roadmap it was made on. Not derivable: only a gesture or a button says it.
  // Kept beside its roadmap so a switch is caught while rendering, before anything is drawn at the old zoom.
  const [held, setHeld] = useState({ roadmapName, zoom: MIN_ZOOM });
  if (held.roadmapName !== roadmapName) setHeld({ roadmapName, zoom: MIN_ZOOM });
  const zoom = held.roadmapName === roadmapName ? held.zoom : MIN_ZOOM;
  const scale = fitScale * zoom;

  // What the native listeners read, as of the last commit: they are bound once and would read a stale render.
  const latest = useRef({ zoom, fitScale, roadmapName });
  // The anchor a zoom hands to the commit it causes, which places the pane and clears it. A ref: it is set and
  // consumed within one synchronous commit, and nothing is drawn from it.
  const pending = useRef<ZoomAnchor | null>(null);

  useLayoutEffect(() => {
    latest.current = { zoom, fitScale, roadmapName };
  });

  // Places the pane for the zoom this commit drew: the anchored drawing point is moved to where it was wanted.
  // Runs before `useTreePane`'s own scale effect (this hook is called first), whose hold of the centre skips a zoom.
  useLayoutEffect(() => {
    const anchor = pending.current;
    pending.current = null;
    const pane = paneRef.current;
    const svg = pane?.querySelector('svg');
    if (anchor === null || !pane || !svg) return;
    const drawn = svg.getBoundingClientRect();
    pane.scrollTo({
      left: pane.scrollLeft + drawn.left + anchor.u * scale - anchor.x,
      top: pane.scrollTop + drawn.top + anchor.v * scale - anchor.y,
      behavior: 'instant',
    });
  }, [held, paneRef, scale]);

  /** Sets the zoom to `wanted` (clamped), keeping the drawing point now under `from` under `to` once it is resized. */
  const zoomTo = useCallback((wanted: number, from: Point, to: Point) => {
    const svg = paneRef.current?.querySelector('svg');
    if (!svg) return;
    const { zoom: current, fitScale: fit, roadmapName: name } = latest.current;
    const next = clamp(wanted, MIN_ZOOM, MAX_ZOOM);
    if (next === current && from.x === to.x && from.y === to.y) return;
    const drawn = svg.getBoundingClientRect();
    const drawnAt = fit * current;
    pending.current = { u: (from.x - drawn.left) / drawnAt, v: (from.y - drawn.top) / drawnAt, x: to.x, y: to.y };
    flushSync(() => setHeld({ roadmapName: name, zoom: next }));
  }, [paneRef]);

  /** The pane's visible centre in client px: the pivot of a button, which zooms about nothing in particular. */
  const paneCentre = useCallback((): Point | null => {
    const pane = paneRef.current;
    if (pane === null) return null;
    const box = pane.getBoundingClientRect();
    return { x: box.left + pane.clientWidth / 2, y: box.top + pane.clientHeight / 2 };
  }, [paneRef]);

  const zoomIn = useCallback(() => {
    const centre = paneCentre();
    if (centre !== null) zoomTo(latest.current.zoom * ZOOM_BUTTON_STEP, centre, centre);
  }, [paneCentre, zoomTo]);

  const zoomOut = useCallback(() => {
    const centre = paneCentre();
    if (centre !== null) zoomTo(latest.current.zoom / ZOOM_BUTTON_STEP, centre, centre);
  }, [paneCentre, zoomTo]);

  const zoomToFit = useCallback(() => {
    const centre = paneCentre();
    if (centre !== null) zoomTo(MIN_ZOOM, centre, centre);
  }, [paneCentre, zoomTo]);

  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return undefined;

    // The fingers and pens down on the pane, by pointer id, at their last seen position. A mouse is never one:
    // its release can happen off the pane, and a stale entry would make the next finger read as a second.
    const fingers = new Map<number, Point>();
    // The pinch under way while exactly two fingers are down: the zoom and the spread at the moment the second
    // landed (its baseline), and the midpoint the drawing was last placed under. Null with any other number of fingers.
    let pinch: { zoom0: number; spread0: number; mid: Point } | null = null;
    // The animation frame a pinch's next application waits for, 0 while none does.
    let pinchFrame = 0;
    // The press that may still turn out a tap: it has not travelled past the slop, and no second finger joined it.
    // `key` is the node it went DOWN on (null: empty drawing), read at the press, not at the release.
    let press: { id: number; at: Point; moved: boolean; key: string | null } | null = null;
    // The last tap that was not a double-tap's second: when it ended, where, and the node it stood on (null: empty drawing).
    let lastTap: { at: number; x: number; y: number; key: string | null } = { at: 0, x: 0, y: 0, key: null };
    // Set by a double-tap that zoomed: the click that ends it must select nothing (see `handleClick`).
    let swallowClick = false;
    const frameWindow = pane.ownerDocument.defaultView ?? window;

    const twoFingers = (): [Point, Point] | null => {
      if (fingers.size !== 2) return null;
      const [first, second] = [...fingers.values()];
      return [first, second];
    };

    // Takes the baseline of a pinch from the two fingers as they stand now; with any other number there is none.
    const beginPinch = () => {
      const pair = twoFingers();
      const spread0 = pair === null ? 0 : distance(pair[0], pair[1]);
      pinch = pair === null || spread0 === 0 ? null : { zoom0: latest.current.zoom, spread0, mid: midpoint(pair[0], pair[1]) };
    };

    // Zooms to the baseline zoom times how far the fingers have spread since it, wherever they stand now, and moves
    // the drawing point that was under the midpoint to the new one. It reads the TWO FINGERS' CURRENT positions, never
    // one finger's move against the other's stale place, so a drag that holds the spread asks for no zoom at all.
    // Once per animation frame, the fingers' two moves of a frame landing together: one commit, not two.
    const applyPinch = () => {
      pinchFrame = 0;
      const pair = twoFingers();
      if (pinch === null || pair === null) return;
      const mid = midpoint(pair[0], pair[1]);
      zoomTo(pinch.zoom0 * (distance(pair[0], pair[1]) / pinch.spread0), pinch.mid, mid);
      pinch.mid = mid;
    };

    // Applies what the fingers last did now, if a frame is still owed it: before one lifts, so its last move counts.
    const flushPinch = () => {
      if (pinchFrame === 0) return;
      frameWindow.cancelAnimationFrame(pinchFrame);
      applyPinch();
    };

    const nodeKeyUnder = (target: EventTarget | null): string | null =>
      isElementLike(target) ? target.closest('[data-tree-key]')?.getAttribute('data-tree-key') ?? null : null;

    const handleWheel = (event: WheelEvent) => {
      // Only `ctrl`+wheel zooms (a trackpad pinch arrives as one). A plain wheel scrolls the pane.
      if (!event.ctrlKey) return;
      // Stops the browser zooming the whole page, which is what `ctrl`+wheel does by default.
      event.preventDefault();
      const at = { x: event.clientX, y: event.clientY };
      zoomTo(latest.current.zoom * wheelZoomRatio(event), at, at);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const at = { x: event.clientX, y: event.clientY };
      // A new press ends the hold on the last double-tap's click, which never came if that press was cancelled.
      swallowClick = false;
      if (event.pointerType !== 'mouse') fingers.set(event.pointerId, at);
      // A second finger makes the gesture a pinch, which is never a tap; a third, or none, leaves no pinch to read.
      press = fingers.size >= 2 ? null : { id: event.pointerId, at, moved: false, key: nodeKeyUnder(event.target) };
      beginPinch();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = { x: event.clientX, y: event.clientY };
      // Every move of a finger is kept, whoever else is down, so no finger's recorded place goes stale.
      if (fingers.has(event.pointerId)) {
        fingers.set(event.pointerId, current);
        if (pinch !== null && pinchFrame === 0) pinchFrame = frameWindow.requestAnimationFrame(applyPinch);
      }
      if (press !== null && press.id === event.pointerId && !press.moved && distance(press.at, current) >= ZOOM_TAP_SLOP_PX) {
        press.moved = true;
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      flushPinch();
      fingers.delete(event.pointerId);
      // A third finger lifting leaves two, which start a pinch afresh; one finger left, or none, leaves none.
      beginPinch();
      const ended = press;
      if (ended === null || ended.id !== event.pointerId) return;
      press = null;
      if (event.type === 'pointercancel' || ended.moved) return;

      // A tap. Two close together in time and place are a double-tap, on a mouse as well as a finger: read here,
      // not from `dblclick`, which a touch screen does not send.
      const at = { x: event.clientX, y: event.clientY };
      // Both on the same node, or both on empty drawing: two taps on neighbouring dots are two presses. Each tap's
      // node is the one it went down on: a mouse has no capture, so a press that wobbles over a rim would otherwise
      // be filed on whatever it was released over.
      const { key } = ended;
      const isDoubleTap = event.timeStamp - lastTap.at < ZOOM_DOUBLE_TAP_WINDOW_MS
        && distance(at, lastTap) < ZOOM_DOUBLE_TAP_RADIUS_PX
        && key === lastTap.key;
      if (!isDoubleTap) {
        lastTap = { at: event.timeStamp, ...at, key };
        return;
      }
      lastTap = { at: 0, x: 0, y: 0, key: null };
      swallowClick = true;
      const { zoom: current } = latest.current;
      zoomTo(current > MIN_ZOOM ? MIN_ZOOM : ZOOM_DOUBLE_TAP_SCALE, at, at);
    };

    // The click that ends a double-tap is not a press on the tree: the second press already zoomed. On a touch screen
    // the browser aims it AFTER the zoom, at the layout the zoom just made. Measured on the live tree, that click
    // lands on empty drawing or on the node the first tap already selected, so nothing a person sees changes
    // with it let through; it is held back so a press that zoomed never also selects whatever the new layout puts
    // under the finger. Heard in the capture phase, so it never reaches the svg's own press.
    const handleClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
    };

    // A window that loses focus mid-gesture (an alert, a tab switch) never sends the release.
    const handleBlur = () => {
      fingers.clear();
      press = null;
      pinch = null;
    };

    const hostWindow = pane.ownerDocument.defaultView;
    // Non-passive: a passive wheel listener cannot stop the page's own `ctrl`+wheel zoom.
    pane.addEventListener('wheel', handleWheel, { passive: false });
    pane.addEventListener('pointerdown', handlePointerDown);
    pane.addEventListener('pointermove', handlePointerMove);
    pane.addEventListener('pointerup', handlePointerEnd);
    pane.addEventListener('pointercancel', handlePointerEnd);
    pane.addEventListener('click', handleClick, true);
    hostWindow?.addEventListener('blur', handleBlur);
    return () => {
      pane.removeEventListener('wheel', handleWheel);
      pane.removeEventListener('pointerdown', handlePointerDown);
      pane.removeEventListener('pointermove', handlePointerMove);
      pane.removeEventListener('pointerup', handlePointerEnd);
      pane.removeEventListener('pointercancel', handlePointerEnd);
      pane.removeEventListener('click', handleClick, true);
      hostWindow?.removeEventListener('blur', handleBlur);
      if (pinchFrame !== 0) frameWindow.cancelAnimationFrame(pinchFrame);
    };
  }, [paneRef, zoomTo]);

  return {
    zoom,
    scale,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
    zoomIn,
    zoomOut,
    zoomToFit,
  };
}
