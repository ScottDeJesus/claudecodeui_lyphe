import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';

import type { KanbanCardSummary, KanbanLaneCount, KanbanVitals } from '@/shared/kanban-types';
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
 * THE BOARD'S VITALS, PUBLISHED FOR THE STRIP IN THE HEADER.
 *
 * The strip stands in the board header and is handed ONE thing — the board's id — because that
 * header calls no hook and the panel hands it no counts. So the reading made below cannot travel
 * down a prop chain to it: the feed PUBLISHES, and the strip LISTENS through `useBoardVitals`.
 * `chat/subagents/subagentSource.ts` and `chat/embeds/embedSource.ts` are the same shape, for the
 * same problem — one component telling another something neither of them owns.
 *
 * ONE SLOT, because one board is open at a time, TAGGED with the id it belongs to. A board switch
 * that leaves the old reading standing for a moment is then refused by IDENTITY and not by timing:
 * six counts belong to a board, and the one thing the strip must never do is draw the last board's
 * numbers against this board's name.
 *
 * AND NOTHING PUBLISHES FOR A BOARD NOBODY HAS OPEN. A read is asked about one board and the server
 * answers a moment later; if the reader has moved on in between, that answer is DROPPED where it
 * lands rather than written under its own id. Without the drop a slow answer for the board just
 * left could win the slot LAST, and the strip — refusing it by identity — would fall back to
 * em-dashes that breathe, the one shape it uses to say "a reading is on its way", about a reading
 * that had already been and gone.
 *
 * The value deliberately does NOT become this hook's returned state. A vitals read lands on the
 * frame of every board write — a card moved, a question answered, a lesson reviewed — and a
 * `setState` here would repaint the panel, the rail and every card on screen for six numbers that
 * only the strip draws.
 */
type PublishedVitals = { boardId: string; vitals: KanbanVitals | null; loading: boolean };

/** The published reading, or null when no board has one. Replaced wholesale, never mutated. */
let publishedVitals: PublishedVitals | null = null;

const vitalsListeners = new Set<() => void>();

function readVitalsSnapshot(): PublishedVitals | null {
  return publishedVitals;
}

function subscribeVitals(listener: () => void): () => void {
  vitalsListeners.add(listener);
  return () => {
    vitalsListeners.delete(listener);
  };
}

/** REPLACED, never merged, and taken whole by every reader: one publication equal to the one held —
 *  the same board, the same `loading`, the same counts object — changes nothing and wakes nobody.
 *  A read that answers with the same numbers still publishes, which repaints one small strip and
 *  nothing else on the board. */
function publishVitals(next: PublishedVitals | null): void {
  const held = publishedVitals;
  if (held === next) return;
  if (
    held &&
    next &&
    held.boardId === next.boardId &&
    held.vitals === next.vitals &&
    held.loading === next.loading
  ) {
    return;
  }
  publishedVitals = next;
  for (const listener of vitalsListeners) listener();
}

/** No board open: a reading nobody has. One shared value, so nothing downstream re-renders on
 *  every call of the hook below. */
const NO_BOARD_VITALS: { vitals: KanbanVitals | null; loading: boolean } = { vitals: null, loading: false };

/** A board IS open and its reading has not landed: em-dashes that are on their way, and the strip
 *  breathes them so they cannot be read as a board with nothing pending. */
const FIRST_BOARD_VITALS: { vitals: KanbanVitals | null; loading: boolean } = { vitals: null, loading: true };

/**
 * The open board's vitals, for the strip in the header. A reading belonging to another board — or
 * to no board at all — is nothing, and this is the only place that is decided.
 */
