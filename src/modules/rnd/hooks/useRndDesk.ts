import { useEffect, useState } from 'react';

/** The window width, in px, from which the place is two panes: the list's column (32rem) and room beside it for a candidate read whole. */
const DESK_FROM_PX = 1180;

/**
 * Whether the R&D place has a desk's room: the window is wide enough for the list and the open candidate side by side. Read from
 * the window's own width and kept as it changes, so a window dragged narrower goes back to the one column.
 *
 * Used by `RndPanel`, to choose between its two layouts.
 */
export function useRndDesk(): boolean {
  const query = '(min-width: ' + DESK_FROM_PX + 'px)';
  // Whether the window is at a desk's width now.
  const [desk, setDesk] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const read = () => setDesk(media.matches);
    read();
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, [query]);
  return desk;
}
