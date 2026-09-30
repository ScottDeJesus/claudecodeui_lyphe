import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent, TouchEvent, WheelEvent } from 'react';

/** How far in from either edge the fade reaches, and the clearance a revealed node keeps from it. */
const FADE_PX = 28;

/**
 * The sideways scroll of a `StatusFlow`'s track — the three things a track that can be wider than
 * its row has to do for itself, and that the browser does not:
 *
 * IT OPENS ON THE NODE THAT MATTERS, AND STAYS ON IT UNTIL THE READER TAKES THE TRACK. Whenever the
 * track has something to scroll and the reader has not touched it, `current` is centred, instantly,
 * before the paint — a plan of twenty-three phases opens on the phase in hand rather than on phase 1,
 * a phone turned upright re-opens on it, and a phase landing on a live plan carries an untouched track
 * along with the walk. It is centred again on every resize rather than once: a resizing row passes
 * through a layout wider than the one it settles on, and a one-shot centring against that would leave
 * the walking phase off the edge of a phone. THE READER TAKES THE TRACK BY MOVING IT, not by passing
 * over it: a swipe along the row, a sideways wheel (or shift+wheel), a mouse press on it, a key on a
 * node, keyboard focus on a node, or a node it is asked to keep in view hand it to the reader — a thumb
 * dragging the page over a 44px row, or a vertical wheel going by under the cursor, do not. From then on
 * it is never moved on its own again, until the row is gone (a plan that lost all its phases) and comes
 * back as a new track for a new reader.
 *
 * IT KEEPS THE SELECTED NODE IN VIEW. A node the reader's selection has moved to (a press, or the arc's
 * strip paged to its card) or that the KEYBOARD has focused is brought in — just far enough that it
 * clears the fade, and smoothly — so the flow follows the card in view instead of standing on a node
 * that scrolled off its edge. A node focused by a mouse press is NOT: `StatusFlow` reveals on
 * keyboard focus only, because a smooth scroll begun at mousedown moves the node out from under the
 * pointer before mouseup and the press is lost.
 *
 * IT SAYS WHICH SIDE HAS MORE. `--fade-before` and `--fade-after` are how much of an edge fade to
 * paint, growing from nothing with the distance scrolled (so the fade never pops on at the first
 * pixel) up to `FADE_PX`. They are written straight onto the element, not held as state: they are a
 * pure reading of the scroll offsets, and a state here would re-render every node on every frame of
 * a swipe.
 *
 * IT KEEPS ITS SWIPES, WHILE IT HAS ONE TO KEEP. A track's own swipe stops at its ends
 * (`overscroll-behavior-x: contain`) instead of carrying on into the arc's card strip or the page —
 * and only while the row overflows, because a contained scroller with nothing to scroll swallows a
 * swipe that belongs to the strip.
 *
 * ONLY THE TRACK EVER MOVES. Every scroll here is `scrollTo` on the track itself, never
 * `scrollIntoView`, which would also scroll the page and an arc's card strip around it.
 *
 * `hasNodes` is when the track exists (a plan with no phases cut draws none), so the observer is
 * attached the moment it does. Used by `StatusFlow`, the one track a dispatcher card draws.
 */
