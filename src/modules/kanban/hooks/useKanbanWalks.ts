import { useCallback, useMemo } from 'react';

import type { KanbanWalk, KanbanWalkStage } from '@/modules/kanban/utils/walkModel';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { DispatcherCard, DispatcherCardStage, DispatcherLanePicture } from '@/shared/types';

/**
 * EACH CARD'S WALK, for the open board: why the dispatcher holds it, the stages it has run and the
 * scenarios it left.
 *
 * ONE READER, CALLED ONCE BY THE PANEL, for the reason the board hook is: the face and the drawer
 * both draw a card's walk, and two readers are two answers to whether a card is held.
 *
 * `null` IS A CARD THE DISPATCHER IS NOT WALKING: one on a board that does not run itself, one it
 * has not been told of yet, or one whose walk ended more than a day ago. The face then draws no
 * hold and the drawer no stages, and neither draws an empty place for them.
 */
export function useKanbanWalks(boardId: string | null): (cardId: string) => KanbanWalk | null {
  const value = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);
  const picture = value?.payload;

  // The feed is the dispatcher's whole `cards` list, one per row not ended more than a day ago;
  // a card is matched by board id and card id, because a card id alone is only unique on its own board.
  const walks = useMemo(() => {
    const byCard = new Map<string, KanbanWalk>();
    const cards = picture?.cards;
    if (boardId === null || !Array.isArray(cards)) return byCard;
    for (const card of cards) {
      if (card.board === boardId) byCard.set(card.card, walkOf(card));
    }
    return byCard;
  }, [picture, boardId]);

  return useCallback((cardId: string) => walks.get(cardId) ?? null, [walks]);
}

// The class words a hold sentence opens with whose sentence reads whole without them.
const HELD_CLASSES = ['queue', 'waits', 'board'] as const;

// The width's clause, whose class word is the sentence's subject, so it is kept and moved into place.
const CARDS_WALKING = /^cards: (\d+) of (\d+) walking$/;

// A hold reads as a sentence on the card, so its class word comes off where the sentence reads whole without it.
function holdSentence(hold: string | null): string {
  const text = hold?.trim() ?? '';
  if (text.length === 0) return '';
  const width = CARDS_WALKING.exec(text);
  if (width) return `${width[1]} of ${width[2]} cards walking`;
  const classWord = HELD_CLASSES.find((word) => text.startsWith(`${word}: `));
  if (classWord) return text.slice(classWord.length + 2).trim();
  return text;
}

// The board's stage. A sitting on the Claude subscription has no dollars, and its spend is its tokens, so both are carried.
function stageOf(stage: DispatcherCardStage): KanbanWalkStage {
  return {
    name: stage.name,
    soul: stage.soul ?? '',
    launch_id: stage.launch_id,
    // A record entry with no status is one the walk never stamped; it is said, not guessed as running or done.
    status: stage.status ?? 'unknown',
    verdict: stage.verdict,
    cost_usd: stage.cost_usd,
    tokens_in: stage.tokens_in,
    tokens_out: stage.tokens_out,
  };
}

// One card's walk, cut to the fields the board draws.
function walkOf(card: DispatcherCard): KanbanWalk {
  return {
    hold: holdSentence(card.hold),
    stages: card.stages.map(stageOf),
    cases: card.cases.map(({ suite, name, word }) => ({ suite, name, word })),
  };
}
