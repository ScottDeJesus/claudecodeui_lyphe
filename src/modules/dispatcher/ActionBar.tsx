import type { ReactNode } from 'react';

/**
 * A card's controls, directly under its head: ONE row of the verbs its status allows, and under it the
 * card's FOLD of overrides (`OverrideFold`) — an epic's feature and task limits and its model, a feature's
 * model — closed by default, folded to one line that names whatever it holds. The plan card and the arc
 * deck both draw exactly this, so a reader who learned one card's controls has learned the other's — same
 * place, same order, same size.
 *
 * The verbs row wraps, so on a narrow card a verb drops under its neighbour rather than pushing it off the
 * card. EVERY BUTTON IN IT IS 32px TALL (`h-8`) AT A DESK AND 44px UNDER A FINGER (`finger:h-11`: a touch screen, or a window
 * under 768 px), set by each control this module puts here (`PlanControls`, `DispatchArcControls`, `ScheduleControl`)
 * rather than by a descendant rule on this row.
 *
 * IT DRAWS NOTHING when there is neither a verb nor a fold — a complete plan, whose next phase does not exist
 * for a word to reach and whose walk has no verb left — so a card never keeps an empty row.
 *
 * `data-action-bar` is the harness's handle: a probe reads that this is the first thing under the head.
 *
 * Used by `PlanControls` and `DispatchArcControls`.
 */
export function ActionBar({ verbs, fold }: { verbs: ReactNode; fold: ReactNode | null }) {
  const hasVerbs = verbs !== null && verbs !== undefined && verbs !== false;
  if (!hasVerbs && fold === null) return null;

  return (
    <div data-action-bar className="flex min-w-0 flex-col gap-1">
      {hasVerbs && <div className="flex min-w-0 flex-wrap items-center gap-2">{verbs}</div>}
      {fold}
    </div>
  );
}
