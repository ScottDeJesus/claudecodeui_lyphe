import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type {
  RecentConversationListItem,
  SimpleListFolder,
  SimpleListItem,
  SimpleListItemRef,
  SimpleListLayoutItem,
  SimpleListPosition,
} from '@/shared/types';
import {
  appendPage,
  flattenChats,
  moveItem,
  patchChat,
  patchFolder,
  removeChat,
  treeFromFeed,
} from '@/modules/sidebar/utils/simpleChatTree';

type RecentConversationsPayload = {
  success?: boolean;
  data?: {
    conversations?: RecentConversationListItem[];
    layout?: SimpleListLayoutItem[];
    total?: number;
    hasMore?: boolean;
  };
};

/** The page size for both the first fetch and `loadMore`. */
const PAGE_SIZE = 20;

/**
 * The most rows one `reload` may ask for. The feed route bounds `limit` at 100 and refuses a larger
 * ask with a 400, so a list that has paged past a hundred top-level rows reloads its first hundred
 * rather than sending a request the server would turn away.
 */
const MAX_RELOAD_ROWS = 100;

/**
 * How long a burst of `session_upserted` frames is coalesced into one refetch. A run in
 * progress can upsert its own row several times a second; without this every frame would
 * fire its own request.
 */
const RELOAD_DEBOUNCE_MS = 500;

/**
 * Every mounted instance of the feed, told of a row taken out of it. The sidebar's list and the floating
 * picker each hold their own rows, and an archive or a delete sends no `session_upserted` (the only other
 * thing that refreshes them): a removal made through one instance would otherwise stay listed in the other
 * until an unrelated upsert arrived.
 */
const removalListeners = new Set<(sessionId: string) => void>();

/**
 * The paginated, server-tagged feed behind SidebarSimpleList and SidebarSessionPicker: `api.recentConversations`
 * called with `simpleList: true`, which is the ONLY source that knows which sessions were started from
 * this view — the tree's `projects[].sessions` arrays never carry the tag.
 *
 * THE TREE. The feed answers two halves that only agree together: `conversations`, the page's chat rows,
 * and `layout`, the page's top-level rows in the server's own order — a loose chat by its session id, or
 * a folder with its chats' ids. This hook joins them (`treeFromFeed`) into `items`, and that tree is the
 * one piece of state the feed is: every local edit goes through `simpleChatTree`'s pure functions, and
 * `rows` (every chat, flat, in drawn order) is derived from it, so the two readers above can never draw
 * two shapes of the same feed. A folder is ONE top-level row however many chats it holds, which is what
 * `total`, `loadMore`'s offset and the route's own paging are counted in.
 *
 * `enabled` is false for a caller that mounts this hook in a view where the feed is not the list on
 * screen (the picker, in the project tree's shape): no page is fetched, no websocket subscription is
 * held, and the open-chat reload stays quiet. Turning it on fetches the first page, turning it off
 * lets go of the subscription. The sidebar's list is only ever mounted with the feed on, so it
 * takes the default.
 *
 * The pager idiom (request-sequence guard) mirrors `useSidebarController.ts`'s
 * `fetchRecentConversationsPage` on purpose: this hook is a second copy of that seam until the
 * controller is split, and the two are meant to stay recognisably one shape. Appending dedupes by
 * top-level row inside `appendPage`, which is the tree's own rule rather than a second copy here.
 */
