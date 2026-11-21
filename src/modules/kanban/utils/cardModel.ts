import type { KanbanCardSummary, KanbanPriority } from '@/shared/kanban-types';

/**
 * THE ORDER A LANE'S LOADED CARDS ARE READ IN. The board's rings draw every lane in the server's own order (`server`, the keyset
 * page the API returned), and a move resolves against that order; the two other sorts remain for a reader that asks a lane's ids
 * in another order (`useKanbanLanes`' `cardIds`).
 */
export type KanbanViewSort = 'server' | 'priority' | 'newest';

/** Higher wins: the ladder a card's priority reads as, as a number, for the priority sort. */
const PRIORITY_RANK: Record<KanbanPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * The lane's loaded cards in the order a requested view reads them — a VIEW over the pages
 * already held, never a refetch, because the keyset cursor walks the SERVER's order and a fetch
 * per sort would page a lane in an order its cursor does not know.
 *
 * `server` hands the array straight back: a copy would re-key every card on every render.
 */
export function sortSummaries(summaries: KanbanCardSummary[], sort: KanbanViewSort): KanbanCardSummary[] {
  if (sort === 'server') return summaries;

  // `Array.prototype.sort` is stable, so cards equal on the sort key keep the lane's own order.
  return [...summaries].sort((left, right) => {
    if (sort === 'newest') return right.updatedAt.localeCompare(left.updatedAt);
    return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  });
}
