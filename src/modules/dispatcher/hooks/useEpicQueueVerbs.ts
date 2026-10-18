import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerbSend } from '@/modules/dispatcher/hooks/useVerbSend';
import { api } from '@/shared/api';
import type { DispatcherQueueMove } from '@/shared/types';

/**
 * The board's one queue press: an epic moved in the dispatcher's queue (`dispatcher queue <epic> --before
 * <epic> | --last`), relayed through `POST /api/dispatcher/arcs/:name/queue`.
 *
 * IT LIVES ON THE BOARD, NOT ON AN EPIC. A list's drop carries whichever epic was dragged, and a hook cannot
 * be called once per card, so both lists that draw the queue's decks press through this one `moveEpic`; a
 * per-epic press on `useDispatcherVerbs` would have no caller. The move names a NEIGHBOUR (`before`) or the
 * back of the queue (`last`) and never an index: a queue deck that is put away is not drawn, so an index on
 * screen is not a place in the queue, while a neighbour is the same epic on screen and in the store.
 *
 * It answers whether the dispatcher took the move, which is what holds a drop on screen until the next frame
 * (`useSortable`'s `onReorder` returns it) and puts the old order back over a refusal. NOTHING IS OPTIMISTIC:
 * the decks redraw from the next `dispatcher_state` frame, which carries the order the store now holds. The
 * toast is the dispatcher's own first line (`MOVED a.arc — 2 of 3`) in the operator's words, headed `Queue`
 * when it said nothing and `Queue not changed` over a refusal.
 *
 * Used by the runner-tab module, through this module's barrel: `useQueueLineSort` (In flight's queue list)
 * and `RunnerWidgetBody` (the gutter's column), where a drop of a queue deck is an order, not a preference.
 */
export function useEpicQueueVerbs(): { moveEpic(epic: string, move: DispatcherQueueMove): Promise<boolean> } {
  const { t } = useTranslation();
  const { send } = useVerbSend<'queue'>({
    keep: [],
    titles: { refused: () => t('dispatcher.queue.refused'), done: () => t('dispatcher.queue.moved') },
  });
  const moveEpic = useCallback(
    // The names the sentence is about, so an epic literally called `plan` or `arc` is never read as the word.
    (epic: string, move: DispatcherQueueMove) => send('queue', () => api.dispatcher.arcQueue(epic, move), 'before' in move ? [epic, move.before] : [epic]),
    [send],
  );
  return { moveEpic };
}
