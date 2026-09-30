import type { AnchorStore } from '@/shared/types';

/** Whether two rects stand in the same place at the same size: the four numbers the panel's geometry reads. */
function sameRect(first: DOMRect, second: DOMRect): boolean {
  return first.left === second.left
    && first.top === second.top
    && first.width === second.width
    && first.height === second.height;
}

/**
 * The FAB's drawn rect as a small external store, so the panel that stands beside the FAB can follow it
 * through `useSyncExternalStore` without the provider re-rendering the workspace on every frame of a drag.
 *
 * AN UNCHANGED RECT KEEPS THE OLD OBJECT. The FAB reports after every placement and every window resize,
 * and most of those reports repeat a rect the panel has already stood beside; the snapshot is compared by
 * identity, so a repeat that swapped the object would re-render the panel for nothing. `null` (no FAB
 * mounted) is a value like any other and is held the same way.
 *
 * Used by chat-host's provider, which holds one for its whole life.
 */
export function createAnchorStore(): AnchorStore {
  let current: DOMRect | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => current,
    set: (rect) => {
      const unchanged = rect === null ? current === null : current !== null && sameRect(current, rect);
      if (unchanged) return;
      current = rect;
      // A copy, so a listener that unsubscribes while it hears the change cannot skip the next one.
      for (const listener of [...listeners]) listener();
    },
  };
}
