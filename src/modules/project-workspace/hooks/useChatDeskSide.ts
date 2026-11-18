import { useSyncExternalStore } from 'react';

/**
 * The window from which the chat is laid out as at a desk, and from which its side column is the wider one: the station's own two
 * widths for its two columns (1024 px and 1360 px). A window too short for the column's pieces (a phone on its side) is not a desk.
 */
const DESK_QUERY = '(min-width: 1024px) and (min-height: 560px)';
const WIDE_QUERY = '(min-width: 1360px) and (min-height: 560px)';

/** The side column's width in px at each: none on a narrow screen. */
const NO_SIDE = 0;
const SIDE_AT_DESK = 300;
const SIDE_WHEN_WIDE = 360;

let queries: { desk: MediaQueryList; wide: MediaQueryList } | null = null;
const readQueries = () => (queries ??= { desk: window.matchMedia(DESK_QUERY), wide: window.matchMedia(WIDE_QUERY) });

function subscribe(onChange: () => void): () => void {
  const { desk, wide } = readQueries();
  desk.addEventListener('change', onChange);
  wide.addEventListener('change', onChange);
  return () => {
    desk.removeEventListener('change', onChange);
    wide.removeEventListener('change', onChange);
  };
}

function getSnapshot(): number {
  const { desk, wide } = readQueries();
  return wide.matches ? SIDE_WHEN_WIDE : desk.matches ? SIDE_AT_DESK : NO_SIDE;
}

/**
 * HOW WIDE THE CHAT'S SIDE COLUMN IS IN THIS WINDOW, in px: 0 where there is none (a narrow screen, where the chat is one column and
 * its core stands beside the line). It follows the window through the two queries' own `change`, never a timer, and re-renders its
 * reader only when a width is crossed.
 *
 * Used by `WorkspaceMain`, which hands the width to `ChatDesk` and tells the session's panel that the follow-ups stand apart.
 */
export function useChatDeskSide(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
