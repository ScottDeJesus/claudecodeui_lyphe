import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/**
 * How fast the view closes on the foot, as the rate of a critically damped spring (1/s). Chosen so
 * the foot of a typical reply block — 300 to 2600 px — is reached in about half a second (measured
 * 0.46 s to 0.57 s over that range): the view eases in, eases out, and never overshoots.
 */
const GLIDE_RATE_PER_SECOND = 18;
/** Within this distance of the foot, and slower than `SNAP_SPEED_PX_PER_S`, the glide lands on it exactly. */
const SNAP_DISTANCE_PX = 0.75;
const SNAP_SPEED_PX_PER_S = 40;
/** A frame the browser delayed (a throttled window) must not become one enormous step. */
const MAX_FRAME_SECONDS = 0.05;
/** How far a scroll position may differ from what the app last wrote and still be the app's own (sub-pixel rounding). */
const OWN_SCROLL_TOLERANCE_PX = 2;
/**
 * A move the app did not write, with no reader input just before it, is the browser adjusting the
 * view (scroll anchoring) when a row above it changed height: the glide absorbs it, up to this
 * size. A larger one is some other writer's, and the glide yields to it.
 */
const BROWSER_ADJUSTMENT_LIMIT_PX = 120;
/** How long after a key press a move of the view is still taken to be the reader's (keyboard scrolling animates). */
const READER_INTENT_MS = 600;

type Glide = {
  rafId: number;
  /** The window whose frames drive this glide, so it is cancelled on the window that issued it. */
  armedOn: Window;
  position: number;
  velocity: number;
  lastFrameAt: number;
};

type ScrollOrigin = 'own' | 'browser-adjustment' | 'reader';

type UseFollowGlideArgs = {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /**
   * Whether the app may move the view right now: the reader is looking at the session and is at its
   * foot, and no other writer (the open-session settle, a search jump, a page prepend) owns the
   * position. Asked when a growth is seen and again on every frame — a deferred scroll must re-read
   * its conditions when it fires.
   */
  canFollow: () => boolean;
};

type FollowGlide = {
  /** Stops a glide where the view stands. Every other writer of the scroll position calls it first. */
  stopGlide: () => void;
  /**
   * Whether the scroll event being handled is the app's own movement (a glide frame, or the browser
   * adjusting the view). The caller leaves `isUserScrolledUp` alone for it — a mid-glide gap is not the
   * reader scrolling up. An event that is the reader's stops the glide and answers false.
   */
  isOwnScroll: () => boolean;
};

/**
 * Makes the transcript follow its foot with a glide: whenever the content grows (a new row, a row that
 * grew in place, late rendering, the typing indicator, the activity padding) and `canFollow` says the
 * reader is at the foot of a session they are looking at, the view eases down to the LIVE foot —
 * the target is re-read every frame, so growth that continues is chased, not reached and left behind.
 *
 * The reader always wins. A vertical wheel, a touch that moves, a press on the scrollbar, or a key followed by a move of
 * the view stops the glide where it stands, and the scroll that follows is theirs to be read as such
 * by `handleScroll`. A reader who prefers reduced motion gets an instant follow.
 *
 * Called by `useChatSessionState`, which stays the scroll's one owner; the glide only writes when its
 * `canFollow` says nothing else does. Its frames, listeners and observer belong to the window the chat
 * is drawn in (`useHostWindow`).
 */
