import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { epicPress, featurePress, loosePress, planningPausedVia } from '@/modules/dispatcher/planningPress';
import type { DispatcherArc, DispatcherPlan, DispatcherPlanner, PlanningLine } from '@/shared/types';

/** Which of a subject's outings its line words: the one out, else the one waiting, else the ending. Lower ranks first. */
const STATE_RANK: Record<DispatcherPlanner['state'], number> = { out: 0, queued: 1, ended: 2 };

/**
 * WHAT IS BEING PLANNED, one line per subject, in the order the Planning card draws them (`PlanningLine`).
 *
 * A SUBJECT IS AN OUTING'S `target`: the thing it is FOR — a feature, or an epic for its design, its whole-arc cut and its judgment
 * (whose `plan` is `<epic>--judgment`, a name no plan answers). Several entries on one target are one line, worded by the outing that
 * matters most (`STATE_RANK`).
 *
 * A LINE KEEPS ITS PLACE, whatever its outing does: the lines stand in the order their subjects were made (the plan's or the epic's own
 * `created_at`, then the name), and a loose epic — which the lane holds no row for — after them, by name. Never the outings' order: a
 * Resume planning or a retry sends a stalled outing back as a NEW row, and a list ordered by rows would move the line the operator just
 * pressed out from under his eye.
 *
 * THE WHOLE LANE IS ASKED, put away or not: `plans` and `arcs` are the frame's own lists, never the drawn ones. A hidden feature still
 * has its designer out, and the Planning card is the one place the planning press lives, so a subject is never missing from it — nor
 * its Resume planning — because its card is put away. A target the lane names neither as a plan nor as an epic is an epic's design before its arc file loads — a
 * feature's design opens its plan row first (`planner_rows.queue_design`) — so it is a LOOSE epic line, pressed through the arc door, which
 * the dispatcher resolves by name.
 *
 * A PAUSE STANDS ON ITS LINE AFTER ITS OUTING HAS GONE: the subject's OWN pause (`planningPausedVia` reading `own`, an epic's
 * `planning_paused`) draws a line with no outing until Resume planning lifts it, in its subject's place like any other. A
 * feature its epic's pause holds (`planningPausedVia` reading `epic`) draws NO line of its own, whatever outing the document still carries for
 * it — the pause leaves a queued one standing and an ended one stalled, both marked held: the epic's line says `Planning paused` and holds the
 * one Resume the dispatcher takes, and the feature's card head says `Planning paused with its epic`. Worded by its outing, such a line would
 * read as work about to start, or as amber work that wants a hand, with no press to give it. A complete subject is held by nothing and draws
 * no pause line.
 *
 * `drawn` IS THE SCREEN'S ANSWER, not the lane's: the names of the plans and epics that have their own card or deck on this screen
 * (`useDispatcherPlans`' drawn `plans` and `arcs`). A line whose subject has none — a loose epic, or a feature or epic the operator has put
 * away — is the only place left for that outing's pace hold and its Override, so the line carries them; a drawn card or deck carries its own.
 *
 * THE PRESS IS THE READINGS' ANSWER, never chosen here (`featurePress`, `epicPress`, `loosePress`): the dispatcher's own refusals, read off
 * the same document.
 *
 * Used by `useDispatcherPlans`, which reads it once per frame as its `planning`.
 */
export function planningLines(
  plans: readonly DispatcherPlan[],
  arcs: readonly DispatcherArc[],
  planners: readonly DispatcherPlanner[],
  drawn: ReadonlySet<string>,
): PlanningLine[] {
  const planOf = new Map(plans.map((plan) => [plan.name, plan]));
  const arcOf = new Map(arcs.map((arc) => [arc.name, arc]));
  const epicOf = (plan: DispatcherPlan) => (plan.arc === null ? null : arcOf.get(plan.arc) ?? null);

  // One outing per target: the one out, else the one waiting, else the ending.
  const outings = new Map<string, DispatcherPlanner>();
  for (const planner of planners) {
    const held = outings.get(planner.target);
    if (held === undefined || STATE_RANK[planner.state] < STATE_RANK[held.state]) outings.set(planner.target, planner);
  }

  const lines: PlanningLine[] = [];
  for (const [target, outing] of outings) {
    const plan = planOf.get(target);
    const arc = arcOf.get(target);
    if (plan !== undefined) {
      const epic = epicOf(plan);
      const heldBy = planningPausedVia(plan, epic);
      // Its epic's pause holds it: the epic's line is the one that says so and lifts it (header).
      if (heldBy === 'epic') continue;
      lines.push({ name: target, kind: 'feature', loose: false, drawn: drawn.has(target), outing, paused: heldBy === 'own', press: featurePress(plan, epic), scope: 'plan' });
    } else if (arc !== undefined) {
      lines.push({ name: target, kind: 'epic', loose: false, drawn: drawn.has(target), outing, paused: Boolean(arc.planning_paused), press: epicPress(arc), scope: 'arc' });
    } else {
      lines.push({ name: target, kind: 'epic', loose: true, drawn: false, outing, paused: outing.planning_paused, press: loosePress(outing), scope: 'arc' });
    }
  }

  // The pauses with no outing left on the document: the subject stays listed, with its Resume, until the pause is lifted.
  for (const plan of plans) {
    if (outings.has(plan.name) || planningPausedVia(plan, epicOf(plan)) !== 'own') continue;
    lines.push({ name: plan.name, kind: 'feature', loose: false, drawn: drawn.has(plan.name), outing: null, paused: true, press: featurePress(plan, epicOf(plan)), scope: 'plan' });
  }
  for (const arc of arcs) {
    if (outings.has(arc.name) || !arc.planning_paused || arc.status === 'complete') continue;
    lines.push({ name: arc.name, kind: 'epic', loose: false, drawn: drawn.has(arc.name), outing: null, paused: true, press: epicPress(arc), scope: 'arc' });
  }

  // The subjects' own making, in epoch seconds; a loose epic (no row on the lane) and an undatable stamp sort after every dated one.
  const madeAt = (line: PlanningLine) =>
    (line.loose ? null : epochOf((line.kind === 'feature' ? planOf.get(line.name) : arcOf.get(line.name))?.created_at ?? null)) ?? Infinity;
  const made = new Map(lines.map((line) => [line.name, madeAt(line)]));
  return lines.sort((a, b) => (made.get(a.name) ?? Infinity) - (made.get(b.name) ?? Infinity) || a.name.localeCompare(b.name));
}
