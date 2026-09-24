import type { ArcCardLayer, ArcCardSnapshot, ArcCardState, ArcSnapshot, Tone } from '@/shared/types';

/**
 * The pure vocabulary of an arc deck, in one file with no React in it.
 *
 * Everything here is a total function of a snapshot the server already sent. Nothing polls,
 * nothing fetches and nothing remembers: a card that needs a fact about its deck asks one of
 * these, so two screens reading the same arc can never disagree about which card is live or
 * whether a position may still be dragged.
 *
 * THE CLIENT KEEPS THE LAYOUT; THE RUNNER KEEPS THE RULES. Which card is live, and which
 * positions have started, are read from the snapshot's own `current` and `last_started` — the
 * runner's decisions, written into `arc.json` as it walks — and are never recomputed here from
 * the card states. Scanning the states instead would disagree with the runner exactly when a card
 * walked out of order (`--now`), and the deck's job is to draw the walk, not to second-guess it.
 */

/** The `dataTransfer` type a card's drag carries; its value is the dragged card's position as a decimal string. */
export const ARC_CARD_DRAG_TYPE = 'application/x-cloudcli-arc-card';

/**
 * Every card of the deck in POSITION order, each with the layer it wears — the strip's one list.
 *
 * Position order is the walk's own order, so the strip reads past → present → future left to right:
 * every complete card is `done`, the card at the snapshot's `current` is `top` (the live one), and
 * every other card is `beneath` (still to come). Because `current` is the runner's first
 * non-complete position, nothing before it can be anything but done; once every card is complete
 * `current` is `null` and there is no `top` at all.
 */
export function deckLayers(arc: ArcSnapshot): { card: ArcCardSnapshot; layer: ArcCardLayer }[] {
  return [...(arc.cards ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((card) => ({
      card,
      layer: card.state === 'complete' ? 'done' : card.position === arc.current ? 'top' : 'beneath',
    }));
}

/**
 * Whether a card may be picked up at all: only one the runner has NOT started — `queued` or
 * `unminted`, never one with a run behind it — and only a position past `last_started`, the
 * highest position that has begun. A card at or below that line has a run, or has had one, and
 * moving it would rewrite an order the runner has already walked.
 */
export function cardDraggable(arc: ArcSnapshot, card: ArcCardSnapshot): boolean {
  return (card.state === 'queued' || card.state === 'unminted') && card.position > arc.last_started;
}

/**
 * Whether a move from one position to another may be sent to the runner at all.
 *
 * The same line `cardDraggable` draws, asked of BOTH ends of the move, plus the bounds of the
 * deck and `from !== to`: the runner refuses anything else (`arcs.reorder`), and this guard is
 * what keeps the deck from offering a drop it would only refuse. A no-op drag is not a move.
 */
export function reorderAllowed(arc: ArcSnapshot, from: number, to: number): boolean {
  const positions = (arc.cards ?? []).length;
  return (
    from > arc.last_started &&
    to > arc.last_started &&
    from >= 1 &&
    to >= 1 &&
    from <= positions &&
    to <= positions &&
    from !== to
  );
}

/**
 * How a card's state reaches the eye. Never `danger`: a stalled card is a card the runner is
 * already pressing again the moment a cure lands (`repress_key`, `arc_walk`), not a denial and not
 * a hand's to fix. `unminted`, `queued` and `paused` are all `neutral` — nothing is wrong with a
 * card the runner has not got to yet, and amber would read as though something had gone amiss.
 */
export function cardTone(state: ArcCardState): Tone {
  if (state === 'complete') return 'positive';
  if (state === 'walking') return 'info';
  if (state === 'stalled') return 'warn';
  return 'neutral';
}

/** How much of the arc is behind it. Complete cards only — a walking card is not done. */
export function arcProgress(arc: ArcSnapshot): { done: number; total: number } {
  const cards = arc.cards ?? [];
  return { done: cards.filter((card) => card.state === 'complete').length, total: cards.length };
}

/**
 * Every `run_id` the decks drawn on the lane OWN — one per card that has a run behind it, off
 * `arc.json:cards[].run_id`, the runner's own join between a card and the run it minted for the
 * card's plan (`hooks/plan_runner/arcs.py:card_state` writes it for every state but `unminted`).
 *
 * THE RUN LIST MUST NOT DRAW WHAT A CARD ALREADY DRAWS. A card draws its own run, so a run list
 * that also drew it put the same plan on screen twice (operator, 2026-09-24: "Arc cards should
 * display their progress and info inside the plan cards nested in the arc, not creating a duplicate
 * plan below it"). `RunnerPanel` and `RunnerWidgetBody` both subtract this set from the runs they
 * list, reading it from here rather than each keeping its own copy of the rule, so the two homes
 * can never disagree about which run belongs where.
 *
 * ONLY WHAT IS DRAWN COUNTS. This takes the arcs the gallery is actually holding, not every arc on
 * the host: an arc the deck has dropped (a complete one past its keep window, or a test arc in a
 * tab that hides them) draws nothing, so the run it owned stays in the list rather than vanishing
 * from a screen that no longer shows the card it belonged to.
 *
 * A run the deck does NOT own — a second walk of a plan whose newest run is not a card's `run_id`,
 * or a plan no arc names — is absent from the set, so it keeps its own card below the deck.
 */
export function arcOwnedRunIds(arcs: ArcSnapshot[]): Set<string> {
  const owned = new Set<string>();
  for (const arc of arcs) {
    for (const card of arc.cards ?? []) {
      if (card.run_id !== null) owned.add(card.run_id);
    }
  }
  return owned;
}
