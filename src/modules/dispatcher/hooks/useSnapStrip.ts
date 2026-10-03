import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, WheelEvent } from 'react';

/** Where the strip stands: the item the reader is on, and whether either end is reached. */
type StripView = { index: number; atStart: boolean; atEnd: boolean };

/**
 * Whether a keystroke made on `target` belongs to a text control. Its arrows move the caret (or an
 * option) and are the control's own, so a strip that took them would page away from a reader who is
 * still typing.
 */
function isTextControl(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}

/**
 * A horizontal strip moved one item at a time: by its arrows, by the Left/Right keys on the focused
 * strip, and — with no script at all — by a swipe or a trackpad, through CSS scroll snap; and to any
 * item at once by a map above it (`goTo`). This hook owns only the SCROLL POSITION; the items and
 * their order are the caller's.
 *
 * THE ITEM THE READER IS ON is the one whose centre is nearest the strip's centre, except at an end,
 * where it is that end's item: mid-swipe two items share the view, and a strip scrolled all
 * the way over is "at the last item" even when the one before it is also in sight.
 *
 * THE ITEM THE CALLER IS ON IS BROUGHT INTO VIEW, centred, on mount and whenever `focusIndex` changes —
 * instant the first time, so the strip opens already standing on it, and smooth after, so a movement
 * from one item to the next is seen to happen. A poll that changes nothing else never moves the
 * strip, so a reader who scrolled away is not yanked back every frame.
 *
 * IT ALSO OWNS THE STRIP'S HEIGHT, and that is the same fact the scroll position is: WHICH item the
 * reader is on. A row of flex items is as tall as its tallest item, so a strip left to itself wears
 * the tallest item's height under every shorter one — measured on an arc deck in the Runner widget,
 * 2026-09-25: a three-line card painted 398px with 260px of nothing beneath it, because a
 * later card of the same arc carries seventeen phase rows (operator, the same day: "plan/arc cards
 * should not have so much empty space, it should be dynamically adjusting"). So the height here is
 * the ITEM THE READER IS ON, measured, and the strip grows and shrinks as it is paged, swiped
 * or keyed past. Measuring rather than deriving is what lets it follow an item whose own height
 * moves — a phase row landing, a clock appearing, an `Other…` field opening — and every item is
 * observed beside the strip for exactly that. Nothing here derives either axis from the other, so a
 * height change never moves the strip: the horizontal reading is left exactly where the reader put
 * it, and the vertical one is pinned at 0 (`measure`, where every scroll is read).
 *
 * AN ASK OUTLIVES THE ANIMATION CARRYING IT OUT. `view.index` is read off the SCROLL POSITION, and a
 * smooth centring rewrites it on every frame it runs, so a press landing mid-flight would be anchored
 * to wherever the scroll had got instead of to the item the reader asked for. Measured on the tab deck,
 * 2026-09-26: three quick presses of `next` moved the reader two cards, and a press just after the arc
 * flow's tenth node ABANDONED that jump and landed on card two. So every ask writes its destination to
 * `intended`, `step` measures from there while one is out, and the ask is spent when the scroll arrives
 * or when the reader takes the strip in their own hands.
 *
 * A STRIP THAT IS NOT ON SCREEN IS NOT READ. A fold that is `display:none` gives the strip no box:
 * its scroll offset is gone and every item's offset reads 0, which `measure` would take for "the
 * reader is on item 0" and then re-centre on at the next layout — a reader who folded the card away
 * on the third question came back to the first. Nothing is read from a strip without a width, so the
 * reader's item is where they left it and the next layout puts the strip back on it.
 *
 * The strip must be the offset parent of its items (`relative`): centring reads `offsetLeft`.
 * Used by `DeckStrip`, for an arc deck's plans in the Runner tab and in the chat gutter's widget alike,
 * and by `RoundAnswer`, for a round's questions — both draw the one `SnapStrip` over this.
 */
