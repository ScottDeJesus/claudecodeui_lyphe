import { useMemo } from 'react';

import { useEpicQueueVerbs } from '@/modules/dispatcher';
import { useSortable } from '@/shared/ui/sortable/useSortable';
import type { SortableList } from '@/shared/ui/sortable/useSortable';
import type { DispatcherArcGroup } from '@/shared/types';

/**
 * THE QUEUE'S DECK LIST, MADE THE OPERATOR'S TO REORDER — the wiring of In flight's first list, apart from
 * `RunnerPanel` so the pane keeps its measure.
 *
 * A DROP HERE IS AN ORDER, NOT A PREFERENCE: the queue's decks stand in the order the dispatcher starts
 * their epics in, so moving one moves the epic in the dispatcher's queue (`dispatcher queue <epic>`), and
 * the next frame draws the order the store now holds. The move's answer goes back to the list, which keeps
 * the dropped order only until then (`dropHold.ts`) and puts it back on a refusal, rather than snapping
 * to the old order while the write is out.
 *
 * ONE MOVE, NAMED BY A NEIGHBOUR: the carried epic goes `--before` the queue deck it now stands in front
 * of, or `--last` when it lands last. A queue deck the operator has put away is not drawn, so a place on
 * screen is never an index into the queue — the neighbour is the same epic on screen and in the store.
 *
 * Used by `RunnerPanel`, for the `DispatchArcDecks` it draws first (`line`).
 */
export function useQueueLineSort(line: readonly DispatcherArcGroup[]): SortableList {
  const keys = useMemo(() => line.map((group) => group.arc.name), [line]);
  // ── The wire: the board's one queue move (`dispatcher queue <epic> --before <epic> | --last`), answering
  //    whether the dispatcher took it. Everything below it is composition. ──
  const { moveEpic } = useEpicQueueVerbs();
  return useSortable({
    keys,
    onReorder: (carried, order) => {
      const next = order[order.indexOf(carried) + 1];
      return moveEpic(carried, next === undefined ? { last: true } : { before: next });
    },
  });
}
