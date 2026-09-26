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
 * THE CARD THE ARC IS ON IS BROUGHT INTO VIEW, centred, on mount and whenever `focusIndex` changes —
 * instant the first time, so the deck opens already standing on it, and smooth after, so a movement
 * from one card to the next is seen to happen. A poll that changes nothing else never moves the
 * strip, so a reader who scrolled away is not yanked back every frame.
 *
 * IT ALSO OWNS THE STRIP'S HEIGHT, and that is the same fact the scroll position is: WHICH card the
 * reader is on. A row of flex items is as tall as its tallest item, so a strip left to itself wears
 * the tallest card's height under every shorter one — measured on an arc deck in the Runner widget,
 * 2026-09-25: a three-line card painted 398px with 260px of nothing beneath it, because a
 * later card of the same arc carries seventeen phase rows (operator, the same day: "plan/arc cards
 * should not have so much empty space, it should be dynamically adjusting"). So the height here is
 * the CARD THE READER IS ON, measured, and the deck grows and shrinks as the strip is paged, swiped
 * or keyed past. Measuring rather than deriving is what lets it follow a card whose own height
 * moves — a phase row landing, a clock appearing — and every card is observed beside the strip for
 * exactly that. Nothing here derives either axis from the other, so a height change never moves the
 * strip: the horizontal reading is left exactly where the reader put it, and the vertical one is
 * pinned at 0 (`measure`, where every scroll is read).
 *
 * The strip must be the offset parent of its items (`relative`): centring reads `offsetLeft`.
 * Used by `DeckFrame`, the one strip every dispatch arc's deck draws.
 */
export function useDeckStrip(focusIndex: number, cardCount: number) {
  const stripRef = useRef<HTMLOListElement>(null);
  // The scroll position only the DOM knows, changed by every swipe: it drives the two arrows'
  // disabled ends and the "card N of M" line, and nothing else can derive it.
  const [view, setView] = useState<StripView>({ index: focusIndex, atStart: true, atEnd: cardCount <= 1 });
  // The height of the card the reader is on, as the deck's own height. `null` until the first
  // reading, so a strip that has not been measured yet takes its natural height rather than 0.
  const [stripHeight, setStripHeight] = useState<number | null>(null);
  // Whether the first centring has happened, so the next one animates. A ref: it paints nothing.
  const centredOnce = useRef(false);
  // The card the reader is on and the width it was measured at, for the resize observer: a strip
  // that changes width keeps that card centred rather than drifting off it. Refs: they paint nothing.
  const readerIndex = useRef(focusIndex);
  const measuredWidth = useRef(0);

  /**
   * The height of the card the reader is on, as the deck's height. Read off the ITEM rather than
   * the card: a lane may put a pin or a caption above its card inside the same slot, and the deck
   * has to be tall enough for all of it.
   *
   * NOTHING AT ALL IS READ FROM A STRIP THAT IS NOT ON SCREEN — a hidden tab has no width, and its
   * cards no height, and a zero written here would be a deck that has to be repaired when the tab
   * comes back. The strip's own observer re-runs this the moment it is laid out.
   */
  const measureHeight = useCallback(() => {
    const strip = stripRef.current;
    if (strip === null || strip.clientWidth === 0) return;
    const item = strip.children[readerIndex.current] as HTMLElement | undefined;
    const height = item?.offsetHeight ?? 0;
    if (height > 0) setStripHeight((prior) => (prior === height ? prior : height));
  }, []);

  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    // THE STRIP'S VERTICAL OFFSET IS NEVER THE READER'S, AND IS PUT BACK WHEREVER THE SCROLL IS READ.
    // The box is the reader's card tall while its content is the tallest card's, so it carries a real
    // vertical scroll range: `overflow-y-hidden` keeps the wheel out of it, and nothing else did —
    // a focus move still shifts it (measured 2026-09-25: one Tab from the focused strip took
    // `scrollTop` to 16 and cut the top of the reader's own card by the same, with no cue at all).
    // Pinning it here cannot fight the horizontal position: the axes are independent, this never
    // writes `scrollLeft`, and a scroll it causes reads back to the same card the reader is on.
    if (strip.scrollTop !== 0) strip.scrollTop = 0;
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
    // The deck's own height follows the card, so it is re-read wherever the reader's card is.
    measureHeight();
    setView((prior) =>
      prior.index === index && prior.atStart === atStart && prior.atEnd === atEnd ? prior : { index, atStart, atEnd });
  }, [measureHeight]);

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
  // card the reader was on. EVERY CARD IS OBSERVED BESIDE THE STRIP, because a card's own height
  // moves as its run walks — a phase row lands, a clock appears — and the deck's height is the
  // reader's card, so it has to follow without a scroll to prompt it.
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
    for (const item of Array.from(strip.children)) observer.observe(item);
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

  return { stripRef, view, step, onScroll: measure, onKeyDown, stripHeight };
}
