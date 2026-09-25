import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Which CARDS the operator has folded shut, and the one way to change that.
 *
 * The outer fold of a lane card — the run card, the dispatcher's v3 plan card, a runner arc's deck
 * and the dispatcher's arc deck (the deck that holds an arc's plans). It is not the inner disclosure
 * those cards already have (a run's phase list, a plan's event log): those stay exactly as they
 * were, and this is the fold above them that hides the whole body.
 *
 * ABSENT MEANS EXPANDED. Always. Nothing here ever folds a card on its own — the operator asked to
 * collapse things himself — so the stored list holds ONLY the cards currently folded and a key
 * missing from it is an open card. That is the same default `collapseState.ts` states for the chat's
 * shapes, and it is the one that fails safe: a lost entry shows more, never less.
 *
 * IT RIDES THE SERVER-BACKED PREFERENCES, under the runner's own `planRunner` blob and MERGED into
 * it (`dismissedRuns.ts` is the store this shape is copied from, and MAN-498 is why the write is a
 * merge: a replaced blob drops whatever else lives under the key). So a fold made in the Runner tab
 * is there in the chat gutter's Runner widget, a fold survives a reload, and a fold made on the
 * phone is there on the desktop at its next load. The mirror in localStorage is what makes the very
 * first paint already folded, with no flash of an open card.
 *
 * THE KEY IS `space:id`, AND THE SPACE IS WHY. Four kinds of card fold and one list holds them all:
 * a run (`run:<run_id>`), a v3 plan (`plan:<plan name>`), a runner arc (`arc:<arc name>`) and a
 * dispatch arc (`darc:<arc name>` — the arc's deck, whose fold takes the strip and the verbs). A run id
 * and an arc name are both free-form strings the runner hands us, so a bare shared namespace could
 * collide; a prefix has nothing left to collide with. It
 * is also what the PRUNE reads, for the reason `dismissedRuns.ts` grew its own `spaceOf`: a surface
 * that can see one lane must not prune the other lane's entries.
 *
 * A FOLD IS OF THE CARD, NEVER OF ONE ENDING, and that is where this DEPARTS from the dismissal
 * store on purpose. `dismissRun` keys on `{run_id, ended_at}` because a resumed run that ends again
 * is news; a fold carries no such news — `plan-runner resume` reopens a run IN PLACE under the same
 * id, and a plan walked again is still the same plan — so the reader who folded a card to get it out
 * of the way finds it still folded when it comes back. Keying on the ending would spring it open
 * every time the runner finished a phase.
 *
 * The key form lives HERE rather than beside each card, by the rule `DISPATCHER_ENDING_PREFIX`
 * states for its own list: the prefix is half of this list's address space, and four modules writing
 * their own spelling of it is how the spaces would drift apart.
 */

export type CardFold = { collapsed: boolean; toggle: () => void };

/** A run card's space: the runner's `run_id`, which survives an in-place resume. */
const RUN_SPACE = 'run:' as const;
/** A v3 plan card's space: the plan's name, which is what every dispatcher verb and toast prints. */
const PLAN_SPACE = 'plan:' as const;
/** A runner arc's space: the arc's name — the runner's own directory name under `~/.claude/state/arcs`. */
const RUNNER_ARC_SPACE = 'arc:' as const;
/** A dispatch arc's space: the store's arc name. Apart from the runner's, since the two lanes' arcs are different objects that may share a name. */
const DISPATCH_ARC_SPACE = 'darc:' as const;

/** The fold key of a plan-runner run. */
export function runFoldKey(runId: string): string {
  return `${RUN_SPACE}${runId}`;
}

/** The fold key of a dispatcher v3 plan. */
export function planFoldKey(planName: string): string {
  return `${PLAN_SPACE}${planName}`;
}

/** The fold key of one arc on the runner's lane. */
export function runnerArcFoldKey(arcName: string): string {
  return `${RUNNER_ARC_SPACE}${arcName}`;
}

/** The fold key of one arc on the dispatcher's lane. */
export function dispatchArcFoldKey(arcName: string): string {
  return `${DISPATCH_ARC_SPACE}${arcName}`;
}

/** The preference whose blob this list lives under — the runner's own, shared with the dismissals. */
const KEY = 'planRunner' as const;

type PlanRunnerPreference = Record<string, unknown> & { collapsedCards?: unknown };

/**
 * The most folds kept. A one-line cap on a list that only ever grows by a press, so no reader has to
 * reason about eviction: the oldest fold of a card nobody has folded in a long time is the one
 * dropped, and a dropped entry shows an OPEN card — the safe direction.
 */
const CAP = 200;

const EMPTY: readonly string[] = Object.freeze([]);

function readPreference(): PlanRunnerPreference {
  const value = readUserPreference<unknown>(KEY, null);
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as PlanRunnerPreference) : {};
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
 * parks under `planRunner` is carried through untouched, and the fold list is the only key replaced.
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
 * - a key whose SPACE the caller cannot see AT ALL is kept too, because a surface that drew no run
 *   card says nothing about runs — the tab and the gutter widget each hand in every list they hold,
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
 * Used by `RunCard`, `PlanCard` and `DeckFrame` (the runner's and the dispatcher's arc decks) — every card that folds.
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
 * `src/modules/runner-tab/hooks/useLaneFoldPrune.ts`, which assembles the four lists both of the
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
