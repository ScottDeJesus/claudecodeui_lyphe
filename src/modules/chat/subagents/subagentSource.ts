import { useLayoutEffect, useSyncExternalStore } from 'react';

import type { ChatSubagentSource } from '@/shared/types';

/**
 * The chat's own pinned rows, published for the surfaces that cannot reach them.
 *
 * The rows a chat pins are derived inside `ChatInterface` from a session store that is a `useRef`
 * private to that component, so nothing outside it can ask for them. This module is that asking
 * place: the chat publishes its source tagged with its app session id, and a reader names one id
 * and gets `null` for every other conversation. One chat is open at a time, so one slot holds the
 * source; the tag is what keeps a stale one from being read as somebody else's.
 *
 * The claim counter is the other half. While the desktop gutters show, the Subagents widget draws
 * these rows better than the strip above the chat box can, so the strip stands down — and the
 * counter is a NUMBER of claimants rather than a flag, because more than one region may claim it
 * and the first to let go must not stand it back up while another still holds it. The chat never
 * learns who claimed it.
 */
let source: ChatSubagentSource | null = null;

/** How many regions have claimed the strip. Read as `> 0`, so it is a count and not a flag. */
let claims = 0;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** The stored value itself, never a copy: its identity is what the store compares. */
function getSourceSnapshot(): ChatSubagentSource | null {
  return source;
}

function getClaimedSnapshot(): boolean {
  return claims > 0;
}

/**
 * The chat's rows for the readers outside it. Published when they are derived and REPLACED, not
 * merged, so a reader is never handed a half-updated source; publishing the value already held
 * changes nothing.
 */
export function publishSubagentSource(next: ChatSubagentSource | null): void {
  if (next === source) return;
  source = next;
  notify();
}

/**
 * The published source, but ONLY for the conversation that asks. Used by the chat-gutters module
 * (`hooks/useSubagentWidgetRows.ts`) to draw the widget's own copy of the pinned rows; every other
 * id — including `null`, which is a gutter with no chat open — gets `null` rather than the last
 * chat's rows.
 */
export function useSubagentSource(sessionId: string | null): ChatSubagentSource | null {
  const current = useSyncExternalStore(subscribe, getSourceSnapshot);
  if (sessionId === null || current === null || current.sessionId !== sessionId) return null;
  return current;
}

/**
 * Says "the strip lives in me now", for as long as `active` holds. Taken by the chat-gutters
 * module (`ChatGutterLayout.tsx`) when its width lets it draw the Subagents widget; the cleanup
 * gives the claim back on unmount or when the width stops allowing it.
 *
 * A LAYOUT effect, and it has to be one: the claimant wraps the chat, and React flushes a child's
 * passive effects before its parent's, so a claim taken in `useEffect` would land after the chat
 * had already committed a frame with the strip up — the reader would see the same rows twice for
 * that frame. A layout effect runs before the browser paints, so at a claiming width the strip is
 * never painted at all.
 */
export function useClaimSubagentStrip(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    claims += 1;
    notify();
    return () => {
      claims -= 1;
      notify();
    };
  }, [active]);
}

/**
 * Whether any region is drawing the pinned rows, read by `ChatInterface` today to decide whether
 * the strip above the composer should be drawn at all, and by the chat-gutters module once its
 * Subagents widget claims them.
 */
export function useSubagentStripClaimed(): boolean {
  return useSyncExternalStore(subscribe, getClaimedSnapshot);
}
