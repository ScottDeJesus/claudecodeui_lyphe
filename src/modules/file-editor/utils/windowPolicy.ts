import type { WindowAction, WindowPolicyInput } from '@/shared/types';

/**
 * The window policy: pure arithmetic that decides, from nothing but numbers the hook reads off
 * the view, which loads and evictions the window needs. Nothing here touches CodeMirror, React
 * or the network — that is what makes the boundary rules at the file's edges reviewable by
 * reading them.
 *
 * The buffer is two screens of lines in each direction (B below), so ordinary scrolling never
 * waits on a request and a whole page of movement is still covered by text already loaded.
 */

/** Screens of lines held beyond the viewport in each direction. */
const BUFFER_SCREENS = 2;

/** The server caps a window at 400 lines; a request never asks for more. */
const MAX_WINDOW_LINES = 400;

/** The buffer, in lines, for a viewport that holds `viewportLines` lines. */
const bufferLines = (viewportLines: number): number => BUFFER_SCREENS * viewportLines;

/**
 * The first window for a file opened at `anchorLine`: the viewport's worth of lines plus a
 * buffer screen each way, never starting before line 1 and never longer than the server's cap.
 */
export function openWindowRequest(
  anchorLine: number,
  viewportLines: number,
): { start: number; lines: number } {
  const buffer = bufferLines(viewportLines);
  return {
    start: Math.max(1, anchorLine - buffer),
    lines: Math.min(MAX_WINDOW_LINES, viewportLines + 2 * buffer),
  };
}

/**
 * Everything the window must do right now, in the order it must be done.
 *
 * Loads come before evictions because a load decides the document's size, and an eviction
 * proposed against the old size could remove lines the load just brought in. Each action is
 * skipped while a request is already in flight in that direction, so a scroll cannot queue a
 * second identical fetch; the hook runs this again after every applied window, which is what
 * picks the work up once the pending flag clears.
 */
export function nextWindowActions(input: WindowPolicyInput): WindowAction[] {
  const { lo, origCount, docLines, eof, top, bottom, touchedFirst, touchedLast, pending } = input;
  const buffer = bufferLines(input.viewportLines);
  const actions: WindowAction[] = [];

  if (top - 1 < buffer && lo > 1 && !pending.up) {
    const start = Math.max(1, lo - buffer);
    actions.push({ kind: 'prepend', start, lines: lo - start });
  }

  if (docLines - bottom < buffer && !eof && !pending.down) {
    actions.push({ kind: 'append', start: lo + origCount, lines: Math.min(MAX_WINDOW_LINES, buffer) });
  }

  const evictTopCount = top - 1 - buffer;
  if (
    top - 1 > 2 * buffer &&
    (touchedFirst === null || evictTopCount < touchedFirst)
  ) {
    actions.push({ kind: 'evictTop', count: evictTopCount });
  }

  const evictBottomCount = docLines - bottom - buffer;
  if (
    docLines - bottom > 2 * buffer &&
    (touchedLast === null || docLines - evictBottomCount >= touchedLast)
  ) {
    actions.push({ kind: 'evictBottom', count: evictBottomCount });
  }

  return actions;
}
