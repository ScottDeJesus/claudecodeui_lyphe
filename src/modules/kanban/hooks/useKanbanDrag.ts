import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanCardSummary, KanbanStatus } from '@/shared/kanban-types';
import type { KanbanMoveInput } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanLaneSpec } from '@/modules/kanban/utils/lanePolicy';

/**
 * WHERE A CARD LANDS, AND THE SENTENCE THAT SAYS SO.
 *
 * AN INDEX IS NEVER SENT. The lane reports the gap the pointer is nearest as an index into what
 * IT is painting; the route takes the two cards the moved card will sit between, because an index
 * is stale the moment another session moves anything and a neighbour pair is not. This file is the
 * one conversion from the first to the second — and the KEYBOARD path goes through the same
 * commit, so a card moved with `Ctrl + →` and one dragged produce byte-identical requests.
 *
 * THE ANNOUNCEMENT IS THE OUTCOME, NOT THE INTENT. The live region is written once the server has
 * answered, with the card, the lane and the position it actually took. A Toast cannot stand in
 * for it: a toast leaves, and a thing that leaves cannot tell a reader where their card went.
 *
 * EVERY MOVE ANSWERS WITH THE CARD. A cross-lane move remounts the card in another lane, and a
 * remounted node takes the browser's focus down to `<body>` with it; the board cannot put the
 * reader back on a card it cannot name, so the promise below is the whole of what it is told —
 * the card the server landed, or `null` when nothing landed and the card was put back where it
 * was. What the board DOES with that answer is the board's business, not this hook's.
 */

export type KanbanDragOptions = {
  specs: KanbanLaneSpec[];
  /** The ids in one lane, in the order the lane paints them. */
  cardIds: (laneId: string) => string[];
  /** The wire summary behind a card id, or null when the board no longer holds it. */
  summaryOf: (cardId: string) => KanbanCardSummary | null;
  /** The lane's server-side total — what "position 2 of 7" counts to. */
  countOf: (statuses: KanbanStatus[]) => number;
  /** Moves the card on screen before the write returns; the write reconciles it. */
  applyCardMove: (card: KanbanCardSummary, laneId: string, position: number) => void;
  move: (input: KanbanMoveInput, previous: KanbanCardSummary | null) => Promise<KanbanCardSummary | null>;
  announce: (sentence: string) => void;
};

/**
 * What every move answers with: the card the SERVER landed, or `null` when none landed — either
 * because the request never went out, or because the server refused it and the card was put back.
 * `null` never means "still in flight": the promise settles when the write does.
 */
export type KanbanMoveResult = KanbanCardSummary | null;

export type KanbanDrag = {
  /** A drop: `index` is the gap in `laneId` the card was released at. */
  dropCard: (cardId: string, laneId: string, index: number) => Promise<KanbanMoveResult>;
  /** A key: one lane across for `dx`, one card up or down for `dy`. */
  moveCard: (cardId: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => Promise<KanbanMoveResult>;
  /** A menu row: into a named lane, at its end. */
  moveCardToLane: (cardId: string, laneId: string) => Promise<KanbanMoveResult>;
};

/** Called ONCE, by the panel, over the lanes hook's own state. */
export function useKanbanDrag(options: KanbanDragOptions): KanbanDrag {
  const { specs, cardIds, summaryOf, countOf, applyCardMove, move, announce } = options;
  const { t } = useTranslation();

  /**
   * The one move. `position` is an index into what the lane is PAINTING, which includes the card
   * being moved when it is already in that lane — the lane's own drop index is measured over the
   * cards on screen, and the dragged card keeps its slot while it is in flight.
   */
  const commit = useCallback(
    async (card: KanbanCardSummary, laneId: string, position: number): Promise<KanbanMoveResult> => {
      const spec = specs.find((candidate) => candidate.id === laneId);
      if (!spec) return null;

      const ids = cardIds(laneId);
      const from = ids.indexOf(card.id);
      const rest = ids.filter((id) => id !== card.id);

      // Removing the card first is what the lane's index was measured against; the one index past
      // its own slot belongs to the card that followed it.
      const wanted = from >= 0 && position > from ? position - 1 : position;
      const landing = Math.max(0, Math.min(wanted, rest.length));

      // A reorder inside a lane keeps the card's status: a lane is a SET, and re-ordering a card
      // that waits on an answer must not answer it. Crossing into a lane that does not hold the
      // card's status gives it the lane's first one — the lane's own intake status.
      const status = spec.statuses.includes(card.status) ? card.status : spec.statuses[0];
      const afterId = landing > 0 ? rest[landing - 1] : null;
      const beforeId = landing < rest.length ? rest[landing] : null;

      applyCardMove({ ...card, status }, laneId, landing);

      const landed = await move({ cardId: card.id, status, afterId, beforeId }, card);
      // Nothing landed: the hook that owns the write has already put the card back and told the
      // reader why. A sentence about a move that did not happen would be the one lie here.
      if (!landed) return null;

      announce(
        t('kanban.card.moved', {
          title: card.title,
          lane: t(spec.titleKey),
          position: landing + 1,
          // The lane's server total, or what is on screen when nobody has counted it yet — never
          // a total smaller than the position just announced.
          total: Math.max(countOf(spec.statuses), rest.length + 1),
        })
      );

      return landed;
    },
    [specs, cardIds, applyCardMove, move, announce, countOf, t]
  );

  const dropCard = useCallback(
    (cardId: string, laneId: string, index: number) => {
      const card = summaryOf(cardId);
      return card ? commit(card, laneId, index) : Promise.resolve(null);
    },
    [summaryOf, commit]
  );

  const moveCard = useCallback(
    async (cardId: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1): Promise<KanbanMoveResult> => {
      const card = summaryOf(cardId);
      if (!card) return null;

      const lane = specs.find((spec) => spec.statuses.includes(card.status));
      if (!lane) return null;

      if (dx !== 0) {
        const target = specs[specs.indexOf(lane) + dx];
        if (!target) return null;
        // Across lanes the card goes to the END of the lane it enters, which is where intake
        // puts new work and where a demoted card is least disruptive.
        return commit(card, target.id, cardIds(target.id).length);
      }

      if (dy === 0) return null;
      const ids = cardIds(lane.id);
      const at = ids.indexOf(card.id);
      if (at < 0) return null;

      // THE TWO CALLERS COUNT IN DIFFERENT RULERS, and this line is the whole conversion. A drop
      // reports a GAP over the lane as painted, with the moved card still holding its slot — which
      // is why `commit` takes that slot away itself. The keyboard reports a SLOT in the lane the
      // other cards make. Handing that slot over unchanged let `commit` take the slot away a second
      // time, and the two corrections cancelled the move: `Ctrl + ↓` on the first card of three
      // sent the pair that left it exactly where it was, so the vertical keys did nothing at all.
      //
      // Moving toward the end of the lane is therefore one gap further along than the slot asked
      // for; moving toward the front is the same number, because the card's own slot was behind
      // the target all along. Only then do the key and the drop send the identical pair — which is
      // the whole reason one resolver serves both.
      const wanted = at + dy;
      if (wanted < 0 || wanted >= ids.length) return null;
      return commit(card, lane.id, dy > 0 ? wanted + 1 : wanted);
    },
    [specs, summaryOf, cardIds, commit]
  );

  const moveCardToLane = useCallback(
    (cardId: string, laneId: string) => {
      const card = summaryOf(cardId);
      return card ? commit(card, laneId, cardIds(laneId).length) : Promise.resolve(null);
    },
    [summaryOf, cardIds, commit]
  );

  return { dropCard, moveCard, moveCardToLane };
}
