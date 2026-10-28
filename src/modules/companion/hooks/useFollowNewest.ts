import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

/** How near the end still counts as "at the newest", in px: a reader a few pixels short of the end has not scrolled up. */
const AT_END_SLACK = 48;

/**
 * Keeps a scroller on its newest content while the reader is there, and lets go the moment they scroll up.
 *
 * Hand `scrollerRef` to the scroller (a callback ref). Each mount and unmount of the element re-keys everything here, so
 * it follows the element itself: CompanionLog mounts its scroller only once it has lines — an empty log is an empty state,
 * and a Clear empties it again — and a listener attached once, to whatever a ref object held at mount, would miss every
 * scroller after the first. A scroller that mounts starts at its newest line and follows: a log that fills again is a new
 * conversation.
 *
 * `following` is the reader's own choice, read from HIS scrolling: it ends when the position moves up and leaves the end
 * (beyond `AT_END_SLACK`), and it comes back when he reaches the end. A layout change is never read as him scrolling up —
 * a box that shrinks moves the end away without moving him, and a scroll event a layout fires lands at the end or below.
 *
 * While he follows, the scroller is put back at its end before the paint whenever `contentKey` changes — a new line, a
 * sentence growing — so a streaming answer never jumps, and whenever the scroller or its content changes size: the dock
 * under the log grows with a walkthrough, a note, the draft or a line he types into it, and the newest line would slide
 * below the fold with nothing to bring it back. That is a ResizeObserver on both (an event, never a poll). `visible` is the
 * scroller's own visibility: a panel kept mounted while closed cannot be scrolled while it is not drawn, so it is put at
 * its end again when it is shown, if the reader was following.
 *
 * `jumpToNewest` puts it at its end and follows again — the "newest" press of a reader who had scrolled up.
 *
 * Used by this module's CompanionLog, the one scroller in her panel that grows at its end.
 */
export function useFollowNewest(contentKey: string, visible: boolean) {
  const hostWindow = useHostWindow();
  // The scroller element, written by the callback ref; the effects read it, and set its scroll position, through here.
  const elementRef = useRef<HTMLDivElement | null>(null);
  // Counts the scroller's mounts and unmounts. State, so the listener and the pin below re-attach to each new scroller
  // instead of keeping the one (or the none) they found first.
  const [mounts, setMounts] = useState(0);
  // Whether the reader stands at the newest line. State, because the log shows its "newest" press only while they do not,
  // and a scroll position is not something React can read during a render.
  const [following, setFollowing] = useState(true);

  const scrollerRef = useCallback((node: HTMLDivElement | null) => {
    elementRef.current = node;
    setMounts((count) => count + 1);
    if (node) setFollowing(true);
  }, []);

  // Heard on the scroller itself: a scroll event does not bubble, and the kit's ScrollArea hands its ref to the inner
  // scroller, not to the box that would receive a React `onScroll`. The position he was at is kept between events, so
  // only a move UP away from the end lets go.
  useEffect(() => {
    const scroller = elementRef.current;
    if (!scroller) return undefined;
    let lastTop = scroller.scrollTop;
    const read = () => {
      const top = scroller.scrollTop;
      const fromEnd = scroller.scrollHeight - top - scroller.clientHeight;
      if (fromEnd <= AT_END_SLACK) setFollowing(true);
      else if (top < lastTop) setFollowing(false);
      lastTop = top;
    };
    scroller.addEventListener('scroll', read, { passive: true });
    return () => scroller.removeEventListener('scroll', read);
  }, [mounts]);

  // The scroller's box or its content changed size: a reader who follows keeps the newest line in view. Built by the
  // host window's own constructor (`resizeObserverIn`), rebuilt when the scroller, his choice or the visibility changes.
  useEffect(() => {
    const scroller = elementRef.current;
    if (!scroller || !visible || !following) return undefined;
    const observer = resizeObserverIn(hostWindow, () => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    if (!observer) return undefined;
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [mounts, visible, following, hostWindow]);

  // Before the paint, so the new line is drawn already in place rather than drawn and then scrolled to.
  useLayoutEffect(() => {
    const scroller = elementRef.current;
    if (!scroller || !visible || !following) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [mounts, contentKey, visible, following]);

  const jumpToNewest = useCallback(() => {
    const scroller = elementRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    setFollowing(true);
  }, []);

  return { scrollerRef, following, jumpToNewest };
}
