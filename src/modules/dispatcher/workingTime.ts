import type { DispatcherArc, DispatcherPlan, DispatcherPlanner } from '@/shared/types';

/**
 * Whether an outing of the lane's own list is OUT on `name` — a planner child at work whose `target` or
 * `plan` is that name, which are the rows `report_runtime` counts for it.
 */
function outingOut(planners: readonly DispatcherPlanner[], name: string): boolean {
  return planners.some((outing) => outing.state === 'out' && (outing.target === name || outing.plan === name));
}

/**
 * Whether an agent is out on this plan RIGHT NOW: a walk with a soul out or its walker alive on one of
 * its phases (`phase.busy`, the chain layer's own answer and the one the dispatcher's open intervals are
 * made from), or a planner outing of its own that is `out`. This is what lets its working time tick
 * between frames, and nothing else does: a plan that is `live` and waiting — on its epic's WIP slot, on
 * another feature — has no agent out, and a clock running there would be saying it works.
 *
 * An outing counts only where the plan is its own subject; the epic's design or cut is the epic's time
 * (`arcAgentOut`) and not any one feature's.
 *
 * Used by `PlanCard`, for its head's working pill, and by `arcAgentOut`.
 */
export function planAgentOut(plan: DispatcherPlan, planners: readonly DispatcherPlanner[]): boolean {
  return plan.phases.some((phase) => phase.busy) || outingOut(planners, plan.name);
}

/**
 * Whether an agent is out on this epic right now: on any plan of it, or on an outing whose subject is the
 * epic itself — its design, its cut, its judge. `lanePlans` is every plan the lane carries, the ones the
 * operator put away included (`useDispatcherPlans`' `plans` and `hidden`): a hidden plan is still walked
 * and the epic's figure counts it, so a tick that skipped it would stand still over work that is moving.
 *
 * Used by `DispatchArcDeck`, for its head's working pill.
 */
export function arcAgentOut(arc: DispatcherArc, lanePlans: readonly DispatcherPlan[], planners: readonly DispatcherPlanner[]): boolean {
  const members = new Set(arc.plans);
  return outingOut(planners, arc.name) || lanePlans.some((plan) => members.has(plan.name) && planAgentOut(plan, planners));
}
