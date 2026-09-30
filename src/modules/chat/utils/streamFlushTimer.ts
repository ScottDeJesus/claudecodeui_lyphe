import type { MutableRefObject } from 'react';

import type { StreamFlushTimer } from '@/shared/types';

/** How long streamed text is buffered before it is written to the store: one repaint's worth of deltas per flush. */
const STREAM_FLUSH_DELAY_MS = 100;

/**
 * Arms the flush on `hostWindow`, the window the chat is drawn in: a hidden opener throttles its
 * timers, and a flush that paces what the reader sees must run where the reader is looking.
 *
 * `flush` is the timer's whole body. The record keeps it so `flushStreamNow` can run it without
 * waiting for the timer.
 */
export function armStreamFlush(
  timerRef: MutableRefObject<StreamFlushTimer | null>,
  hostWindow: Window,
  flush: () => void,
): void {
  const id = hostWindow.setTimeout(() => {
    timerRef.current = null;
    flush();
  }, STREAM_FLUSH_DELAY_MS);
  timerRef.current = { id, armedOn: hostWindow, flush };
}

/** Cancels the pending flush, if any, on the window that armed it — an id cleared on any other window would cancel nothing, or a stranger's timer. */
export function clearStreamFlush(timerRef: MutableRefObject<StreamFlushTimer | null>): void {
  const pending = timerRef.current;
  if (!pending) return;
  pending.armedOn.clearTimeout(pending.id);
  timerRef.current = null;
}

/** Cancels the pending flush and runs its body at once. For a move between hosts: a timer armed on a window that is about to close would otherwise never fire. */
export function flushStreamNow(timerRef: MutableRefObject<StreamFlushTimer | null>): void {
  const pending = timerRef.current;
  if (!pending) return;
  clearStreamFlush(timerRef);
  pending.flush();
}
