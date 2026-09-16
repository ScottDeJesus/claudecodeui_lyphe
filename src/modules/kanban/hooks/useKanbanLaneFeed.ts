import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import type { KanbanCardSummary, KanbanLaneCount } from '@/shared/kanban-types';
import { api, readApiJson } from '@/shared/api';
import { EMPTY_LANE, place, without, type LaneState } from '@/modules/kanban/utils/laneData';
import type { KanbanLaneSpec } from '@/modules/kanban/utils/lanePolicy';

/**
 * THE LANE FEED: what every lane holds, how it is paged, and the write path every card arrives
 * through — a page's own row, a returned write, or the websocket frame that follows it.
 *
 * A lane is a SET of statuses, so its first page — and every page after it — is ONE keyset page over
 * `spec.statuses`, asked for with the whole array. Asking a lane for a single status is what makes a
 * questions card vanish from To Do the moment autonomy goes off, and it is the single mistake this
 * file exists to make impossible.
 *
 * THE FRAME IS APPLIED, NEVER OBEYED BY REFETCHING, and `applyCard` is where that happens: the
 * `kanban_event` carries the affected card fresh, so the one card is inserted, updated or removed in
 * place instead of the lane being read again. The subscription itself is the lanes hook's — this
 * file holds the state it writes into.
 *
 * The summaries are what is held — not the view models — because a frame's card has to be placed by
 * its STATUS, which the view model deliberately does not carry. The ordering rules are in
 * `utils/laneData`, because THREE writers put cards into the same lane: a page, a returned write,
 * and the frame that follows it.
 */

/** One page of a lane, as the API shapes it. */
type LanePageBody = { cards: KanbanCardSummary[]; nextCursor: string | null };

/** No lanes at all — one shared empty map, so "there is no board" is a stable value, not a new one. */
const NO_LANES: Record<string, LaneState> = {};

export type KanbanLaneFeed = {
  /** The summaries per lane, keyed by the spec's own id. */
  lanes: Record<string, LaneState>;
  /** The same map, for callbacks that must not be rebuilt around it. */
  lanesRef: MutableRefObject<Record<string, LaneState>>;
  /** Per-status totals for the whole board, or `null` before they land — never an empty list. */
  counts: KanbanLaneCount[] | null;
  loading: boolean;
  /** A board that could not be read — its counts, or the first page of one of its lanes. Different
   *  news from a board with no cards, and carried to the panel's retry. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  loadMore: (laneId: string) => Promise<void>;
  /** Puts one card where its status says it belongs: the websocket frame's own write path. */
  applyCard: (card: KanbanCardSummary | null) => void;
  /** Replaces the per-status totals — what a frame carries for the whole board at once. */
  applyCounts: (rows: KanbanLaneCount[]) => void;
  /** The optimistic half of a move, before the server has answered; `applyCard` reconciles it. */
  applyCardMove: (card: KanbanCardSummary, laneId: string, position: number) => void;
};

/**
 * Called ONCE, by the lanes hook, with the board and the lanes `kanbanLanes(autonomy)` composed.
 * It knows nothing about autonomy: which statuses a lane covers is the spec's business.
 */
