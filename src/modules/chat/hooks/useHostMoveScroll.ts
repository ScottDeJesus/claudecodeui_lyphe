import { useRef } from 'react';
import type { RefObject } from 'react';

import { useHostMove } from '@/shared/context/HostWindowContext';

/** Where the transcript's scroller stood, and which message row was nearest its top — the anchor a restore puts back at the same offset when the rows around it changed. */
export type ScrollRestoreState = {
  height: number;
  top: number;
  anchor: HTMLElement | null;
  anchorOffset: number | null;
};

/** A capture plus whether the reader was following the foot: the one shape `restoreScroll` takes. */
type ScrollRestoreTarget = ScrollRestoreState & { following: boolean };

/** Reads the scroller's place: its offsets and the first message row still on screen, with that row's distance from the scroller's top. */
export function captureScrollRestoreState(container: HTMLDivElement): ScrollRestoreState {
  const containerBounds = container.getBoundingClientRect();
  const anchor = Array.from(container.querySelectorAll<HTMLElement>('.chat-message'))
    .find((element) => element.getBoundingClientRect().bottom >= containerBounds.top)
    ?? null;

  return {
    height: container.scrollHeight,
    top: container.scrollTop,
    anchor,
    anchorOffset: anchor
      ? anchor.getBoundingClientRect().top - containerBounds.top
      : null,
  };
}

/**
 * THE ONE RESTORE RULE for a transcript that was away from the screen — hidden behind another tab,
 * or carried to another host. Every caller that puts a reader back goes through here, so two writers
 * never race to different answers:
 *
 * - following the foot: the foot;
 * - else an anchor row that is still in the document and has an offset: shift the scroller so that
 *   row stands at the offset it had (the rows around it may have reflowed to the new width);
 * - else the top the scroller had.
 */
export function restoreScroll(container: HTMLElement, state: ScrollRestoreTarget): void {
  if (state.following) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  if (state.anchor?.isConnected && state.anchorOffset !== null) {
    const currentOffset = state.anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += currentOffset - state.anchorOffset;
    return;
  }
  container.scrollTop = state.top;
}

type UseHostMoveScrollArgs = {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** Whether the reader is following the foot, read at the moment it is called. */
  isFollowing: () => boolean;
  /** What to restore to when the scroller was not laid out at 'before' and so nothing was captured. */
  fallback: () => ScrollRestoreTarget;
};

/**
 * Keeps the reader's place across a move of the chat between hosts. Called by `useChatSessionState`,
 * which stays the scroll's one owner.
 *
 * A node that is detached and attached again loses its scroll offset, and the new host may be a
 * different width. So the place is captured on 'before' (the node still stands in the host it is
 * leaving) and put back on 'after' — both inside the move's own task, so no frame paints the
 * transcript's top and no scroll event reaches the near-top page load.
 */
export function useHostMoveScroll({ scrollContainerRef, isFollowing, fallback }: UseHostMoveScrollArgs): void {
  // What 'before' saw, held until the matching 'after' consumes it. A ref because the two phases
  // run in one synchronous task with no render between them, and nothing draws from it.
  const capturedRef = useRef<ScrollRestoreTarget | null>(null);

  useHostMove(({ phase }) => {
    const container = scrollContainerRef.current;
    if (phase === 'before') {
      // A scroller that is hidden (a closed tab) or detached has no geometry to capture; 'after'
      // then restores from the fallback.
      capturedRef.current = container && container.isConnected && container.clientHeight > 0
        ? { ...captureScrollRestoreState(container), following: isFollowing() }
        : null;
      return;
    }
    const captured = capturedRef.current;
    capturedRef.current = null;
    if (!container) return;
    restoreScroll(container, captured ?? fallback());
  });
}
