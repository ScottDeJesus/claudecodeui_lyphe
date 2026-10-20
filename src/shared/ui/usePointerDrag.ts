import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react';

import { followTouch, holdScrollersStill } from '@/shared/ui/sortable/touchCarry';

/** The five gestures this hook serves, and the two body classes a drag of any one sets. */
export type PointerDragKind = 'fab' | 'split' | 'resize' | 'sort' | 'draw';

/** Where a drag is, and how far it has come: absolute client coordinates plus the delta from the press. */
export type PointerDragPoint = { x: number; y: number; dx: number; dy: number };

/** How far the pointer must travel before the gesture is a drag rather than a press. */
const DRAG_THRESHOLD_PX = 4;

/** How far a finger may drift during a hold and still be holding. Past it the touch is a scroll, and the hold is let go. */
const HOLD_SLOP_PX = 8;

/** What a handle wears from the first touch: `data-hold-lift`, a lifting handle (`surfaces.css` keeps the platform's own long-press off it). */
export type HoldLiftProps = { 'data-hold-lift'?: '' };

const HOLD_LIFT_PROPS: HoldLiftProps = { 'data-hold-lift': '' };
const NO_HOLD_LIFT_PROPS: HoldLiftProps = {};

/** One gesture, from the press that began it to the release that ends it. */
type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  /** The element holding the pointer's capture, once it is held. */
  captured: Element | null;
  /** The pending lift of a touch hold, until it fires or the gesture ends. */
  holdTimer: ReturnType<typeof setTimeout> | null;
  /** Gives back the scrollers a touch hold's lift held still (`holdScrollersStill`); null until a touch lifts. Its presence IS "lifted by touch". */
  thaw: (() => void) | null;
  /** Stops following the finger by its touch events (`followTouch`); null until the browser takes the pointer away from a lifted touch. */
  unfollow: (() => void) | null;
};

/**
 * The kit's one pointer-drag mechanism: what `DockableFab`'s drag, `SplitPane`'s seam, `ResizeGrip`'s
 * corner, the sortable lists' carry (`sortable/useSortable.ts`) and `RegionImage`'s drawn box
 * (`RegionDrawLayer`) all run on.
 *
 * It lives here, beside its only five consumers, and it is deliberately NOT in the barrel: what
 * `src/shared/ui/index.ts` re-exports is components, and it is not one. It is also deliberately not in
 * `src/shared/hooks/`: this repo's frontend standard sends a hook that multiple FEATURE modules use
 * there, and this one has none. What binds it to the kit is direction — it writes `vv-dragging` and
 * `vv-drag-<kind>`, class names whose only meaning is in `src/shared/ui/verve/surfaces.css`, and its
 * `PointerDragKind` names the kit's own gestures. Moving it up would point the kit's own mechanism out
 * of the kit and back down at its own stylesheet.
 *
 * The body class is the whole reason this hook exists. A drag that begins on a handle and continues
 * over a cross-origin iframe dies there: the frame swallows the pointer events and the drag stops
 * mid-flight in the reader's hand. `body.vv-dragging iframe { pointer-events: none }` is the cure, and
 * it must be a CLASS on the body rather than an inline style write on those frames — React owns them
 * and would undo it on the next render.
 *
 * The release is bound to `pointerup` and `pointercancel` in the CAPTURE phase, never on the bubble,
 * so the frames regain their hit-testing before any of the application's own handlers run against an
 * app with most of it unclickable.
 *
 * THREE OPTIONS SERVE A HANDLE THAT IS A WHOLE CARD, not a grip, and each is absent for the other
 * consumers, which behave exactly as before:
 *
 * - `accept` looks at a press BEFORE anything is armed and may refuse it: a card is full of buttons,
 *   inputs and scrolling tracks, and a press that began on one of those must stay the page's own —
 *   no listener, no capture, no class on the body.
 * - `captureOnStart` moves the pointer's capture from the press to the moment the drag begins, and
 *   onto an element of the caller's choosing. A pointer captured at the press re-targets the click
 *   that follows it, and a card's own buttons would never hear one; and a handle that a live
 *   reorder moves in the DOM drops its capture, where the list around it does not.
 * - `holdMs` is the touch gesture: a finger does not drag on contact, because the same finger is
 *   how the pane scrolls. The drag begins (`onStart`) once the finger has held still for `holdMs`;
 *   a finger that travels more than `HOLD_SLOP_PX` first is SCROLLING, and the gesture lets go
 *   silently: that swipe is the browser's own scroll and glide, which the handle never refuses
 *   (it is not `touch-action: none`). A mouse or a pen ignores `holdMs` and begins at `threshold` as ever.
 *   While a hold is pending or lifted the browser's own long-press reactions (a text selection, a context
 *   menu) are cancelled.
 *
 * A TOUCH CARRY SURVIVES THE BROWSER'S PAN (`sortable/touchCarry.ts`). A phone may dispatch every touch as
 * uncancelable, so once a row has lifted nothing the page does can stop the browser panning under the
 * finger — and a pan takes the pointer away (`pointercancel`). So at the lift the scrollers around the
 * press are held still (`holdScrollersStill`: the pan has nothing to move; the carry's edge-scroll still
 * moves the pane by script), and a `pointercancel` that arrives while a touch carry is lifted does not
 * end it: the carry follows the same finger on its touch events (`followTouch`) and ends on `touchend`
 * (a drop) or `touchcancel` (a cancel). Both come off on every exit, the unmount included.
 *
 * A HOLD'S HANDLE IS MARKED, because those cancels are events and not every platform sends the event.
 * An iPhone answers its own long-press (the link menu, the selection loupe) at about half a second
 * without a `contextmenu`, and takes the touch away, a moment after the hold here lifts: the carry
 * survived only for a finger that moved inside that gap. The platform decides on the menu and the
 * selection when a touch BEGINS, so a style applied at the lift is too late; the handle carries
 * `data-hold-lift` from the start (`handleProps`, spread on the handle by whoever owns it), and
 * `surfaces.css` turns the callout and the selection off under it on a touch screen.
 */