export function useKanbanLaneFeed(boardId: string | null, specs: KanbanLaneSpec[]): KanbanLaneFeed {
  const [lanes, setLanes] = useState<Record<string, LaneState>>({});
  // `null` until the counts arrive: the kit renders `—` for a lane with no count yet, and `0` would
  // be a claim the board is empty before anyone has asked.
  const [counts, setCounts] = useState<KanbanLaneCount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The values a callback must read WITHOUT being rebuilt around them: the websocket listener is
  // created once and lives until unmount, and it has to see the board and the lanes as they are now
  // rather than as they were when it subscribed.
  const lanesRef = useRef(lanes);
  const latestRef = useRef({ boardId, specs });
  useEffect(() => {
    lanesRef.current = lanes;
    latestRef.current = { boardId, specs };
  });

  const readCounts = useCallback(async (id: string) => {
    try {
      const body = await readApiJson<{ lanes: KanbanLaneCount[] }>(await api.kanban.lanes(id));
      if (!mountedRef.current) return;
      setCounts(Array.isArray(body.lanes) ? body.lanes : []);
      setUnreachable(false);
    } catch (error) {
      console.warn('[useKanbanLaneFeed] the lane counts could not be read:', error);
      if (mountedRef.current) setUnreachable(true);
    }
  }, []);

  const readFirstPage = useCallback(async (id: string, spec: KanbanLaneSpec) => {
    setLanes((held) => ({ ...held, [spec.id]: { ...(held[spec.id] ?? EMPTY_LANE), loading: true } }));

    try {
      const body = await readApiJson<LanePageBody>(await api.kanban.laneCards(id, spec.statuses, null));
      if (!mountedRef.current) return;
      setLanes((held) => ({
        ...held,
        [spec.id]: {
          summaries: Array.isArray(body.cards) ? body.cards : [],
          cursor: body.nextCursor ?? null,
          hasMore: body.nextCursor !== null,
          loading: false,
          loadingMore: false,
          failed: false,
        },
      }));
    } catch (error) {
      // A LANE WHOSE PAGE FAILED IS AN UNREAD LANE, NOT AN EMPTY ONE, and painting the two the same
      // is the lie this branch refuses. The kit draws an empty lane as "Nothing here yet" with an
      // "Add card" action — over work that is there — and it gives a lane of no cards no control of
      // its own with which to try again. So the failure is RECORDED here, and the board reads the
      // record to decide what the reader is shown (`unreachable`, and the panel's Retry).
      //
      // The lane is left holding nothing rather than a stale page: a card on screen that the
      // server has since moved is worse than an honest gap, and the retry fills it either way.
      console.warn(`[useKanbanLaneFeed] lane "${spec.id}" could not be read:`, error);
      if (mountedRef.current) setLanes((held) => ({ ...held, [spec.id]: { ...EMPTY_LANE, failed: true } }));
    }
  }, []);

  // The board's first paint: its per-status totals, then one page per lane. Both are re-read when
  // the board changes — a lane's cards belong to the board, not to the panel.
  const laneShape = specs.map((spec) => `${spec.id}:${spec.statuses.join(',')}`).join('|');

  useEffect(() => {
    if (!boardId) return undefined;

    let cancelled = false;

    const begin = async () => {
      setLoading(true);
      await readCounts(boardId);
      if (cancelled) return;

      await Promise.all(latestRef.current.specs.map((spec) => readFirstPage(boardId, spec)));
      if (cancelled || !mountedRef.current) return;
      setLoading(false);
    };

    void begin();
    return () => {
      cancelled = true;
    };
  }, [boardId, laneShape, readCounts, readFirstPage]);

  const refresh = useCallback(async () => {
    const id = latestRef.current.boardId;
    if (!id) return;

    setLoading(true);
    await readCounts(id);
    await Promise.all(latestRef.current.specs.map((spec) => readFirstPage(id, spec)));
    if (mountedRef.current) setLoading(false);
  }, [readCounts, readFirstPage]);

  const loadMore = useCallback(async (laneId: string) => {
    const id = latestRef.current.boardId;
    const spec = latestRef.current.specs.find((candidate) => candidate.id === laneId);
    const state = lanesRef.current[laneId];

    // One page at a time: the sentinel and the Load more button both reach this, and two requests
    // racing one cursor would append the same page twice.
    if (!id || !spec || !state || state.loadingMore || state.cursor === null || !state.hasMore) return;

    setLanes((held) => ({ ...held, [laneId]: { ...held[laneId], loadingMore: true } }));

    try {
      const body = await readApiJson<LanePageBody>(await api.kanban.laneCards(id, spec.statuses, state.cursor));
      if (!mountedRef.current) return;
      setLanes((held) => {
        const current = held[laneId] ?? EMPTY_LANE;
        // A card another write moved between this page and the last one is filtered out rather than
        // painted twice: the keyset is a position, and a position can be revisited.
        const attached = new Set(current.summaries.map((card) => card.id));
        const appended = (body.cards ?? []).filter((card) => !attached.has(card.id));

        return {
          ...held,
          [laneId]: {
            summaries: [...current.summaries, ...appended],
            cursor: body.nextCursor ?? null,
            hasMore: body.nextCursor !== null,
            loading: false,
            loadingMore: false,
            // The lane has been read from its start, so whatever went wrong before is behind it.
            failed: false,
          },
        };
      });
    } catch (error) {
      // A page that failed to APPEND is not a lane that failed to load: the cards already on
      // screen are still true, so the lane keeps them and its tail control stays for another press.
      console.warn(`[useKanbanLaneFeed] the next page of lane "${laneId}" could not be read:`, error);
      if (mountedRef.current) setLanes((held) => ({ ...held, [laneId]: { ...held[laneId], loadingMore: false } }));
    }
  }, []);

  /** ONE CARD, PLACED — shared by both callers: the websocket frame, and the write that returns
   *  before the frame does. */
  const applyCard = useCallback((card: KanbanCardSummary | null) => {
    if (!card) return;

    setLanes((held) => {
      const { next, removed } = without(held, card.id);
      // An archived card is gone from the board; the filter above is the whole of its removal.
      if (card.archived) return removed ? next : held;

      const spec = latestRef.current.specs.find((candidate) => candidate.statuses.includes(card.status));
      if (!spec) return removed ? next : held;

      const lane = next[spec.id] ?? EMPTY_LANE;
      next[spec.id] = { ...lane, summaries: place(lane.summaries, card, spec.newestFirst) };
      return next;
    });
  }, []);

  const applyCardMove = useCallback((card: KanbanCardSummary, laneId: string, position: number) => {
    setLanes((held) => {
      if (!held[laneId]) return held;

      const { next } = without(held, card.id);
      const lane = next[laneId];
      const bounded = Math.max(0, Math.min(position, lane.summaries.length));

      next[laneId] = {
        ...lane,
        summaries: [...lane.summaries.slice(0, bounded), card, ...lane.summaries.slice(bounded)],
      };
      return next;
    });
  }, []);

  const applyCounts = useCallback((rows: KanbanLaneCount[]) => setCounts(rows), []);

  /**
   * A LANE THAT COULD NOT BE READ IS THE BOARD'S NEWS AFTER ALL.
   *
   * `unreachable` started as the board-level read's own flag, and a lane's first page failing sits
   * on the same side of the line as it: the counts arrived, but the cards behind one of them did
   * not, and the lane the reader is looking at cannot be believed. The alternative the kit leaves
   * is the one this refuses — a lane painted as empty, with an "Add card" action over work that is
   * there, and not a control anywhere on the screen that could fetch it again.
   *
   * It is DERIVED from the lanes rather than kept as a second piece of state, so it cannot fall
   * out of step with them: `refresh` re-reads every lane's first page, and the flag clears the
   * moment the lanes do. The panel's unreachable state carries the Retry that does it.
   */
  const laneFailed = boardId !== null && Object.values(lanes).some((state) => state.failed);

  // WITH NO BOARD THERE IS NOTHING TO SHOW, and that is DERIVED rather than cleared into state: a
  // reset written from the effect above would be a write during a render pass, and a read still in
  // flight when the board went away would leave a spinner the reader could not get out of.
  return {
    lanes: boardId ? lanes : NO_LANES,
    lanesRef,
    counts: boardId ? counts : null,
    loading: boardId !== null && loading,
    unreachable: unreachable || laneFailed,
    refresh,
    loadMore,
    applyCard,
    applyCounts,
    applyCardMove,
  };
}
