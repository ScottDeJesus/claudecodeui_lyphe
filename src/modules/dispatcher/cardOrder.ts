/**
 * The order of the lane's top-level cards — arc decks and plans of no arc — in one file with no React
 * and no store in it: what a card's rank is, what the cards sort by, and which ranks a drop writes.
 *
 * THE OPERATOR'S ARRANGEMENT IS THE ONLY THING THAT ORDERS A CARD. Not its status, not when it was
 * last touched, not whether it owes a word, not which chat is open: a swarm press bumps `updated_at`,
 * the daemon's take-ups and finishes bump it again, status changes with every phase, and an order
 * keyed to any of those moves cards under the reader's eyes (operator, 2026-10-01: "the ordering of
 * plan cards changes if I turn on swarm or off swarm … make it so that the plan cards stay in their
 * allotted locations"). So a card has a RANK, higher first, and it is one of two numbers: the one the
 * operator saved by dropping the card somewhere (`cardOrderEntries.ts`), else the card's creation in
 * epoch milliseconds. Cards the operator has never moved therefore stand newest-first, a new card
 * lands at the top, and nothing else changes where any card stands. Ties break by name.
 *
 * A DROP WRITES ONE NUMBER, the moved card's, between its new neighbours' (`ranksForMove`): the
 * midpoint of the two ranks, or a step beyond the end neighbour at either end. Every other card keeps
 * the rank it had, so a drop on one device cannot reorder what another device arranged.
 */

/** What a card must say about itself to be ranked: its name (a plan's or an arc's — the two never collide) and its creation. Plans and arcs both do. */
export type RankedCard = { name: string; created_at: string };

/** One entry a drop writes: the card and the rank it now holds. */
export type CardRankEntry = { name: string; rank: number };

/** The rank step beyond the end neighbour when a card is dropped first or last: one second of the creation clock. */
const END_STEP = 1000;

/** A card's rank: the operator's saved number, else its creation in epoch ms (0 for a stamp nothing can read, which stands last). */
export function rankOf(card: RankedCard, ranks: ReadonlyMap<string, number>): number {
  const saved = ranks.get(card.name);
  if (saved !== undefined) return saved;
  const created = Date.parse(card.created_at);
  return Number.isNaN(created) ? 0 : created;
}

/** `items` in the one order — higher rank first, ties by name — as a sorted copy. `cardOf` says which card an item is. */
export function inCardOrder<T>(items: readonly T[], cardOf: (item: T) => RankedCard, ranks: ReadonlyMap<string, number>): T[] {
  return [...items].sort((a, b) => {
    const left = cardOf(a);
    const right = cardOf(b);
    if (left.name === right.name) return 0;
    return rankOf(right, ranks) - rankOf(left, ranks) || (left.name < right.name ? -1 : 1);
  });
}

/**
 * The entries a drop writes: `carried` has just been put into `order` (the names of the cards of one
 * list, top first), and `rankOfName` says the rank every card of it holds now.
 *
 * ONE ENTRY, in every case but one: the carried card, ranked between the cards it now stands between.
 * The one case is a gap with nothing left in it — two neighbours of the same rank (cards created in the
 * same second, never moved) or a midpoint the arithmetic can no longer tell from either end. No single
 * number can order the card there, so the list is handed back the ranks it already held, in its new
 * order, kept one millisecond apart where they tied, and only the entries that changed are written.
 * The list's own order is exactly the drop's. A card of ANOTHER list (a deck, when the tab drops a wall
 * card) whose rank lies between two of those ranks can change sides with a card that took the lower one:
 * the tab never draws the two lists against each other, so it shows only in the widget's one column.
 */
export function ranksForMove(carried: string, order: readonly string[], rankOfName: (name: string) => number): CardRankEntry[] {
  const at = order.indexOf(carried);
  const above = at > 0 ? rankOfName(order[at - 1]) : null;
  const below = at >= 0 && at < order.length - 1 ? rankOfName(order[at + 1]) : null;
  if (above === null && below === null) return [];
  if (above === null) return [{ name: carried, rank: (below ?? 0) + END_STEP }];
  if (below === null) return [{ name: carried, rank: above - END_STEP }];
  const between = (above + below) / 2;
  if (between < above && between > below) return [{ name: carried, rank: between }];

  const pool = order.map(rankOfName).sort((a, b) => b - a);
  for (let index = 1; index < pool.length; index += 1) {
    if (pool[index] >= pool[index - 1]) pool[index] = pool[index - 1] - 1;
  }
  return order.flatMap((name, index) => (pool[index] === rankOfName(name) ? [] : [{ name, rank: pool[index] }]));
}