export function useFlowTrack({
  hasNodes,
  current,
  selected,
}: {
  hasNodes: boolean;
  /** The key of the node the track opens on. */
  current: string | null;
  /** The key of the node held selected, which is kept in view. */
  selected: string | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // The node buttons by key: where a node sits is read off them, and `StatusFlow` moves focus between
  // them for its roving tab stop. A ref: it paints nothing.
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // Whether the reader has taken the track in hand — from then on nothing but the reader moves it.
  // A ref: it paints nothing.
  const taken = useRef(false);
  // Where the touch now on the track began, to tell a swipe ALONG the row from a thumb going by on its
  // way to scroll the page. A ref: it paints nothing.
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  // The selected node the track was last asked to keep in view, so only a CHANGE of it moves the track.
  const shown = useRef(selected);

  /** Everything the track's scroll offsets and width say about how it is drawn: the fade, and the hold on swipes. */
  const paintTrack = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    // A swipe that reaches the track's end must not carry on into the arc's strip or the page behind
    // it (`contain`) — but only while the row HAS a scroll to hold. A scroll container with nothing to
    // scroll still swallows a swipe that starts on it when it is `contain`ed (measured, 2026-09-29:
    // a flow that fit its row was a dead patch in the middle of the strip), so a fitting row lets its
    // swipes through to whatever does scroll.
    track.style.overscrollBehaviorX = track.scrollWidth > track.clientWidth + 1 ? 'contain' : 'auto';
    const before = Math.min(track.scrollLeft, FADE_PX);
    const after = Math.min(track.scrollWidth - track.clientWidth - track.scrollLeft, FADE_PX);
    // Under a pixel is the scroll's own rounding at an end, not more track to see.
    track.style.setProperty('--fade-before', `${before < 1 ? 0 : before}px`);
    track.style.setProperty('--fade-after', `${after < 1 ? 0 : after}px`);
  }, []);

  /** Where node `key` sits in the track's own scroll coordinates, or null while it is not drawn. */
  const spanOf = useCallback((track: HTMLElement, key: string) => {
    const node = buttons.current.get(key);
    if (!node) return null;
    const left = node.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
    return { left, right: left + node.offsetWidth };
  }, []);

  /** Bring node `key` into view, clear of the fades, moving only when it is not already. */
  const reveal = useCallback((key: string) => {
    const track = trackRef.current;
    const span = track ? spanOf(track, key) : null;
    if (!track || !span) return;
    taken.current = true;
    let left = track.scrollLeft;
    if (span.left - FADE_PX < left) left = span.left - FADE_PX;
    else if (span.right + FADE_PX > left + track.clientWidth) left = span.right + FADE_PX - track.clientWidth;
    if (left === track.scrollLeft) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  }, [spanOf]);

  // Layout, not a passive effect: the opening scroll has to land before the first paint. The observer
  // watches the track's own box (a rotated phone, a dragged pane, a tab shown for the first time) and
  // the row inside it (a plan whose phases were cut after the card mounted).
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!hasNodes || !track) {
      // No track to hold: whoever reads the next one is a new reader of a new element.
      taken.current = false;
      return undefined;
    }
    const settle = () => {
      // A pixel of slack: fractional widths on a zoomed page make a row that fits read as wider by a hair.
      if (!taken.current && track.clientWidth > 0 && track.scrollWidth > track.clientWidth + 1) {
        const span = current === null ? null : spanOf(track, current);
        if (span) track.scrollTo({ left: (span.left + span.right - track.clientWidth) / 2, behavior: 'auto' });
      }
      paintTrack();
    };
    settle();
    const observer = new ResizeObserver(settle);
    observer.observe(track);
    if (track.firstElementChild) observer.observe(track.firstElementChild);
    return () => observer.disconnect();
  }, [hasNodes, current, spanOf, paintTrack]);

  useEffect(() => {
    if (selected === shown.current) return;
    shown.current = selected;
    if (selected !== null) reveal(selected);
  }, [selected, reveal]);

  /** A key pressed on a node: the reader is walking the track. */
  const takeTrack = useCallback(() => {
    taken.current = true;
  }, []);

  /** Only a press that is not a touch: a touch is judged by the direction it moves (`onTouchMove`). */
  const onPointerDown = useCallback((event: PointerEvent) => {
    if (event.pointerType !== 'touch') taken.current = true;
  }, []);

  const onTouchStart = useCallback((event: TouchEvent) => {
    const touch = event.touches[0];
    touchOrigin.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }, []);

  /** A touch that has moved mostly SIDEWAYS is a swipe along the row; the slop keeps a tap's jitter out. */
  const onTouchMove = useCallback((event: TouchEvent) => {
    const origin = touchOrigin.current;
    const touch = event.touches[0];
    if (!origin || !touch) return;
    const across = Math.abs(touch.clientX - origin.x);
    if (across > 6 && across > Math.abs(touch.clientY - origin.y)) {
      taken.current = true;
      touchOrigin.current = null;
    }
  }, []);

  /** A wheel that moves ALONG the row: a trackpad's sideways drag, or shift+wheel. A vertical one is the page's. */
  const onWheel = useCallback((event: WheelEvent) => {
    if (event.deltaX !== 0 || event.shiftKey) taken.current = true;
  }, []);

  return {
    trackRef,
    buttons,
    reveal,
    trackProps: { onScroll: paintTrack, onPointerDown, onTouchStart, onTouchMove, onWheel, onKeyDown: takeTrack },
  };
}
