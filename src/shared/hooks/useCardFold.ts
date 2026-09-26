import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Which CARDS the operator has folded shut, and the one way to change that.
 *
 * The outer fold of a lane card — the dispatcher's plan card and its arc deck (the deck that holds an
 * arc's plans). It is not the inner disclosure those cards already have (a plan's phase list, its
 * event log): those stay exactly as they were, and this is the fold above them that hides the whole
 * body.
 *
 * ABSENT MEANS EXPANDED. Always. Nothing here ever folds a card on its own — the operator asked to
 * collapse things himself — so the stored list holds ONLY the cards currently folded and a key
 * missing from it is an open card. That is the same default `collapseState.ts` states for the chat's
 * shapes, and it is the one that fails safe: a lost entry shows more, never less.
 *
 * IT RIDES THE SERVER-BACKED PREFERENCES, under the `dispatcher` blob and MERGED into it
 * (`dismissedEndings.ts` is the other writer of that blob, and MAN-498 is why the write is a merge: a
 * replaced blob drops whatever else lives under the key). So a fold made in the Runner tab is there in
 * the chat gutter's Runner widget, a fold survives a reload, and a fold made on the phone is there on
 * the desktop at its next load. The mirror in localStorage is what makes the very first paint already
 * folded, with no flash of an open card.
 *
 * THE KEY IS `space:id`, AND THE SPACE IS WHY. Two kinds of card fold and one list holds them all: a
 * plan (`plan:<plan name>`) and a dispatch arc (`darc:<arc name>` — the arc's deck, whose fold takes
 * the strip and the verbs). The prefix is what the PRUNE reads: a surface that can see the plans but
 * not the arcs must not prune the arcs' entries.
 *
 * A FOLD IS OF THE CARD, NEVER OF ONE ENDING, and that is where this DEPARTS from the dismissal store
 * on purpose. `dismissEnding` keys on `{run_id, ended_at}` because a plan that ends again is news; a
 * fold carries no such news — a plan walked again is still the same plan — so the reader who folded a
 * card to get it out of the way finds it still folded when it comes back. Keying on the ending would
 * spring it open every time the dispatcher completed a phase.
 *
 * The key form lives HERE rather than beside each card: the prefix is half of this list's address
 * space, and two modules writing their own spelling of it is how the spaces would drift apart.
 */

export type CardFold = { collapsed: boolean; toggle: () => void };

/** A plan card's space: the plan's name, which is what every dispatcher verb and toast prints. */
const PLAN_SPACE = 'plan:' as const;
/** A dispatch arc's space: the store's arc name. */
const DISPATCH_ARC_SPACE = 'darc:' as const;

/** The fold key of a plan. */
export function planFoldKey(planName: string): string {
  return `${PLAN_SPACE}${planName}`;
}

/** The fold key of one arc on the dispatcher's lane. */
export function dispatchArcFoldKey(arcName: string): string {
  return `${DISPATCH_ARC_SPACE}${arcName}`;
}

/** The preference whose blob this list lives under — the dispatcher's own, shared with the dismissals. */
const KEY = 'dispatcher' as const;

type DispatcherPreference = Record<string, unknown> & { collapsedCards?: unknown };

/**
 * The most folds kept. A one-line cap on a list that only ever grows by a press, so no reader has to
 * reason about eviction: the oldest fold of a card nobody has folded in a long time is the one
 * dropped, and a dropped entry shows an OPEN card — the safe direction.
 */
const CAP = 200;

const EMPTY: readonly string[] = Object.freeze([]);

function readPreference(): DispatcherPreference {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as DispatcherPreference) : {};
}

function isFoldKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

let lastRaw: unknown = undefined;
let lastFolds: readonly string[] = EMPTY;

