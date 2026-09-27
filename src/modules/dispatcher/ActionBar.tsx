import type { ReactNode } from 'react';

/**
 * A card's ONE row of presses, directly under its head: the verbs its status allows on the left, the
 * model switch at the row's end. The plan card and the arc deck both draw exactly this row, so a
 * reader who learned one card's controls has learned the other's — same place, same order, same size.
 *
 * `model` rides `ml-auto`, so it sits at the row's END whether or not a verb shares the row — the
 * switch keeps one place on every card, and a reader looking for it looks right. The row wraps, so on
 * a narrow card the switch drops under the verbs, still at the end, rather than pushing either off
 * the card.
 *
 * EVERY CONTROL IN IT IS 32px TALL (`h-8`), set by each control this module puts here
 * (`PlanControls`, `DispatchArcControls`, `ScheduleControl`, `RunModelControl`) rather than by a
 * descendant rule on this row: the model switch is a bordered group of buttons, and a rule sizing
 * every button in the row would size the group's own options past the group.
 *
 * IT DRAWS NOTHING when there is neither a verb nor a switch — a complete plan, whose next phase does
 * not exist for a word to reach and whose walk has no verb left — so a card never keeps an empty row.
 *
 * `data-action-bar` is the harness's handle: a probe reads that this row is the first thing under the
 * head.
 *
 * Used by `PlanControls` and `DispatchArcControls`.
 */
export function ActionBar({ verbs, model }: { verbs: ReactNode; model: ReactNode | null }) {
  const hasVerbs = verbs !== null && verbs !== undefined && verbs !== false;
  if (!hasVerbs && model === null) return null;

  return (
    <div data-action-bar className="flex min-w-0 flex-wrap items-center gap-2">
      {verbs}
      {model !== null && <div className="ml-auto flex">{model}</div>}
    </div>
  );
}
