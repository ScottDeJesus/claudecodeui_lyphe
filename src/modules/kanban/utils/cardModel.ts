import type { KanbanCardSummary } from '@/shared/kanban-types';
import type { CardPriority, KanbanCardModel, KanbanCardSignals } from '@/shared/ui';

/**
 * THE ONE WIRE-TO-VIEW CONVERSION. A `KanbanCardSummary` becomes a `KanbanCardModel` here and
 * nowhere else — the panel, the lane rail and the drawer all call this, so two faces can never
 * disagree about what a signal means.
 *
 * WHAT IT DECIDES, AND WHAT IT REFUSES TO. It reads the lease STATE the server computed and
 * never `buildLeaseAt`: two clocks deriving one truth is a badge that disagrees with the API.
 * It formats spend into the string the card PAINTS, so the card never does token math. And it
 * drops every signal entirely when autonomy is off, which is the whole mechanism behind an
 * autonomy-off face being title, priority and tags — not a second render path in the component.
 */

/** A thousand, a million: the two steps the spend chip is spelled in. */
const THOUSAND = 1000;
const MILLION = 1_000_000;

/**
 * The order the two view sorts paint cards in. `server` is the lane's own order — the keyset
 * page the API returned — and is the default: a lane that has been sorted by hand stays sorted
 * by whatever asked for it, and a page appended under it is re-sorted rather than interleaved.
 */
export type KanbanViewSort = 'server' | 'priority' | 'newest';

/** Higher wins. The ladder the card's ink spells, as a number, because the panel sorts by it. */
const PRIORITY_RANK: Record<CardPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Spend, preformatted: `640`, `128k`, `1.4M`. Zero and nonsense return undefined — a card that
 * has moved no tokens shows no chip rather than a `0`, which would read as a measured amount.
 */
function formatTokens(total: number): string | undefined {
  if (!Number.isFinite(total) || total <= 0) return undefined;
  if (total < THOUSAND) return String(total);

  const thousands = Math.round(total / THOUSAND);
  if (thousands < THOUSAND) return `${thousands}k`;

  return `${(total / MILLION).toFixed(1)}M`;
}

/**
 * The counts and states a face may report, folded from the summary's four rollups and its lease.
 *
 * A zero count is ABSENT rather than zero: the card reads `signals.openIssues` as a flag and a
 * word, and `0 issues` is a badge saying there is nothing to say.
 */
function signalsFor(summary: KanbanCardSummary): KanbanCardSignals {
  const signals: KanbanCardSignals = {
    // Both states travel; the card paints only the unapproved one. Sending the flag rather than
    // a "should shout" boolean is what keeps the shouting a property of the face, not the wire.
    approval: summary.approved ? 'approved' : 'unapproved',
  };

  if (summary.openQuestions > 0) signals.openQuestions = summary.openQuestions;
  if (summary.openIssues > 0) signals.openIssues = summary.openIssues;
  if (summary.checklistTotal > 0) {
    signals.checklist = { done: summary.checklistDone, total: summary.checklistTotal };
  }

  const tokens = formatTokens(summary.buildTokens);
  if (tokens) signals.tokens = tokens;

  // 'none' means the server sent no lease signal at all — not a lease that has expired.
  if (summary.leaseState === 'held' || summary.leaseState === 'stale') signals.lease = summary.leaseState;

  return signals;
}

/**
 * One summary as the kit renders it.
 *
 * `autonomy` is the board's own setting and the only switch here: with it OFF the returned model
 * carries no `signals` field whatsoever, and the card's face is its title, its priority and its
 * tags. Nothing is hidden on the server by that — every verb stays reachable.
 */
export function toCardModel(summary: KanbanCardSummary, options: { autonomy: boolean }): KanbanCardModel {
  return {
    id: summary.id,
    title: summary.title,
    priority: summary.priority,
    tags: summary.tags ?? [],
    signals: options.autonomy ? signalsFor(summary) : undefined,
  };
}

/**
 * The lane's loaded cards in the order a requested view paints them — a VIEW over the pages
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