export function useFollowGlide({ scrollContainerRef, canFollow }: UseFollowGlideArgs): FollowGlide {
  const hostWindow = useHostWindow();
  // The latest `canFollow`, written in a layout effect: a frame reads it when it fires, and a render
  // React throws away must not leave its closure behind.
  const canFollowRef = useRef(canFollow);
  useLayoutEffect(() => {
    canFollowRef.current = canFollow;
  });

  // The glide in flight, if any. A ref: frames read and write it, nothing renders from it.
  const glideRef = useRef<Glide | null>(null);
  // Where the app last put the scroller, as read back from it. A scroll event at that position is the
  // app's; at any other, someone else moved the view. Null when the app has nothing in flight to claim.
  const ownTopRef = useRef<number | null>(null);
  const lastReaderInputRef = useRef(Number.NEGATIVE_INFINITY);

  const cancelFrame = useCallback(() => {
    const glide = glideRef.current;
    if (!glide) return;
    glide.armedOn.cancelAnimationFrame(glide.rafId);
    glideRef.current = null;
  }, []);

  const stopGlide = useCallback(() => {
    cancelFrame();
    ownTopRef.current = null;
  }, [cancelFrame]);

  const classifyScroll = useCallback((container: HTMLElement, now: number): ScrollOrigin => {
    const ownTop = ownTopRef.current;
    if (ownTop === null) return 'reader';
    const maxTop = container.scrollHeight - container.clientHeight;
    const drift = Math.abs(container.scrollTop - Math.min(ownTop, maxTop));
    if (drift <= OWN_SCROLL_TOLERANCE_PX) return 'own';
    const readerActedJustBefore = now - lastReaderInputRef.current <= READER_INTENT_MS;
    if (!readerActedJustBefore && drift <= BROWSER_ADJUSTMENT_LIMIT_PX) return 'browser-adjustment';
    return 'reader';
  }, []);

  // Named so each frame can ask for the next one.
  const step = useCallback(function glideFrame(now: number) {
    const glide = glideRef.current;
    const container = scrollContainerRef.current;
    if (!glide || !container) {
      glideRef.current = null;
      return;
    }
    if (!canFollowRef.current()) {
      // Ended, not stopped: the scroll event of the last write may still be in flight, and it must
      // still read as the app's own.
      glideRef.current = null;
      return;
    }

    const origin = classifyScroll(container, now);
    if (origin === 'reader') {
      stopGlide();
      return;
    }
    if (origin === 'browser-adjustment') glide.position = container.scrollTop;

    const target = container.scrollHeight - container.clientHeight;
    const elapsedSeconds = Math.min(Math.max((now - glide.lastFrameAt) / 1000, 0), MAX_FRAME_SECONDS);
    glide.lastFrameAt = now;

    // The exact solution of a critically damped spring over `elapsedSeconds`, so the motion does not
    // depend on the frame rate. `offset` is the distance from the foot (negative while above it).
    const offset = glide.position - target;
    const pull = glide.velocity + GLIDE_RATE_PER_SECOND * offset;
    const decay = Math.exp(-GLIDE_RATE_PER_SECOND * elapsedSeconds);
    const nextOffset = (offset + pull * elapsedSeconds) * decay;
    const nextVelocity = (glide.velocity - GLIDE_RATE_PER_SECOND * pull * elapsedSeconds) * decay;

    const arrived = Math.abs(nextOffset) < SNAP_DISTANCE_PX && Math.abs(nextVelocity) < SNAP_SPEED_PX_PER_S;
    // A foot that moved up under the view (content shrank) clamps the position to it.
    glide.position = arrived ? target : Math.min(target + nextOffset, target);
    glide.velocity = arrived ? 0 : nextVelocity;
    container.scrollTop = glide.position;
    ownTopRef.current = container.scrollTop;

    if (arrived) {
      glideRef.current = null;
      return;
    }
    glide.rafId = glide.armedOn.requestAnimationFrame(glideFrame);
  }, [classifyScroll, scrollContainerRef, stopGlide]);

  const followGrowth = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || glideRef.current || !canFollowRef.current()) return;
    const distance = container.scrollHeight - container.clientHeight - container.scrollTop;
    if (distance < SNAP_DISTANCE_PX) return;

    if (hostWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.scrollTop = container.scrollHeight;
      ownTopRef.current = container.scrollTop;
      return;
    }

    // Anything the app wrote before and never saw an event for is spent: the claim restarts here.
    ownTopRef.current = container.scrollTop;
    const glide: Glide = {
      rafId: 0,
      armedOn: hostWindow,
      position: container.scrollTop,
      velocity: 0,
      lastFrameAt: hostWindow.performance.now(),
    };
    glide.rafId = hostWindow.requestAnimationFrame(step);
    glideRef.current = glide;
  }, [hostWindow, scrollContainerRef, step]);

  const isOwnScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const origin = classifyScroll(container, hostWindow.performance.now());
    if (origin === 'reader') {
      stopGlide();
      return false;
    }
    const glide = glideRef.current;
    if (origin === 'browser-adjustment') {
      // Adopt the adjusted position as the new claim, so the next frame sees no drift.
      if (glide) glide.position = container.scrollTop;
      ownTopRef.current = container.scrollTop;
    } else if (!glide) {
      // The last write of a finished glide has now been heard; the claim on that position is spent.
      ownTopRef.current = null;
    }
    return true;
  }, [classifyScroll, hostWindow, scrollContainerRef, stopGlide]);

  // The observer, and the reader's inputs. The growth the glide follows is any change in the content's
  // size, which is why the content box is what is observed: the transcript's rows, its typing
  // indicator and the activity padding all sit inside it, and none of them fires a scroll event.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;
    const content = container.firstElementChild;

    // Built by the host window's own constructor, as the lazy-row observer is.
    const HostResizeObserver = (hostWindow as Window & typeof globalThis).ResizeObserver;
    const observer = new HostResizeObserver(followGrowth);
    if (content) observer.observe(content);

    const noteReaderInput = () => {
      lastReaderInputRef.current = hostWindow.performance.now();
    };
    const yieldToReader = () => {
      noteReaderInput();
      stopGlide();
    };
    // A sideways wheel (a swipe over a wide code block) moves nothing vertically: it is not the reader
    // leaving the foot, and stopping the glide for it would strand them mid-reply flagged as scrolled up.
    const yieldOnVerticalWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) yieldToReader();
    };
    // Only a press on the scroller itself — its scrollbar and padding — is a grab at the scroll;
    // a press on a row is a click on the content, which moves nothing.
    const yieldOnScrollbarPress = (event: Event) => {
      if (event.target === container) yieldToReader();
    };
    // A key only makes the move that follows it the reader's (the glide yields when it sees one);
    // typing in the composer moves nothing and must not stop a follow.
    const noteKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = Boolean(target)
        && (Boolean(target?.isContentEditable) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? ''));
      if (!isEditing) noteReaderInput();
    };

    // A touch is the reader's only once the finger MOVES: a tap on the transcript scrolls nothing.
    container.addEventListener('wheel', yieldOnVerticalWheel, { passive: true });
    container.addEventListener('touchmove', yieldToReader, { passive: true });
    container.addEventListener('pointerdown', yieldOnScrollbarPress, { passive: true });
    hostWindow.document.addEventListener('keydown', noteKey, true);

    return () => {
      observer.disconnect();
      container.removeEventListener('wheel', yieldOnVerticalWheel);
      container.removeEventListener('touchmove', yieldToReader);
      container.removeEventListener('pointerdown', yieldOnScrollbarPress);
      hostWindow.document.removeEventListener('keydown', noteKey, true);
      stopGlide();
    };
  }, [followGrowth, hostWindow, scrollContainerRef, stopGlide]);

  return { stopGlide, isOwnScroll };
}
