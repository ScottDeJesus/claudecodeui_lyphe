import { useCallback } from 'react';

import { FAKE_BOARD_ID, FAKE_WALKS } from '@/modules/kanban/utils/walkFixtures';
import type { KanbanWalk } from '@/modules/kanban/utils/walkModel';

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
  // FILL: walks — the feed's card objects (`DispatcherPicture.cards`, on the `dispatcher_state`
  // frame), matched to a card by board id and card id. `hold` is the feed's sentence with its
  // leading class word taken off, and the one class whose word is the sentence's SUBJECT keeps it:
  //   `queue: Pause all is on`               -> "Pause all is on"
  //   `cards: <n> of <width> walking`        -> "<n> of <width> cards walking"
  //   `waits: <title> goes first`            -> "<title> goes first"
  //   `board: waiting for the board's cards` -> "waiting for the board's cards"
  // and any other clause (the pacer's) as the feed wrote it. The face prints "Held — <that>".
  return useCallback(
    (cardId: string) => (boardId === FAKE_BOARD_ID ? (FAKE_WALKS[cardId] ?? null) : null),
    [boardId],
  );
}
