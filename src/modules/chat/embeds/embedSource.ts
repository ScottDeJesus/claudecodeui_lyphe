import { useSyncExternalStore } from 'react';

import type { ChatEmbedSource, EmbedUrlRef } from '@/shared/types';

/**
 * The chat's declared embeds, published for the widget that draws them.
 *
 * The same shape, and for the same reason, as `subagents/subagentSource.ts` next door: the messages
 * an embed is read out of live in a `useRef` session store private to `ChatInterface`, so nothing
 * outside that component can ask for them. This module is the asking place. The chat publishes its
 * list tagged with its app session id, and a reader naming any other id — including `null`, a gutter
 * with no chat open — is handed nothing rather than the last conversation's dashboards.
 *
 * ONE SLOT, because one chat is open at a time. The tag is what makes that safe: a source left
 * standing by a chat that has gone is refused by id rather than by timing, so there is no window in
 * which the widget shows the wrong chat's pages.
 *
 * WHY NOT THE LIVE BUS. `live-bus` is the door a SANDBOXED WIDGET reaches through, and its topics are
 * an allowlist built for that frame's untrusted script. This is one React component telling another
 * React component something, in the same page, about the chat they are both already showing — the
 * bus would add a vocabulary entry, a retained value and a second lifetime to reason about, and buy
 * nothing the eight lines below do not.
 */

/** The published list, or null when no chat has published one. The stored value itself — its identity is what the store compares. */
let source: ChatEmbedSource | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ChatEmbedSource | null {
  return source;
}

/**
 * The chat's embeds for the readers outside it. REPLACED, never merged, so a reader is never handed
 * a half-updated list; publishing the value already held changes nothing and notifies nobody.
 */
export function publishEmbedSource(next: ChatEmbedSource | null): void {
  if (next === source) return;
  source = next;
  for (const listener of listeners) listener();
}

/** Nothing, in a stable identity — a fresh `[]` per call would be a new array every render and would rebuild everything downstream of it. */
const NO_TARGETS: EmbedUrlRef[] = [];

/** The addresses THIS chat has declared, in the order they were last named. Used by `EmbedWidgetBody`. */
export function useChatEmbedTargets(sessionId: string | null): EmbedUrlRef[] {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  if (sessionId === null || current === null || current.sessionId !== sessionId) return NO_TARGETS;
  return current.targets;
}

/**
 * What the layout needs to know about this chat's addresses: how many (the badge beside the title),
 * which one is newest (what opening the widget is FOR), and whether this chat's list has arrived at
 * all.
 *
 * `known` is the load-bearing field. "No addresses" and "not published yet" both read as an empty
 * list, and they must not be confused: on a chat switch the arriving chat publishes one commit AFTER
 * the layout has already re-rendered with its id, so a reader of the bare list would see nothing,
 * then everything — and read the whole of an old chat's history as a fresh declaration. Read off the
 * very same snapshot the list is, so the badge, the newest address and the list cannot disagree.
 */
export function useEmbedWidgetState(sessionId: string | null): { count: number; newest: string | null; known: boolean } {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  if (sessionId === null || current === null || current.sessionId !== sessionId) {
    return { count: 0, newest: null, known: false };
  }
  const { targets } = current;
  return { count: targets.length, newest: targets.length > 0 ? targets[targets.length - 1].url : null, known: true };
}
