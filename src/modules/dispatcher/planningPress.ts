import type {
  DispatcherArc,
  DispatcherPlan,
  DispatcherPlanner,
  DispatcherRoute,
  PlanningLine,
  PlanningPausedVia,
  PlanningPress,
} from '@/shared/types';

/**
 * Whose planning pause stands on this feature: its own (`own`), else its epic's (`epic` — the feature carries `null` of its own then, and the
 * epic's Resume planning, on the epic's Planning line, is what lifts it), else none. One answer for the places that ask it: the card head's
 * line, the feature's Planning line (`planningLines`: its press through `featurePress`, and no line of its own while the epic's pause holds it)
 * and Resume planner's stand-down, so the screen cannot say "paused" in one place and offer a way back in another.
 *
 * A COMPLETE FEATURE IS HELD BY NOTHING: none of its planning is left to hold (the dispatcher ends a plan's own brake at its finish), so
 * its epic's pause over it is no word for its head — the same finished subject `featurePress` draws no press for. THE KEY IS READ BY
 * TRUTHINESS, as the lane reads `overridden` and `stalled`: a picture built without it (an older dispatcher's, a probe's pushed one) is
 * no pause, never a standing one.
 *
 * Used by `PlanCard` (which line its head draws), `PlanControls` (whether Resume planner stands down) and `planningLines` (whether a
 * feature has a line, and whether it reads paused), and by `featurePress` below.
 */
export function planningPausedVia(plan: DispatcherPlan, epic: DispatcherArc | null): PlanningPausedVia | null {
  if (plan.status === 'complete') return null;
  if (plan.planning_paused) return 'own';
  return epic?.planning_paused ? 'epic' : null;
}

/**
 * Which press a FEATURE's Planning line draws — the dispatcher's refusals and its reach rule, read off the document and never a second answer:
 *
 * - none for a `complete` feature (none of its planning is left to hold);
 * - Resume planning wherever the feature's OWN pause stands;
 * - none while only its EPIC's stands: the dispatcher refuses `resume-planning <feature>` then, naming the epic's, and the epic's
 *   Resume planning lifts it — so a feature's line never offers a press that names its epic;
 * - none for a `parked` feature (nothing is planned until Unpark), an ACCEPTED one (the walk's Stop is its pause, and ends its planner
 *   too), and one whose planner entry is its epic's whole-arc outing — an entry naming the feature neither as `target` nor as `plan`: a
 *   feature's pause never reaches that outing, so the press would leave the designer working, and the epic's press is the one that does;
 * - else Pause planning.
 *
 * A HIDDEN FEATURE IS READ LIKE ANY OTHER: there is no `hidden` clause. A hide holds the walk and nothing of the planning (`dispatcher hide`
 * signals no planner, and the dispatcher takes both verbs on a hidden plan), and the Planning card lists a hidden feature's outing, so its
 * line is the one place its brake is pressed. That a hidden plan's CARD draws only Show (`PlanControls`) is the card's bar and not a line's:
 * carried onto the line it would leave a paused, put-away feature reading `Planning paused` with no way back until it was shown. `parked` is
 * read off the plan's STATE, not its status word, for the same put-away case — a hide outranks `parked` in the status (and an epic's Hide
 * takes its parked plans along), so the status would let a put-away parked feature through to a Pause planning with nothing being planned.
 *
 * Used by `planningLines`, for a feature's line.
 */
export function featurePress(plan: DispatcherPlan, epic: DispatcherArc | null): PlanningPress | null {
  if (plan.status === 'complete') return null;
  const heldBy = planningPausedVia(plan, epic);
  if (heldBy === 'own') return 'resume';
  if (heldBy === 'epic') return null;
  if (plan.state === 'parked' || plan.approved !== null) return null;
  const outing = plan.planner;
  if (outing !== null && outing.target !== plan.name && outing.plan !== plan.name) return null;
  return 'pause';
}

/**
 * Which press an EPIC's Planning line draws: none for a `complete` or `empty` epic; Resume planning wherever the epic's own pause
 * stands (read by truthiness, as `planningPausedVia` reads it); Pause planning while the epic's OWN outing stands on the document
 * (`arc.planner`: its design, its whole-arc cut or its judgment) — which is exactly when an epic has a line that is not a pause — else none.
 * A feature's outing is the FEATURE's line, whose press holds that feature alone; an epic whose features are being planned with nothing of
 * its own out has no line, so there is no epic-wide press to draw for it. A `hidden` epic — every open plan of it put away — is read like
 * any other, for a hidden feature's reason (`featurePress`): a hide holds the walk and not the planning, and its line is where its brake is.
 *
 * Used by `planningLines`, for an epic's line.
 */
export function epicPress(arc: DispatcherArc): PlanningPress | null {
  if (arc.status === 'complete' || arc.status === 'empty') return null;
  if (arc.planning_paused) return 'resume';
  return arc.planner !== null ? 'pause' : null;
}

/**
 * Which press a LOOSE outing's Planning line draws — the outing of an epic with no feature yet, a target no plan and no epic of the lane
 * names (`planningLines` asks the whole lane first, put-away plans included, so a put-away feature's outing is that feature's line):
 * Resume planning while the entry reads paused and Pause planning otherwise.
 *
 * THE ENTRY'S OWN FLAG IS THE READING because the pause ENDS the outing: the entry then stands as an ended, stalled one, and the house
 * still marks it paused (`report_planners.mark_paused`, every state), so the line never draws Pause planning again — refused as
 * already paused — with no Resume anywhere on the screen.
 *
 * Used by `planningLines`, for a loose outing's line.
 */
export function loosePress(planner: DispatcherPlanner): PlanningPress {
  return planner.planning_paused ? 'resume' : 'pause';
}

/**
 * Which press the Planning card's HEAD draws for PAUSE ALL'S PLANNING EXCEPTION (`route.epics`, `dispatcher epics run-planning` /
 * `hold-planning`) — one press for the whole house, apart from the lines' own per-subject brake, and a reading of the frame like the
 * others here:
 *
 * - none while Pause all is off (`epics.paused` false: planning already runs, and the dispatcher refuses either word) and against a
 *   dispatcher older than the census (`epics` null: the controls are not drawn);
 * - Pause planning while planning is let through (`planning_through`), whether or not anything is being planned: the exception is a
 *   standing fact the operator must be able to see and take back;
 * - Resume planning while Pause all holds planning AND a line is waiting on it — a QUEUED outing whose subject's own planning pause is
 *   not what holds it (that line says `Planning paused` and has its own Resume). An outing already out finishes under Pause all, an
 *   ended one is the stalled card's, and a card with nothing queued has nothing to resume.
 *
 * Used by `PlanningCard`, for the strip under its title.
 */
export function dialPress(epics: DispatcherRoute['epics'], lines: readonly PlanningLine[]): PlanningPress | null {
  if (epics === null || !epics.paused) return null;
  if (epics.planning_through) return 'pause';
  return lines.some((line) => !line.paused && line.outing?.state === 'queued') ? 'resume' : null;
}
