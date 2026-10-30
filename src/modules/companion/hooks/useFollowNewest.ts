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
 * A PLACE PUT BACK IS KEPT. A scroller mounts at its top, and its first pin puts it at its end. One that already stands above
 * its end by more than `AT_END_SLACK` at its first pin was put there by a caller holding the reader's place (the station's
 * scroll memory, through CompanionLog's `scrollRef`, after a reload or a tier change): it is left where it stands and starts
 * not following, so "Newest" brings him down. Her panel puts no place back, so its scroller pins as it always has.
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
  // `following` as the resize observer reads it when it fires: the observer a mount attaches may outlive the render that
  // kept a place put back, and must not pin over it.
  const followingRef = useRef(true);
  // The scroller the log last pinned (put at its end), so a new one's first pin can tell a place a caller put back from a fresh mount.
  const pinnedRef = useRef<HTMLDivElement | null>(null);

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
      if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    if (!observer) return undefined;
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [mounts, visible, following, hostWindow]);

  // Before the paint, so the new line is drawn already in place rather than drawn and then scrolled to.
  useLayoutEffect(() => {
    followingRef.current = following;
    const scroller = elementRef.current;
    if (!scroller || !visible || !following) return;
    if (pinnedRef.current !== scroller) {
      // Its first pin: a scroller standing above its end was put there by a caller holding his place, which is kept. The scroller
      // is marked pinned only below, where it IS pinned, so this answer is the same when the effect runs again before `following`
      // has been read back (React's StrictMode runs a mount's layout effect twice): marked here, the second run would pin over it.
      if (scroller.scrollTop > 0 && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > AT_END_SLACK) {
        followingRef.current = false;
        setFollowing(false);
        return;
      }
      pinnedRef.current = scroller;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }, [mounts, contentKey, visible, following]);

  const jumpToNewest = useCallback(() => {
    const scroller = elementRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    followingRef.current = true;
    setFollowing(true);
  }, []);

  return { scrollerRef, following, jumpToNewest };
}