export function useSnapStrip(focusIndex: number, itemCount: number) {
  const stripRef = useRef<HTMLOListElement>(null);
  // The scroll position only the DOM knows, changed by every swipe: it drives the two arrows'
  // disabled ends and the "N of M" line, and nothing else can derive it.
  const [view, setView] = useState<StripView>({ index: focusIndex, atStart: true, atEnd: itemCount <= 1 });
  // The height of the item the reader is on, as the strip's own height. `null` until the first
  // reading, so a strip that has not been measured yet takes its natural height rather than 0.
  const [stripHeight, setStripHeight] = useState<number | null>(null);
  // Whether the first centring has happened, so the next one animates. A ref: it paints nothing.
  const centredOnce = useRef(false);
  // The item the reader is on and the width it was measured at, for the resize observer: a strip
  // that changes width keeps that item centred rather than drifting off it. Refs: they paint nothing.
  const readerIndex = useRef(focusIndex);
  const measuredWidth = useRef(0);
  // THE ITEM THE READER ASKED FOR, while the scroll that goes there is still travelling. Written by
  // every ask (`scrollToItem`: the arrows, the keys, a map's node, the focus centring), read by `step`,
  // and spent the moment the scroll arrives (`measure`) or the reader takes the strip in their own
  // hands again (`onReaderGesture`). A ref: it paints nothing.
  const intended = useRef<number | null>(null);

  /**
   * The height of the item the reader is on, as the strip's height. Read off the ITEM rather than
   * the card in it: a lane may put a pin or a caption above its card inside the same slot, and the
   * strip has to be tall enough for all of it.
   *
   * NOTHING AT ALL IS READ FROM A STRIP THAT IS NOT ON SCREEN — a hidden tab has no width, and its
   * items no height, and a zero written here would be a strip that has to be repaired when the tab
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
    // No width, no reading (see "A STRIP THAT IS NOT ON SCREEN IS NOT READ" above).
    if (!strip || strip.clientWidth === 0) return;
    // THE STRIP'S VERTICAL OFFSET IS NEVER THE READER'S, AND IS PUT BACK WHEREVER THE SCROLL IS READ.
    // The box is the reader's item tall while its content is the tallest item's, so it carries a real
    // vertical scroll range: `overflow-y-hidden` keeps the wheel out of it, and nothing else did —
    // a focus move still shifts it (measured 2026-09-25: one Tab from the focused strip took
    // `scrollTop` to 16 and cut the top of the reader's own card by the same, with no cue at all).
    // Pinning it here cannot fight the horizontal position: the axes are independent, this never
    // writes `scrollLeft`, and a scroll it causes reads back to the same item the reader is on.
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
    // The ask has arrived: it is spent, and the next press is measured from the item the reader is on.
    if (intended.current === index) intended.current = null;
    // The strip's own height follows the item, so it is re-read wherever the reader's item is.
    measureHeight();
    setView((prior) =>
      prior.index === index && prior.atStart === atStart && prior.atEnd === atEnd ? prior : { index, atStart, atEnd });
  }, [measureHeight]);

  /** Centre item `index` in the strip. Scrolls the STRIP only — never the page around it. */
  const scrollToItem = useCallback((index: number, behavior: ScrollBehavior) => {
    const strip = stripRef.current;
    const item = strip?.children[index] as HTMLElement | undefined;
    if (!strip || !item) return;
    // The ask is recorded before it is made: this scroll may run for a few hundred milliseconds, and a
    // press landing inside that window has to be measured from where the reader is GOING.
    intended.current = index;
    strip.scrollTo({ left: item.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2, behavior });
  }, []);

  /** Drop an ask still travelling: the reader has taken the strip in their own hands, so it is no
   * longer where anyone is going and the next press must be measured from what they scroll to. */
  const onReaderGesture = useCallback(() => {
    intended.current = null;
  }, []);

  /** The same, for a trackpad: its HORIZONTAL wheel scrolls the strip; a vertical one scrolls the pane
   * behind it (`overflow-y-hidden`), leaves the strip where it stands, and drops no ask. */
  const onReaderWheel = useCallback((event: WheelEvent<HTMLOListElement>) => {
    if (event.deltaX !== 0) intended.current = null;
  }, []);

  // A strip with no width is not on screen yet (its tab is hidden): centring there is lost, so it
  // waits, and the observer below centres it the moment it is laid out.
  useLayoutEffect(() => {
    if ((stripRef.current?.clientWidth ?? 0) > 0) {
      scrollToItem(focusIndex, centredOnce.current ? 'smooth' : 'auto');
      centredOnce.current = true;
    }
    measure();
  }, [focusIndex, scrollToItem, measure]);

  // An item added or removed, or the strip resized (a rotated phone, a dragged split pane, a tab
  // shown for the first time, a fold opened again), moves the ends without a scroll event; a new
  // width re-centres the item the reader was on. EVERY ITEM IS OBSERVED BESIDE THE STRIP, because an
  // item's own height moves — a phase row lands, a clock appears, an `Other…` field opens — and the
  // strip's height is the reader's item, so it has to follow without a scroll to prompt it.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const settle = () => {
      const width = strip.clientWidth;
      if (width > 0 && !centredOnce.current) {
        scrollToItem(focusIndex, 'auto');
        centredOnce.current = true;
      } else if (width > 0 && width !== measuredWidth.current) {
        scrollToItem(readerIndex.current, 'auto');
      }
      measuredWidth.current = width;
      measure();
    };
    settle();
    const observer = new ResizeObserver(settle);
    observer.observe(strip);
    for (const item of Array.from(strip.children)) observer.observe(item);
    return () => observer.disconnect();
  }, [itemCount, focusIndex, scrollToItem, measure]);

  const step = useCallback((delta: -1 | 1) => {
    // From the item the reader asked for, while that ask is still travelling: `view.index` is the
    // scroll's own reading and the animation is rewriting it, so stepping from it would move an item
    // from wherever the scroll happens to have got to.
    const from = intended.current ?? view.index;
    const target = Math.min(Math.max(from + delta, 0), itemCount - 1);
    scrollToItem(target, 'smooth');
  }, [view.index, itemCount, scrollToItem]);

  /** Centre item `index`, smoothly — a map node's press, which may jump any distance along the strip. */
  const goTo = useCallback((index: number) => {
    scrollToItem(Math.min(Math.max(index, 0), itemCount - 1), 'smooth');
  }, [itemCount, scrollToItem]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLOListElement>) => {
    // ONLY A KEYSTROKE MADE IN THE STRIP MOVES IT. An item may open a modal that portals its DOM out to
    // `<body>` while staying a React child of the strip, and React bubbles a keydown along THAT tree,
    // portal included — so an arrow pressed over an open dialog reached here and paged the deck behind
    // it (measured 2026-09-26: one ArrowRight with `Delete feature…` up took card 4 to 5). The DOM box is
    // the honest test: a keystroke belongs to the strip when it happened inside it.
    if (!stripRef.current?.contains(event.target as Node)) return;
    // AND A KEYSTROKE MADE IN A TEXT CONTROL IS THAT CONTROL'S. A round's `Other…` field sits inside
    // its question's item: its Left and Right are the caret's, and paging away from a half-typed
    // answer — with `preventDefault` taking the caret's move too — is the one thing typing there must
    // never do.
    if (isTextControl(event.target)) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      // Any other key inside the strip is the box's own to act on — Home, End and the page keys scroll
      // it natively — so an ask still travelling is dropped rather than steering the next press.
      intended.current = null;
      return;
    }
    // Taken over, not added to: the browser's own arrow scroll would move a few pixels and fight
    // the snap, where this moves exactly one item.
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  }, [step]);

  return {
    stripRef,
    view,
    step,
    goTo,
    onScroll: measure,
    onKeyDown,
    onReaderGesture,
    onReaderWheel,
    stripHeight,
  };
}
