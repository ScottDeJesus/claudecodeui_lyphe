import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/** Where the strip stands: the card the reader is on, and whether either end is reached. */
type StripView = { index: number; atStart: boolean; atEnd: boolean };

/**
 * The arc deck's horizontal strip, moved one card at a time: by its arrows, by the Left/Right keys
 * on the focused strip, and — with no script at all — by a swipe or a trackpad, through CSS scroll
 * snap. This hook owns only the SCROLL POSITION; the cards and their order are the deck's props.
 *
 * THE CARD THE READER IS ON is the one whose centre is nearest the strip's centre, except at an end,
 * where it is that end's card: on a wide screen two cards share the view, and a strip scrolled all
 * the way over is "at the last card" even when the one before it is also in sight.
 *
 * THE LIVE CARD IS BROUGHT INTO VIEW, centred, on mount and whenever `focusIndex` changes — instant
 * the first time, so the deck opens already standing on it, and smooth after, so a hand-over from
 * one card to the next is seen to happen. A poll that changes nothing else never moves the strip,
 * so a reader who scrolled away is not yanked back every frame.
 *
 * The strip must be the offset parent of its items (`relative`): centring reads `offsetLeft`.
 * Used by `ArcDeck`, the one strip there is.
 */
export function useDeckStrip(focusIndex: number, cardCount: number) {
  const stripRef = useRef<HTMLOListElement>(null);
  // The scroll position only the DOM knows, changed by every swipe: it drives the two arrows'
  // disabled ends and the "card N of M" line, and nothing else can derive it.
  const [view, setView] = useState<StripView>({ index: focusIndex, atStart: true, atEnd: cardCount <= 1 });
  // Whether the first centring has happened, so the next one animates. A ref: it paints nothing.
  const centredOnce = useRef(false);
  // The card the reader is on and the width it was measured at, for the resize observer: a strip
  // that changes width keeps that card centred rather than drifting off it. Refs: they paint nothing.
  const readerIndex = useRef(focusIndex);
  const measuredWidth = useRef(0);

  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const items = Array.from(strip.children) as HTMLElement[];
    // One pixel of slack: a fractional scroll offset on a zoomed page never reaches the exact end.
    const atStart = strip.scrollLeft <= 1;
    const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
    const centre = strip.scrollLeft + strip.clientWidth / 2;
    let index = 0;
    let nearest = Number.POSITIVE_INFINITY;
    items.forEach((item, at) => {
      const distance = Math.abs(item.offsetLeft + item.offsetWidth / 2 - centre);
      if (distance < nearest) {
        nearest = distance;
        index = at;
      }
    });
    if (atStart) index = 0;
    else if (atEnd) index = Math.max(0, items.length - 1);
    readerIndex.current = index;
    setView((prior) =>
      prior.index === index && prior.atStart === atStart && prior.atEnd === atEnd ? prior : { index, atStart, atEnd });
  }, []);

  /** Centre card `index` in the strip. Scrolls the STRIP only — never the page around it. */
  const scrollToCard = useCallback((index: number, behavior: ScrollBehavior) => {
    const strip = stripRef.current;
    const item = strip?.children[index] as HTMLElement | undefined;
    if (!strip || !item) return;
    strip.scrollTo({ left: item.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2, behavior });
  }, []);

  // A strip with no width is not on screen yet (its tab is hidden): centring there is lost, so it
  // waits, and the observer below centres it the moment it is laid out.
  useLayoutEffect(() => {
    if ((stripRef.current?.clientWidth ?? 0) > 0) {
      scrollToCard(focusIndex, centredOnce.current ? 'smooth' : 'auto');
      centredOnce.current = true;
    }
    measure();
  }, [focusIndex, scrollToCard, measure]);

  // A card added or removed, or the strip resized (a rotated phone, a dragged split pane, a tab
  // shown for the first time), moves the ends without a scroll event; a new width re-centres the
  // card the reader was on.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const settle = () => {
      const width = strip.clientWidth;
      if (width > 0 && !centredOnce.current) {
        scrollToCard(focusIndex, 'auto');
        centredOnce.current = true;
      } else if (width > 0 && width !== measuredWidth.current) {
        scrollToCard(readerIndex.current, 'auto');
      }
      measuredWidth.current = width;
      measure();
    };
    settle();
    const observer = new ResizeObserver(settle);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [cardCount, focusIndex, scrollToCard, measure]);

  const step = useCallback((delta: -1 | 1) => {
    const target = Math.min(Math.max(view.index + delta, 0), cardCount - 1);
    scrollToCard(target, 'smooth');
  }, [view.index, cardCount, scrollToCard]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // Taken over, not added to: the browser's own arrow scroll would move a few pixels and fight
    // the snap, where this moves exactly one card.
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  }, [step]);

  return { stripRef, view, step, onScroll: measure, onKeyDown };
}
