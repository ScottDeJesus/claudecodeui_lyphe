import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreferenceEntries } from '@/shared/userSettings';

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
 * IT RIDES THE SERVER-BACKED PREFERENCES, as `collapsedCards` under the `dispatcher` key
 * (`modules/dispatcher/hiddenPlans.ts` writes the other list there), and every change is an ENTRY
 * PATCH (`writeUserPreferenceEntries`) naming only the cards it folds or opens. A client's copy is read
 * at sign-in and never again, so a write that sent the whole document let a client open a while erase
 * every fold, and every HIDE, made elsewhere since (INV-4406; the operator's arc Hide of 2026-09-28 was
 * undone that way by another client's fold). So a fold made in the Runner tab is there in the chat
 * gutter's Runner widget, a fold survives a reload, and a fold made on the phone is there on the
 * desktop at its next load. The mirror in localStorage is what makes the very first paint already
 * folded, with no flash of an open card.
 *
 * THE KEY IS `space:id`, AND THE SPACE IS WHY. Two kinds of card fold and one list holds them all: a
 * plan (`plan:<plan name>`) and a dispatch arc (`darc:<arc name>` — the arc's deck, whose fold takes
 * the strip and the verbs). The prefix is what the PRUNE reads: a surface that can see the plans but
 * not the arcs must not prune the arcs' entries.
 *
 * A FOLD IS OF THE CARD, AND NOTHING THE PLAN DOES LIFTS IT, which is where this DEPARTS from the
 * put-away store on purpose. A Hide or a Dismiss (`hiddenPlans.ts`) carries the moment of the press,
 * because a plan that ends after it is news and comes back on its own; a fold carries no such news — a
 * plan walked again is still the same plan — so the reader who folded a card to get it out of the way
 * finds it still folded when it comes back. A fold that lapsed on an ending would spring the card open the moment the plan
 * finished, which is the one moment the reader who folded it did not ask to see it again.
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

/**
 * The preference this list lives under — the dispatcher's own, shared with the hidden plans. The list
 * keeps its newest 200 folds (`preferenceEntryPatch.ts`, on both sides): the oldest fold of a card
 * nobody has folded in a long time is the one dropped, and a dropped entry shows an OPEN card — the
 * safe direction.
 */
const KEY = 'dispatcher' as const;

const EMPTY: readonly string[] = Object.freeze([]);

function readPreference(): Record<string, unknown> {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isFoldKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

let lastRaw: unknown = undefined;
let lastFolds: readonly string[] = EMPTY;

/** The folded cards, as a reference that changes only when the preference does. */
function readCollapsedCards(): readonly string[] {
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
 * The ONE write a fold change makes: an entry patch naming exactly the cards it changes, a fold as its
 * own key and an opening as `null`. Every other fold, and the hidden plans beside them, stand.
 */
function writeFolds(changes: Record<string, string | null>): void {
  writeUserPreferenceEntries(KEY, { collapsedCards: changes });
}

/** Records one card's fold. Absent means expanded, so an unfolded card is REMOVED rather than stored `false`. */
function setCardFold(key: string, collapsed: boolean): void {
  if (collapsed === readCollapsedCards().includes(key)) return;
  writeFolds({ [key]: collapsed ? key : null });
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
function pruneCardFolds(live: readonly string[]): void {
  const current = readCollapsedCards();
  if (current.length === 0) return;
  const keep = new Set(live);
  const spaces = new Set(live.map(spaceOf));
  const dropped = current.filter((key) => !keep.has(key) && spaces.has(spaceOf(key)));
  if (dropped.length === 0) return;
  writeFolds(Object.fromEntries(dropped.map((key) => [key, null])));
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