export function useSimpleChatList(selectedSessionId: string | null, enabled = true): {
  /** The top-level rows, in the server's order: a loose chat, or a folder with its chats whole. */
  items: SimpleListItem[];
  /** `flattenChats(items)`: what the picker lists and what "is the open chat loaded" asks. */
  rows: RecentConversationListItem[];
  /** Top-level rows the server holds, which is one per folder however many chats it carries. */
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  hasError: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  patchLocal: (
    sessionId: string,
    patch: Partial<Pick<RecentConversationListItem, 'sessionTitle' | 'icon'>>,
  ) => void;
  patchFolderLocal: (folderId: string, patch: Partial<Pick<SimpleListFolder, 'name' | 'collapsed'>>) => void;
  removeLocal: (sessionId: string) => void;
  moveLocal: (item: SimpleListItemRef, position: SimpleListPosition) => void;
} {
  const { subscribe } = useWebSocket();

  // The simple list's tree: the top-level rows as the feed spells them. It is the only state the feed
  // holds, so every edit has one home and every derived fact (the flat rows, the total, a removal)
  // reads the same shape — there is no second list that could disagree with it.
  const [items, setItems] = useState<SimpleListItem[]>([]);
  // The server's count of TOP-LEVEL rows, independent of how many are loaded: a folder counts once.
  const [total, setTotal] = useState(0);
  // Whether the server holds more top-level rows past the ones currently loaded.
  const [hasMore, setHasMore] = useState(false);
  // True only while the FIRST fetch is in flight; loadMore does not touch this.
  const [isLoading, setIsLoading] = useState(true);
  // True when the last fetch failed; cleared by the next attempt.
  const [hasError, setHasError] = useState(false);

  // What the picker lists and what "is the open chat loaded" asks: every chat of the tree, flat, in
  // drawn order — a folder's chats in the folder's place, folded or not.
  const rows = useMemo(() => flattenChats(items), [items]);

  // Guards a slow, stale response from clobbering a fresher one that resolved first.
  const requestSeqRef = useRef(0);
  // Read inside the debounced websocket callback, the reload's own page size and the "missing
  // selection" effect below, all of which must see the current tree without re-running on every
  // change to it.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const fetchPage = useCallback(async (offset: number, limit: number, append: boolean) => {
    const requestSequence = ++requestSeqRef.current;
    if (!append) setIsLoading(true);
    setHasError(false);

    try {
      const response = await api.recentConversations({ limit, offset, simpleList: true });
      if (!response.ok) {
        throw new Error(`Failed to load the simple chat list: ${response.status}`);
      }
      const payload = (await response.json()) as RecentConversationsPayload;
      const conversations = Array.isArray(payload.data?.conversations) ? payload.data.conversations : [];
      const layout = Array.isArray(payload.data?.layout) ? payload.data.layout : [];
      const page = treeFromFeed(conversations, layout);

      if (requestSequence !== requestSeqRef.current) return;

      // A first page or a reload REPLACES the tree: the page is the list as the server holds it, and
      // anything a local write did since is exactly what re-reading it exists to settle.
      setItems((previous) => (append ? appendPage(previous, page) : page));
      setTotal(Number(payload.data?.total ?? page.length));
      setHasMore(Boolean(payload.data?.hasMore));
    } catch (error) {
      if (requestSequence !== requestSeqRef.current) return;
      console.error('[SidebarSimpleList] Failed to load the simple chat list:', error);
      setHasError(true);
    } finally {
      if (requestSequence === requestSeqRef.current) setIsLoading(false);
    }
  }, []);

  // Asks for every top-level row the list already holds, so a reload never shrinks it, and asks no
  // more than the route's ceiling — a list that grew past it keeps the rest one `loadMore` away.
  const reload = useCallback(
    () => fetchPage(0, Math.min(MAX_RELOAD_ROWS, Math.max(PAGE_SIZE, itemsRef.current.length)), false),
    [fetchPage],
  );

  const loadMore = useCallback(
    () => fetchPage(itemsRef.current.length, PAGE_SIZE, true),
    [fetchPage],
  );

  // The initial fetch: on mount when enabled, or the moment it turns on. `fetchPage` is stable, so
  // `enabled` is the only thing that ever re-runs this.
  useEffect(() => {
    if (!enabled) return;
    void fetchPage(0, PAGE_SIZE, false);
  }, [enabled, fetchPage]);

  // A row in this feed may have just been created, retitled or bumped to the top; a folder may have
  // been made, renamed, folded, moved or deleted, or a chat moved between places or folders. Either
  // frame says the server's list may no longer be the one on screen, so the page is re-read.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe((event) => {
      if (event?.kind !== 'session_upserted' && event?.kind !== 'simple_list_changed') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void reload();
      }, RELOAD_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, subscribe, reload]);

  // The open chat may be one this page hasn't paged in yet. Reload at most once per id: if it
  // is still missing afterwards (a session outside this feed entirely), retrying on every
  // render would loop forever instead of settling.
  const attemptedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !selectedSessionId) return;
    if (rows.some((row) => row.sessionId === selectedSessionId)) return;
    if (attemptedForRef.current === selectedSessionId) return;
    attemptedForRef.current = selectedSessionId;
    void reload();
  }, [enabled, selectedSessionId, rows, reload]);

  // The optimistic write behind a rename and an icon pick: the chat shows the change at once and
  // the server's own `session_upserted` refetch confirms it a moment later. `patchChat` merges
  // rather than replaces, keeping every field the patch does not name — a replaced row would drop
  // the project label and the activity stamp the row still renders — and it finds the chat wherever
  // it sits, at the top level or in a folder. `unread` is deliberately outside the patch type: it is
  // the server's answer to a completed run, never a client's guess.
  const patchLocal = useCallback(
    (sessionId: string, patch: Partial<Pick<RecentConversationListItem, 'sessionTitle' | 'icon'>>) => {
      setItems((previous) => patchChat(previous, sessionId, patch));
    },
    [],
  );

  // The optimistic write behind a folder's own edits (a rename, a fold): the header shows the change
  // at once and the `simple_list_changed` refetch confirms it a moment later.
  const patchFolderLocal = useCallback(
    (folderId: string, patch: Partial<Pick<SimpleListFolder, 'name' | 'collapsed'>>) => {
      setItems((previous) => patchFolder(previous, folderId, patch));
    },
    [],
  );

  // What an instance does when a row leaves the feed: only an instance that holds the row loses it, so
  // the total of one that never paged it in is left alone — and only a row AT THE TOP LEVEL lowers it,
  // because a chat inside a folder was never one of the rows `total` counts.
  //
  // The ref is written BEFORE the setter so a second removal in the same tick reads THIS one's result.
  // `itemsRef.current` is otherwise the render-time snapshot: both calls would compute from it, React
  // would apply the second `setItems` over the first — resurrecting the chat the first removed — while
  // both functional `setTotal` decrements still landed, row and counter disagreeing.
  const dropRow = useCallback((sessionId: string) => {
    const landed = removeChat(itemsRef.current, sessionId);
    if (landed === null) return;
    itemsRef.current = landed.items;
    setItems(landed.items);
    if (landed.wasTopLevel) setTotal((previous) => Math.max(0, previous - 1));
  }, []);

  useEffect(() => {
    removalListeners.add(dropRow);
    return () => {
      removalListeners.delete(dropRow);
    };
  }, [dropRow]);

  const removeLocal = useCallback((sessionId: string) => {
    removalListeners.forEach((listener) => listener(sessionId));
  }, []);

  // The optimistic write behind a drag: the row lands where it was dropped at once, and the
  // `simple_list_changed` refetch confirms the order a moment later. `moveItem` answers the SAME
  // tree when the row, the folder or the anchor is not in it, so a position the tree cannot honour
  // changes nothing rather than guessing at it — a missing anchor must never quietly mean "the top".
  const moveLocal = useCallback((item: SimpleListItemRef, position: SimpleListPosition) => {
    setItems((previous) => moveItem(previous, item, position));
  }, []);

  return {
    items,
    rows,
    total,
    hasMore,
    isLoading,
    hasError,
    reload,
    loadMore,
    patchLocal,
    patchFolderLocal,
    removeLocal,
    moveLocal,
  };
}