export function usePointerDrag(options: {
  kind: PointerDragKind;
  threshold?: number;                                   // default 4 (px)
  holdMs?: number;                                      // touch only: lift after this long without moving
  accept?: (event: ReactPointerEvent<HTMLElement>) => boolean;
  captureOnStart?: (handle: Element) => Element;
  onStart?: (point: PointerDragPoint) => void;          // the drag has begun: threshold crossed, or touch lifted
  onMove: (point: PointerDragPoint) => void;
  onEnd: (point: PointerDragPoint & { moved: boolean; cancelled: boolean }) => void;  // `cancelled`: the browser took the gesture away
}): { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void; handleProps: HoldLiftProps } {
  const { kind, threshold = DRAG_THRESHOLD_PX } = options;

  // The live gesture, and how to take its listeners back off. Refs, not state: a drag that
  // re-rendered its own component on every pointermove would be a render loop dressed as a drag.
  const gesture = useRef<Gesture | null>(null);
  const detach = useRef<(() => void) | null>(null);

  // The latest callbacks, read when the pointer moves rather than when the press happened: the
  // listeners are bound once per gesture, and a reader whose drag makes the component re-render must
  // still reach the handler of the render that is current. Written in an effect, never during render:
  // a render React discards takes no write back with it, and the live gesture would be left holding a
  // dead render's callbacks.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  /**
   * Ends the gesture — from a release, or from the cleanup of an unmount that cut one short.
   *
   * Every line is load-bearing for one failure: a drag that ends without this leaves `vv-dragging` on
   * the body, and while that class stands, every iframe in the application is `pointer-events: none`.
   * The reader's panes go deaf for the rest of the session. The same goes for the scrollers a touch lift
   * held still: a carry that ends without giving them back leaves the list unscrollable.
   *
   * Called with no `ending` from the unmount path and from a touch hold that turned out to be a scroll,
   * because there is no release point to report and a position written by a component being torn
   * down is a position nobody owns.
   */
  const release = useCallback((ending?: { x: number; y: number; cancelled: boolean }) => {
    const active = gesture.current;
    const off = detach.current;
    gesture.current = null;
    detach.current = null;
    off?.();
    if (!active) return;
    if (active.holdTimer !== null) clearTimeout(active.holdTimer);
    active.unfollow?.();
    active.thaw?.();

    // The capture goes back before anything else reads the pointer: it is what routed every move
    // here, and a handle that keeps it keeps the pointer with it.
    if (active.captured !== null && active.captured.hasPointerCapture(active.pointerId)) {
      active.captured.releasePointerCapture(active.pointerId);
    }

    // Both classes, always. They are added as a pair and this is the only place either comes off.
    document.body.classList.remove('vv-dragging', `vv-drag-${kind}`);

    if (!ending) return;
    // A gesture the browser took away is not a press. A cancelled tap that never moved must reach no
    // consumer, or a touch long-press that raises a context menu opens what the FAB opens.
    if (!active.moved && ending.cancelled) return;
    // A cancel does not reliably carry coordinates — Chrome can deliver it at 0,0 — and this point is
    // what the owner PERSISTS, so a cancel commits the last point the drag actually reached instead of
    // teleporting the element to the corner it was never dragged to. `cancelled` is passed on for an
    // owner that would rather not commit at all: a lifted card the browser took away is put back.
    const x = ending.cancelled ? active.lastX : ending.x;
    const y = ending.cancelled ? active.lastY : ending.y;
    latest.current.onEnd({
      x,
      y,
      dx: x - active.startX,
      dy: y - active.startY,
      moved: active.moved,
      cancelled: ending.cancelled,
    });
  }, [kind]);

  // The unmount is a release too: a sidebar collapsing, a pane closing, a route changing all tear a
  // handle down mid-drag, and each one of them would otherwise leave the class, the listeners and the
  // capture behind — the state in which the whole application stops taking clicks.
  useEffect(() => () => release(), [release]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // The primary button only; every other one belongs to the browser's own menu.
    if (event.button !== 0 || gesture.current) return;
    // A press `accept` refuses is the page's own: no listener, no capture, and a swipe from it is the browser's.
    if (latest.current.accept?.(event) === false) return;
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const holdMs = event.pointerType === 'touch' ? latest.current.holdMs : undefined;
    // The element the touch started on, which every one of its touch events will target (`followTouch`).
    const pressed = event.target instanceof Element ? event.target : handle;

    const active: Gesture = {
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      captured: null,
      holdTimer: null,
      thaw: null,
      unfollow: null,
    };

    // The capture is what keeps a fast drag alive. Without it the moves stop arriving at the handle
    // the moment the pointer outruns it, and the element is dropped in mid-air.
    function capture() {
      const target = latest.current.captureOnStart?.(handle) ?? handle;
      try {
        target.setPointerCapture(pointerId);
        active.captured = target;
      } catch {
        // The pointer was already gone — a press whose release arrived first. The gesture still runs;
        // it simply takes its moves from the window listener instead of from the capture.
      }
    }
    if (latest.current.captureOnStart === undefined) capture();

    // The drag begins: from the first move past the threshold, or from a touch hold's lift.
    function begin(x: number, y: number) {
      active.moved = true;
      document.body.classList.add('vv-dragging', `vv-drag-${kind}`);
      if (latest.current.captureOnStart !== undefined) capture();
      latest.current.onStart?.({ x, y, dx: x - active.startX, dy: y - active.startY });
    }

    /** The drag is at (`x`, `y`): from a pointer move, or from the finger's touch events once the browser has taken the pointer. */
    function follow(x: number, y: number) {
      active.lastX = x;
      active.lastY = y;
      latest.current.onMove({ x, y, dx: x - active.startX, dy: y - active.startY });
    }

    gesture.current = active;

    function handleMove(moveEvent: PointerEvent) {
      if (gesture.current !== active || moveEvent.pointerId !== active.pointerId) return;

      if (!active.moved) {
        const travelled = Math.hypot(moveEvent.clientX - active.startX, moveEvent.clientY - active.startY);
        // A finger that travels while the hold is still pending is SCROLLING the pane: the gesture is
        // let go, and the browser's own pan carries on untouched.
        if (active.holdTimer !== null) {
          if (travelled <= HOLD_SLOP_PX) return;
          release();
          return;
        }
        // A press that has not travelled is still a press. It is a click, and the thing it opens is
        // not traded away for a drag that began with the reader's hand trembling.
        if (travelled < threshold) return;
        begin(moveEvent.clientX, moveEvent.clientY);
      }

      follow(moveEvent.clientX, moveEvent.clientY);
    }

    // The release is `pointerup`, or `pointercancel` — except that the browser's pan takes a LIFTED touch's
    // pointer away without the finger lifting, and a carry does not end for that: it follows the finger on.
    function handleEnd(endEvent: PointerEvent) {
      // A release that belongs to another pointer — a second finger on a phone, another device — ends
      // nothing. The listener is on the window, so it hears every one of them.
      if (gesture.current !== active || endEvent.pointerId !== active.pointerId) return;
      const cancelled = endEvent.type === 'pointercancel';
      if (cancelled && active.thaw !== null && active.unfollow === null) {
        active.unfollow = followTouch(pressed, { x: active.lastX, y: active.lastY }, {
          move: follow,
          end: (x, y) => release({ x, y, cancelled: false }),
          cancel: () => release({ x: active.lastX, y: active.lastY, cancelled: true }),
        });
        return;
      }
      release({ x: endEvent.clientX, y: endEvent.clientY, cancelled });
    }

    // The long press of a touch: the browser would answer it with a text selection or a menu.
    const cancelNative = (nativeEvent: Event) => nativeEvent.preventDefault();
    if (holdMs !== undefined) {
      document.addEventListener('contextmenu', cancelNative, true);
      document.addEventListener('selectstart', cancelNative, true);
      active.holdTimer = setTimeout(() => {
        active.holdTimer = null;
        if (gesture.current !== active) return;
        begin(active.lastX, active.lastY);
        // After `onStart`, never before: the owner finds its pane by its `overflow` there, and a held pane reads as none.
        active.thaw = holdScrollersStill(pressed, handle);
      }, holdMs);
    }

    window.addEventListener('pointermove', handleMove);
    // Positional `true`, never an options object: the capture phase is a fact this file must be
    // readable for, and an object would hide it behind `capture: true` in a shape a reader has to
    // unroll to check.
    window.addEventListener('pointerup', handleEnd, true);
    window.addEventListener('pointercancel', handleEnd, true);
    detach.current = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd, true);
      window.removeEventListener('pointercancel', handleEnd, true);
      document.removeEventListener('contextmenu', cancelNative, true);
      document.removeEventListener('selectstart', cancelNative, true);
    };
  }, [kind, release, threshold]);

  return { onPointerDown, handleProps: options.holdMs === undefined ? NO_HOLD_LIFT_PROPS : HOLD_LIFT_PROPS };
}
