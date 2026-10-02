import { useSyncExternalStore } from 'react';

import { ranksForMove, rankOf } from '@/modules/dispatcher/cardOrder';
import type { CardRankEntry, RankedCard } from '@/modules/dispatcher/cardOrder';
import { readUserPreference, subscribeToUserPreferences, writeUserPreferenceEntries } from '@/shared/userSettings';
import type { PreferenceEntryPatch } from '@/shared/types';

/**
 * Where the operator's card arrangement is kept: `cardOrder` under the `dispatcher` preference, a list
 * of `{ name, rank }` — one entry per card he has moved, `name` the plan's or the arc's (the two never
 * collide) and `rank` the number `cardOrder.ts` sorts by. It follows `hiddenPlans.ts` in everything
 * that is not the entry's shape:
 *
 * - EVERY WRITE IS AN ENTRY PATCH (`writeUserPreferenceEntries`) naming only the entries it changes,
 *   and the server lays it over its own copy entry by entry. A drop names ONE card, the moved one,
 *   so a phone's drop and a desktop's cannot erase each other: the client's copy of the list is read
 *   at sign-in and never again, and a write that sent the whole list would put back whatever the
 *   other device had arranged since. The server needs no registration for the list: both merge paths
 *   accept any list name under `dispatcher`, and cap it at 200 entries, dropped from the front.
 * - EVERY WRITE ALSO PRUNES: the entries this client holds for names the lane no longer carries
 *   (a plan dropped from the store, an arc gone) can never match a card again, and keeping them would
 *   only push a live entry off the cap. The lane handed in is the WHOLE lane, put-away cards included
 *   (`carriedNames`), because a card that is merely hidden still has its place.
 * - THE READER HANDS REACT A STABLE MAP: `useSyncExternalStore` compares snapshots by identity, and a
 *   getter that rebuilt the map on every call would report a change on every render and loop. The
 *   cache is keyed on the stored list, which the preference store replaces only on a write to THAT
 *   list or a hydrate.
 */

const KEY = 'dispatcher' as const;

const EMPTY: ReadonlyMap<string, number> = new Map();

function isCardRankEntry(value: unknown): value is CardRankEntry {
  return (
    value !== null && typeof value === 'object'
    && typeof (value as CardRankEntry).name === 'string'
    && typeof (value as CardRankEntry).rank === 'number'
    && Number.isFinite((value as CardRankEntry).rank)
  );
}

/** The stored list as it stands, before any reading of it. */
function storedList(): unknown {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).cardOrder
    : undefined;
}

// The snapshot cache `useSyncExternalStore` needs: the stored list last read, and the ranks read out
// of it, handed back by identity until the store replaces the list.
let lastRaw: unknown = undefined;
let lastRanks: ReadonlyMap<string, number> = EMPTY;

function readRanks(): ReadonlyMap<string, number> {
  const raw = storedList();
  if (raw === lastRaw) return lastRanks;
  lastRaw = raw;
  const entries = Array.isArray(raw) ? raw.filter(isCardRankEntry) : [];
  lastRanks = entries.length === 0 ? EMPTY : new Map(entries.map((entry) => [entry.name, entry.rank]));
  return lastRanks;
}

/** Every rank the operator has saved, by card name. Re-renders the caller when a drop is written here, or arrives with a hydrate. */
export function useCardRanks(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribeToUserPreferences, readRanks, readRanks);
}

/**
 * A DROP: `carried` was put into `order` (the names of one list's cards, top first). `cards` is every
 * card of that list, for the ranks the neighbours hold; `onLane` the names the whole lane carries,
 * what the stored list is pruned against. ONE write, one entry for the card (`ranksForMove`), plus a
 * `null` for each stale entry.
 */
export function moveCard(carried: string, order: readonly string[], cards: readonly RankedCard[], onLane: readonly string[]): void {
  const ranks = readRanks();
  const byName = new Map(cards.map((card) => [card.name, card]));
  const written = ranksForMove(carried, order, (name) => {
    const card = byName.get(name);
    return card === undefined ? 0 : rankOf(card, ranks);
  });
  if (written.length === 0) return;
  const carriedNames = new Set(onLane);
  const patch: PreferenceEntryPatch[string] = {};
  for (const name of ranks.keys()) {
    if (!carriedNames.has(name)) patch[name] = null;
  }
  for (const entry of written) patch[entry.name] = entry;
  writeUserPreferenceEntries(KEY, { cardOrder: patch });
}
