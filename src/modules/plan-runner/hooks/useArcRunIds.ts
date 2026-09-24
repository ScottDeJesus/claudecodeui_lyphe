import { useMemo } from 'react';

import { arcOwnedRunIds } from '@/modules/plan-runner/arcState';
import { useArcs } from '@/modules/plan-runner/hooks/useArcs';

/**
 * The run ids the decks on the lane own, for a run list that must not draw one of them twice.
 *
 * `arcOwnedRunIds` is the rule and it is PURE — it takes the arcs and answers with a set — so both
 * run lists read the same line of reasoning instead of each re-deriving it from the snapshots.
 * This hook is only the reading of the bus on top of it: `useArcs()` hands over the decks the
 * gallery is drawing, and the set is recomputed when that array changes, which is exactly when a
 * card gains or loses a run.
 *
 * The set is empty while no arc is drawn, so a caller's filter is the identity on a host with no
 * arcs — the decks cost the run lists nothing.
 *
 * Used by `RunnerPanel` (the tab) and `RunnerWidgetBody` (the chat gutter), each subtracting it
 * from the runs it lists beneath the deck.
 */
export function useArcRunIds(): Set<string> {
  const { arcs } = useArcs();
  return useMemo(() => arcOwnedRunIds(arcs), [arcs]);
}