export function useBoardVitals(boardId: string | null): { vitals: KanbanVitals | null; loading: boolean } {
  const held = useSyncExternalStore(subscribeVitals, readVitalsSnapshot);
  if (boardId === null) return NO_BOARD_VITALS;
  if (held === null || held.boardId !== boardId) return FIRST_BOARD_VITALS;
  return held;
}

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

  /**
   * The board's vitals, read beside the counts above and PUBLISHED rather than held (see the store
   * at the top of this file): the strip in the header listens to them, and this hook's own state
   * would repaint the whole board for six numbers it does not draw.
   *
   * ONE READ IN FLIGHT AT A TIME, and a frame that arrives during one leaves a mark instead of
   * opening a second. A busy board emits its frames in bursts, and a burst must cost the read
   * already on the wire plus at most one more — never one request per frame. (A board SWITCH is the
   * one case that does not queue: the new board is read at once, because waiting for the answer to
   * a question about the board just left would leave the strip blank for no reason.) Never a timer
   * of its own either: the frame IS the signal, and it is the only clock this read has — a poll
   * would be a second reading of a board that already announces every write.
   */
  /** The board whose read is on the wire, or `null`. By ID rather than a flag, so that a read which
   *  finds a board switch has happened under it leaves the newer read's claim alone. */
  const vitalsReadingRef = useRef<string | null>(null);
  /** The board a frame asked for while a read was in flight, or `null`. */
  const vitalsAgainRef = useRef<string | null>(null);

  /**
   * THE ONE DOOR A READING LEAVES BY. A read answers for the board it was asked about, and a board
   * the reader has since LEFT gets nothing from it — see the store at the top of this file for why
   * that is not a nicety but the difference between em-dashes that mean "on its way" and em-dashes
   * that mean nothing of the kind. Every publication below passes through here, so no path can
   * forget the check.
   */
  const publishForCurrent = useCallback((id: string, vitals: KanbanVitals | null, loading: boolean) => {
    if (latestRef.current.boardId !== id) return;
    publishVitals({ boardId: id, vitals, loading });
  }, []);

  const readVitals = useCallback(async (id: string) => {
    vitalsReadingRef.current = id;
    // Reading, with whatever was already known about THIS board still on screen: six counts that
    // flickered to em-dashes on every frame would be a strip nobody could read.
    const held = publishedVitals;
    const known = held && held.boardId === id ? held.vitals : null;
    // `loading` is the FIRST reading and nothing else — the only state in which the strip draws its
    // em-dashes breathing. A re-read of a board whose numbers are already up publishes exactly those
    // numbers, which the store's own comparison drops: a frame does not so much as repaint it.
    publishForCurrent(id, known, known === null);

    try {
      const body = await readApiJson<{ vitals: KanbanVitals }>(await api.kanban.vitals(id));
      publishForCurrent(id, body.vitals, false);
    } catch (error) {
      // A reading nobody has — the em-dash, never the numbers from before. Two of these six
      // registers park a build on a person, and an amber count the reader cannot act on is worse
      // than an honest blank; the next frame asks again.
      console.warn(`[useKanbanLaneFeed] the vitals of board "${id}" could not be read:`, error);
      publishForCurrent(id, null, false);
    } finally {
      // Only the read that owns the claim releases it: a board switch puts a second read in flight,
      // and the older one finishing must not tell the newer one it is free to be duplicated.
      if (vitalsReadingRef.current === id) vitalsReadingRef.current = null;
      // The frame asked for a BOARD, not for a read, so the mark carries that board's id — and only
      // a board still open has anything to do with it.
      const again = vitalsAgainRef.current;
      vitalsAgainRef.current = null;
      if (again !== null && again === latestRef.current.boardId) void readVitals(again);
    }
  }, [publishForCurrent]);

  /** The coalescing door every frame goes through: the read already on the wire is the one that
   *  will answer, and the mark it leaves is taken when it lands. */
  const requestVitals = useCallback((id: string) => {
    if (vitalsReadingRef.current !== null) {
      vitalsAgainRef.current = id;
      return;
    }
    void readVitals(id);
  }, [readVitals]);

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

  // The board's first paint: its per-status totals and its vitals, then one page per lane. All of
  // them are re-read when the board changes — a lane's cards belong to the board, not to the panel.
  const laneShape = specs.map((spec) => `${spec.id}:${spec.statuses.join(',')}`).join('|');

  useEffect(() => {
    if (!boardId) return undefined;

    let cancelled = false;

    const begin = async () => {
      setLoading(true);
      await Promise.all([readCounts(boardId), readVitals(boardId)]);
      if (cancelled) return;

      await Promise.all(latestRef.current.specs.map((spec) => readFirstPage(boardId, spec)));
      if (cancelled || !mountedRef.current) return;
      setLoading(false);
    };

    void begin();
    return () => {
      cancelled = true;
    };
  }, [boardId, laneShape, readCounts, readVitals, readFirstPage]);

  const refresh = useCallback(async () => {
    const id = latestRef.current.boardId;
    if (!id) return;

    setLoading(true);
    await Promise.all([readCounts(id), readVitals(id)]);
    await Promise.all(latestRef.current.specs.map((spec) => readFirstPage(id, spec)));
    if (mountedRef.current) setLoading(false);
  }, [readCounts, readVitals, readFirstPage]);

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

  const applyCounts = useCallback((rows: KanbanLaneCount[]) => {
    setCounts(rows);
    // A frame is the ONLY signal the six registers can have moved, and it arrives AFTER the write
    // that moved them: the card that changed may have left `building` and moved work into a
    // person's queue, and the two estate counts move whenever anybody reviews a lesson or a
    // memory. So the vitals are read again behind it — coalesced, and never on a timer, because
    // this frame is the whole of what says a reading is now stale.
    const id = latestRef.current.boardId;
    if (id) requestVitals(id);
  }, [requestVitals]);

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
