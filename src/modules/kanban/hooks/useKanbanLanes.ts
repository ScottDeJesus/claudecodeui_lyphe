import { useCallback, useEffect, useRef, useState } from 'react';

import type { KanbanBoardEvent, KanbanCardSummary, KanbanStatus } from '@/shared/kanban-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { KanbanCardModel } from '@/shared/ui';
import { useKanbanLaneFeed } from '@/modules/kanban/hooks/useKanbanLaneFeed';
import { sortSummaries, toCardModel, type KanbanViewSort } from '@/modules/kanban/utils/cardModel';
import { EMPTY_LANE, sumOf } from '@/modules/kanban/utils/laneData';
import type { KanbanLaneSpec } from '@/modules/kanban/utils/lanePolicy';

/**
 * THE LANES AS THE BOARD READS THEM: one page of cards per lane, the count on its header, the card
 * the drawer is open on, and THE ONE SUBSCRIPTION that keeps all of it true.
 *
 * THE WIRE IS `useKanbanLaneFeed`'s, which holds what each lane has and the write path into it. Two
 * things live here instead: the view over those summaries — mapped through the single wire-to-view
 * conversion — and the websocket listener, because a board's frames are the board's, not the data's.
 *
 * Called ONCE, by the panel, with the lanes `kanbanLanes(autonomy)` composed. `autonomy` is here for
 * the one thing the lane data cannot answer: whether a card's face carries signals at all. It is
 * passed as a value rather than derived from the specs, because deriving it would be a second
 * reading of the lane policy.
 */

/** One lane as the rail hands it to the kit. */
export type KanbanLaneView = {
  cards: KanbanCardModel[];
  /** Server-side total across the lane's statuses; `null` until the counts land, never `0`. */
  count: number | null;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
};

export type KanbanLanes = {
  laneView: (spec: KanbanLaneSpec, sort?: KanbanViewSort) => KanbanLaneView;
  /** The summed total of a set of statuses: how a lane's count is computed, exposed for the one
   *  other sum the board needs — the cards To Do is holding for an answer. */
  countOf: (statuses: KanbanStatus[]) => number;
  /** The ids in one lane, in the order the lane PAINTS them — including the view sort, so a drop
   *  resolves against the list the reader is looking at rather than the order behind it. */
  cardIds: (laneId: string, sort?: KanbanViewSort) => string[];
  /** The wire summary behind a card id, or null when the board no longer holds it. */
  summaryOf: (cardId: string) => KanbanCardSummary | null;
  loading: boolean;
  /** A board that could not be read — its counts, or a lane's first page. Different news from a
   *  board with no cards, and what puts the panel in front of its Retry. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  loadMore: (laneId: string) => Promise<void>;
  /** The one card the drawer is open on, or null — held here so board and drawer share it. */
  selectedCardId: string | null;
  openCard: (cardId: string | null) => void;
  /**
   * The board's live region: the sentence whoever made the move composed, and a sequence number
   * that changes on EVERY announcement. The number is not decoration — a live region is heard
   * through a change to its DOM, and two moves that compose the same sentence ("moved to Backlog,
   * position 1 of 1", twice) leave the same string in the same place. The region is rebuilt on the
   * number, so the second outcome is spoken rather than silently swallowed as a no-op.
   */
  announcement: { text: string; seq: number };
  announce: (sentence: string) => void;
  /** Puts one card where its status says it belongs: the websocket frame's own write path. */
  applyCard: (card: KanbanCardSummary | null) => void;
  /** The optimistic half of a move, before the server has answered; `applyCard` reconciles it. */
  applyCardMove: (card: KanbanCardSummary, laneId: string, position: number) => void;
};

export function useKanbanLanes(boardId: string | null, specs: KanbanLaneSpec[], autonomy: boolean): KanbanLanes {
  const { subscribe } = useWebSocket();
  const feed = useKanbanLaneFeed(boardId, specs);
  const { lanes, lanesRef, counts, applyCard, applyCounts } = feed;

  // The board the listener filters on, read through a REF so the subscription below can be created
  // once: switching boards must not tear the socket down and build it again.
  const boardRef = useRef(boardId);
  useEffect(() => {
    boardRef.current = boardId;
  }, [boardId]);

  /**
   * THE BOARD'S ONE SUBSCRIPTION, created once and torn down on unmount. It filters on two things
   * and ignores the rest: the frame is a `kanban_event`, and it is about the board this panel has
   * open — the server does no per-user or per-project filtering, so the second test is what keeps
   * another board's writes off this screen.
   *
   * What it does with a frame that passes is APPLY it, never refetch: the card it carries is the row
   * the write produced, and the totals it carries are the board's after the write.
   */
  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.kind !== 'kanban_event') return;

      const frame = event as unknown as KanbanBoardEvent;
      if (!frame || typeof frame.boardId !== 'string') return;
      if (frame.boardId !== boardRef.current) return;

      if (Array.isArray(frame.lanes)) applyCounts(frame.lanes);
      applyCard(frame.card ?? null);
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe, applyCard, applyCounts]);

  // The open card is remembered WITH the board it was opened on. That is what lets a board switch
  // leave it alone without an effect to clear it: a selection made on another board reads as none,
  // because only the board the reader is looking at can have a card open on it.
  const [selection, setSelection] = useState<{ boardId: string | null; cardId: string } | null>(null);
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 });
  const selectedCardId = selection && selection.boardId === boardId ? selection.cardId : null;

  const countOf = useCallback((statuses: KanbanStatus[]): number => sumOf(counts, statuses), [counts]);

  /**
   * One lane, as painted. The count is the SUM of the lane's statuses and the cards are the single
   * wire-to-view conversion applied to the summaries — nothing here decides what a card means.
   */
  const laneView = useCallback(
    (spec: KanbanLaneSpec, sort: KanbanViewSort = 'server'): KanbanLaneView => {
      const state = lanes[spec.id] ?? EMPTY_LANE;

      return {
        cards: sortSummaries(state.summaries, sort).map((summary) => toCardModel(summary, { autonomy })),
        count: counts === null ? null : sumOf(counts, spec.statuses),
        loading: state.loading,
        hasMore: state.hasMore,
        loadingMore: state.loadingMore,
      };
    },
    [lanes, counts, autonomy]
  );

  const cardIds = useCallback(
    (laneId: string, sort: KanbanViewSort = 'server'): string[] =>
      sortSummaries(lanesRef.current[laneId]?.summaries ?? [], sort).map((card) => card.id),
    [lanesRef]
  );

  const summaryOf = useCallback(
    (cardId: string): KanbanCardSummary | null => {
      for (const state of Object.values(lanesRef.current)) {
        const found = state.summaries.find((card) => card.id === cardId);
        if (found) return found;
      }
      return null;
    },
    [lanesRef]
  );

  const openCard = useCallback(
    (cardId: string | null) => setSelection(cardId === null ? null : { boardId, cardId }),
    [boardId]
  );
  const announce = useCallback(
    (sentence: string) => setAnnouncement((held) => ({ text: sentence, seq: held.seq + 1 })),
    []
  );

  return {
    laneView,
    countOf,
    cardIds,
    summaryOf,
    loading: feed.loading,
    unreachable: feed.unreachable,
    refresh: feed.refresh,
    loadMore: feed.loadMore,
    selectedCardId,
    openCard,
    announcement,
    announce,
    applyCard,
    applyCardMove: feed.applyCardMove,
  };
}
