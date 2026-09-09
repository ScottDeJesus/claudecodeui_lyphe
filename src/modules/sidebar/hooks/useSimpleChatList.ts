import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { RecentConversationListItem } from '@/shared/types';

type RecentConversationsPayload = {
  success?: boolean;
  data?: {
    conversations?: RecentConversationListItem[];
    total?: number;
    hasMore?: boolean;
  };
};

/** The page size for both the first fetch and `loadMore`. */
const PAGE_SIZE = 20;

/**
 * How long a burst of `session_upserted` frames is coalesced into one refetch. A run in
 * progress can upsert its own row several times a second; without this every frame would
 * fire its own request.
 */
const RELOAD_DEBOUNCE_MS = 500;

/**
 * The paginated, server-tagged feed behind SidebarSimpleList: `api.recentConversations` called
 * with `simpleList: true`, which is the ONLY source that knows which sessions were started from
 * this view — the tree's `projects[].sessions` arrays never carry the tag.
 *
 * The pager idiom (request-sequence guard, append-time dedupe by sessionId) mirrors
 * `useSidebarController.ts`'s `fetchRecentConversationsPage` on purpose: this hook is a second
 * copy of that seam until the controller is split, and the two are meant to stay recognisably
 * one shape.
 */
export function useSimpleChatList(selectedSessionId: string | null): {
  rows: RecentConversationListItem[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  hasError: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  renameLocal: (sessionId: string, title: string) => void;
  removeLocal: (sessionId: string) => void;
} {
  const { subscribe } = useWebSocket();

  // The simple list's own page of rows, newest-tagged-first (the server's sort key).
  const [rows, setRows] = useState<RecentConversationListItem[]>([]);
  // The server's total count for the tagged feed, independent of how many rows are loaded.
  const [total, setTotal] = useState(0);
  // Whether the server holds more rows past the ones currently loaded.
  const [hasMore, setHasMore] = useState(false);
  // True only while the FIRST fetch is in flight; loadMore does not touch this.
  const [isLoading, setIsLoading] = useState(true);
  // True when the last fetch failed; cleared by the next attempt.
  const [hasError, setHasError] = useState(false);

  // Guards a slow, stale response from clobbering a fresher one that resolved first.
  const requestSeqRef = useRef(0);
  // Read inside the debounced websocket callback and the "missing selection" effect below,
  // both of which must see the current rows without re-subscribing on every row change.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

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

      if (requestSequence !== requestSeqRef.current) return;

      setRows((previous) => {
        if (!append) return conversations;
        const existingIds = new Set(previous.map((row) => row.sessionId));
        return [...previous, ...conversations.filter((row) => !existingIds.has(row.sessionId))];
      });
      setTotal(Number(payload.data?.total ?? conversations.length));
      setHasMore(Boolean(payload.data?.hasMore));
    } catch (error) {
      if (requestSequence !== requestSeqRef.current) return;
      console.error('[SidebarSimpleList] Failed to load the simple chat list:', error);
      setHasError(true);
    } finally {
      if (requestSequence === requestSeqRef.current) setIsLoading(false);
    }
  }, []);

  const reload = useCallback(
    () => fetchPage(0, Math.max(PAGE_SIZE, rowsRef.current.length), false),
    [fetchPage],
  );

  const loadMore = useCallback(
    () => fetchPage(rowsRef.current.length, PAGE_SIZE, true),
    [fetchPage],
  );

  // The initial fetch.
  useEffect(() => {
    void fetchPage(0, PAGE_SIZE, false);
    // fetchPage is stable (empty deps); this is mount-only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A row in this feed may have just been created, retitled or bumped to the top.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe((event) => {
      if (event?.kind !== 'session_upserted') return;
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
  }, [subscribe, reload]);

  // The open chat may be one this page hasn't paged in yet. Reload at most once per id: if it
  // is still missing afterwards (a session outside this feed entirely), retrying on every
  // render would loop forever instead of settling.
  const attemptedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedSessionId) return;
    if (rows.some((row) => row.sessionId === selectedSessionId)) return;
    if (attemptedForRef.current === selectedSessionId) return;
    attemptedForRef.current = selectedSessionId;
    void reload();
  }, [selectedSessionId, rows, reload]);

  const renameLocal = useCallback((sessionId: string, title: string) => {
    setRows((previous) => previous.map((row) => (
      row.sessionId === sessionId ? { ...row, sessionTitle: title } : row
    )));
  }, []);

  const removeLocal = useCallback((sessionId: string) => {
    setRows((previous) => previous.filter((row) => row.sessionId !== sessionId));
    setTotal((previous) => Math.max(0, previous - 1));
  }, []);

  return { rows, total, hasMore, isLoading, hasError, reload, loadMore, renameLocal, removeLocal };
}
