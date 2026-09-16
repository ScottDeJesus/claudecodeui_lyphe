import type { KanbanCardSummary, KanbanLaneCount, KanbanStatus } from '@/shared/kanban-types';

/**
 * WHAT ONE LANE HOLDS, AND THE THREE THINGS DONE TO IT — the pure half of the lanes hook.
 *
 * Every function here is total and side-effect free: it takes a lane's summaries and answers with
 * the summaries it now has. That is deliberate, because there are THREE writers of the same lane —
 * a first page, a returned write, and a websocket frame that arrived first — and if each one
 * rewrote the list its own way, the board would show whichever happened to run last. The hook owns
 * the state; the ordering rules live here, in one place, for all three.
 */

/** One lane's page state. */
export type LaneState = {
  summaries: KanbanCardSummary[];
  /** The keyset position of the last page read, or `null` at the end of the lane. */
  cursor: string | null;
  hasMore: boolean;
  /** Page ONE is in flight. Distinct from `loadingMore`, which appends rather than replaces. */
  loading: boolean;
  loadingMore: boolean;
  /**
   * The FIRST page never arrived. The lane is not empty — it is UNREAD — and the two are not the
   * same news: an empty lane is a fact about the board, and this is a fact about the request.
   *
   * It is RECORDED here so the board can read it and say so: a lane painted as empty is a lane
   * with an "Add card" action over work that exists, and the kit gives a lane of no cards no
   * control of its own to try again with. `useKanbanLaneFeed` derives the board's `unreachable`
   * from this field, which is what puts the reader in front of the retry.
   */
  failed: boolean;
};

/** What a lane holds before its first page arrives. A failure is this state plus `failed`. */
export const EMPTY_LANE: LaneState = {
  summaries: [],
  cursor: null,
  hasMore: false,
  loading: false,
  loadingMore: false,
  failed: false,
};

/**
 * One card's place in a lane's list, by the ordering the SERVER would have used: newest first, or
 * `sort_order` ascending with the id as the tiebreak the API also breaks ties with.
 *
 * The card is taken OUT and put back, so calling this twice with the same card is a move and not a
 * duplicate — which is what makes it safe for the write's return and the frame that follows it.
 */
export function place(summaries: KanbanCardSummary[], card: KanbanCardSummary, newestFirst: boolean): KanbanCardSummary[] {
  const rest = summaries.filter((held) => held.id !== card.id);
  if (newestFirst) return [card, ...rest];

  const ahead = rest.findIndex(
    (held) => held.sortOrder > card.sortOrder || (held.sortOrder === card.sortOrder && held.id > card.id)
  );

  return ahead < 0 ? [...rest, card] : [...rest.slice(0, ahead), card, ...rest.slice(ahead)];
}

/**
 * Removes a card from every lane, keeping each lane's object identity when nothing was removed.
 *
 * Identity is the point: the caller re-renders a lane per changed reference, and a card moving
 * inside one lane must not re-render the three it was never in.
 */
export function without(
  lanes: Record<string, LaneState>,
  cardId: string
): { next: Record<string, LaneState>; removed: boolean } {
  const next: Record<string, LaneState> = {};
  let removed = false;

  for (const [laneId, state] of Object.entries(lanes)) {
    const kept = state.summaries.filter((card) => card.id !== cardId);
    next[laneId] = kept.length === state.summaries.length ? state : { ...state, summaries: kept };
    if (next[laneId] !== state) removed = true;
  }

  return { next, removed };
}

/**
 * A lane's total: the SUM of the per-status rows its spec covers, because the server counts five
 * statuses and never learns that a lane is a set of two of them.
 */
export function sumOf(counts: KanbanLaneCount[] | null, statuses: KanbanStatus[]): number {
  if (!counts) return 0;
  return counts.filter((row) => statuses.includes(row.status)).reduce((total, row) => total + row.total, 0);
}