/** The folded cards, as a reference that changes only when the preference does. */
export function readCollapsedCards(): readonly string[] {
  const raw = readPreference().collapsedCards;
  if (raw === lastRaw) return lastFolds;
  lastRaw = raw;
  lastFolds = Array.isArray(raw) ? raw.filter(isFoldKey) : EMPTY;
  return lastFolds;
}

/** Which space a fold key belongs to: everything before its first colon. */
function spaceOf(key: string): string {
  const at = key.indexOf(':');
  return at === -1 ? key : key.slice(0, at);
}

/**
 * The list, written back MERGED into the blob: `dismissedEndings` and anything else a later feature
 * parks under `dispatcher` is carried through untouched, and the fold list is the only key replaced.
 */
function writeFolds(keys: readonly string[]): void {
  const { collapsedCards: _prior, ...rest } = readPreference();
  writeUserPreference(KEY, { ...rest, collapsedCards: keys });
}

/** Records one card's fold. Absent means expanded, so an unfolded card is REMOVED rather than stored `false`. */
export function setCardFold(key: string, collapsed: boolean): void {
  const current = readCollapsedCards();
  if (collapsed === current.includes(key)) return;
  writeFolds(collapsed
    ? [...current, key].slice(-CAP)
    : current.filter((held) => held !== key));
}

/**
 * Forgets the folds of cards that have left the lane.
 *
 * `live` is every card key the caller can currently see. Two rules, and the second is the one that
 * makes this safe to call from a screen that only holds part of the lane:
 *
 * - a key in `live` is kept;
 * - a key whose SPACE the caller cannot see AT ALL is kept too, because a surface that drew no plan
 *   card says nothing about plans — the tab and the gutter widget each hand in every list they hold,
 *   so this only ever shields a lane the caller genuinely cannot speak for, never one it drew empty.
 *
 * It follows that an empty `live` prunes nothing at all, which is the failure this could otherwise
 * have: the bus hands out an empty frame for a moment and every fold the operator ever made is gone.
 * The cost is one stale entry per space, which a later frame carrying that lane clears.
 */
export function pruneCardFolds(live: readonly string[]): void {
  const current = readCollapsedCards();
  if (current.length === 0) return;
  const keep = new Set(live);
  const spaces = new Set(live.map(spaceOf));
  const next = current.filter((key) => keep.has(key) || !spaces.has(spaceOf(key)));
  if (next.length === current.length) return;
  writeFolds(next);
}

/**
 * One card's fold: whether it is folded, and the one press that turns it.
 *
 * `useSyncExternalStore` rather than local state, because the fold is SHARED: the Runner tab and the
 * chat gutter's widget draw the same card at the same time, and a fold pressed in one has to be
 * folded in the other. It is also what makes the answer arrive on the first render, off the
 * preference mirror the app read at load — there is no effect and no second paint, so a card never
 * draws open and then snaps shut.
 *
 * The toggle reads the STORE and not this render's `collapsed`, so two presses inside one frame
 * cannot both write `true`: the second sees what the first wrote.
 *
 * Used by `PlanCard` and `DeckFrame` — every card that folds.
 */
export function useCardFold(key: string): CardFold {
  const collapsed = useSyncExternalStore(subscribeToUserPreferences, readCollapsedCards, readCollapsedCards).includes(key);
  const toggle = useCallback(() => {
    setCardFold(key, !readCollapsedCards().includes(key));
  }, [key]);
  return { collapsed, toggle };
}

/**
 * Keeps the stored folds to the cards a lane still carries — the one call site is
 * `src/modules/runner-tab/hooks/useLaneFoldPrune.ts`, which assembles the two lists both of the
 * lane's homes already hold.
 *
 * The effect fires on the array's IDENTITY, which changes with every frame the bus hands out; a
 * prune that finds nothing to drop writes nothing (`pruneCardFolds` returns before the write), so a
 * poll costs one array and no preference change.
 */
export function useCardFoldPrune(live: readonly string[]): void {
  useEffect(() => {
    pruneCardFolds(live);
  }, [live]);
}
