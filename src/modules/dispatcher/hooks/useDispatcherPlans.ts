import { useMemo } from 'react';

import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { useHiddenPlans } from '@/modules/dispatcher/hiddenPlans';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { DispatcherArc, DispatcherDaemon, DispatcherLanePicture, DispatcherPlan, DispatcherPlanner, DispatcherRoute } from '@/shared/types';

/**
 * The lane's read side: every plan the dispatcher's store holds, every planner outing of it and
 * this box's posture beside them.
 *
 * IT READS THE BUS AND NEVER THE SOCKET OR THE API. `DispatcherFeed` is the only thing in the
 * client that names the `dispatcher_state` frame; everything downstream of it — this hook, the plan
 * cards, the tab's count — reads a retained topic and knows nothing about how it got there. That is
 * what lets a card mount at any moment and paint on its FIRST render with the picture the bus was
 * already holding, rather than blank until the dispatcher next moves.
 *
 * `undefined` (nothing retained yet) and an empty lane collapse to the same reading on purpose: to a
 * screen they are the same instruction — draw nothing — and a caller forced to tell them apart would
 * grow a loading state for a fact that arrives in the same tick as the mount. `route` and `daemon`
 * are `null` then rather than a made-up default, because a posture the app has not been told is not
 * a posture it may state.
 *
 * A PLAN THE OPERATOR HID IS STILL ON THE LANE, AND THIS IS WHERE THE HIDE TAKES EFFECT, so the tab's
 * badge and its list agree. The list is `hiddenPlans` under the `dispatcher` preference
 * (`hiddenPlans.ts`): a plan's name beside the moment it was hidden. The lane splits in two here,
 * into `plans` (drawn) and `hidden` (the `Hidden` list's). A hide holds the plan that stood under its
 * name at the press, and it lets go by itself only when that plan reaches its FIRST ending after the
 * press: an ending the operator never saw is news. The store stamps `completed_at` once and never
 * clears it, so a finished plan re-cut and walked again under its hide stays hidden until `Show`.
 */
export function useDispatcherPlans(): {
  /** The plans this screen DRAWS: the lane less the hidden ones, in the lane's order. */
  plans: DispatcherPlan[];
  /** The lane's hidden plans, in the lane's order: what the `Hidden` list at the foot of both homes offers back. */
  hidden: DispatcherPlan[];
  /**
   * The arcs the lane carries — each with its own word, its derived status and the NAMES of its
   * plans. Every one of them has at least one plan still on the lane (the server drops the rest, so
   * an arc's deck can never stand over nothing), and a plan of one names it in `plan.arc`: the two
   * halves read the same document, and this is that join's other side.
   */
  arcs: DispatcherArc[];
  /** How many plans are DRAWN: the tab's badge and the pane's own count. A hidden plan is not counted. */
  count: number;
  /**
   * Whether the Runner tab belongs on the bar: a plan is drawn, or a hidden plan has not finished. A
   * lane whose every plan is hidden but one of them is still walking must keep its tab, or the way
   * back to that plan (the `Hidden` list) would be unreachable while it runs.
   */
  laneOpen: boolean;
  route: DispatcherRoute | null;
  daemon: DispatcherDaemon | null;
  /**
   * Every planner outing the lane carries, in the store's own `id` order: the souls out now, the work
   * waiting behind them, and the endings whose work is still unfinished (`DispatcherPlanner`). It is
   * the store's own list, unfiltered — a plan card and a deck header read their own outing off
   * `plan.planner` and `arc.planner`, which come out of this same list, so the three cannot disagree.
   */
  planners: DispatcherPlanner[];
  /**
   * The outings with NO card and NO deck to be drawn in — what the Runner tab's two homes draw as
   * badges above the arc decks. Empty on an ordinary lane.
   */
  loosePlanners: DispatcherPlanner[];
  /** The dispatcher's next DeepSeek off-peak moment, epoch SECONDS, or `null` when the clock answered `none` or nothing is retained. */
  offpeakAt: number | null;
  /** Every plan name the lane carries, hidden or not: what a hide or a show prunes the stored list against. */
  carriedNames: string[];
} {
  const value = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);
  const entries = useHiddenPlans();

  return useMemo(() => {
    const picture = value?.payload;
    const lane = Array.isArray(picture?.plans) ? picture.plans : [];
    // One entry per name is the store's own guarantee (`hiddenPlans.ts`), so a map loses nothing.
    const hiddenAt = new Map(entries.map((entry) => [entry.name, entry.at]));
    const plans = lane.filter((plan) => !isHiddenPlan(plan, hiddenAt));
    const hidden = lane.filter((plan) => isHiddenPlan(plan, hiddenAt));

    // The UNFILTERED lane on purpose: every write prunes the stored list against every name the lane
    // still carries, and pruning against the drawn `plans` would drop every earlier hide the moment a
    // second one was made. The dispatcher still holds those plans, so they would come straight back
    // as cards.
    const carriedNames = lane.map((plan) => plan.name);

    // THE ARCS THE SCREEN ACTUALLY HAS CARDS FOR, which is one step stricter than the lane's own
    // list: the server drops an arc with no plan left on the lane, and a HIDDEN plan is on the lane
    // but not on the screen. An arc whose every card the operator has hidden would otherwise leave a
    // header standing over nothing, which no further frame would ever clear.
    const drawn = new Set(plans.map((plan) => plan.name));
    const arcs = (Array.isArray(picture?.arcs) ? picture.arcs : [])
      .filter((arc) => arc.plans.some((name) => drawn.has(name)));

    const planners = Array.isArray(picture?.planners) ? picture.planners : [];

    return {
      plans,
      arcs,
      planners,
      // Asked of what this screen DRAWS, never of the frame's own lists: a hidden plan, or an arc
      // every one of whose cards the operator has hidden, draws no card for its outing's badge to
      // ride, and a soul at work there would otherwise be invisible on a lane still carrying it.
      loosePlanners: plannersWithNoHome(planners, plans, arcs),
      hidden,
      count: plans.length,
      laneOpen: plans.length > 0 || hidden.some((plan) => plan.status !== 'complete'),
      route: picture?.route ?? null,
      daemon: picture?.daemon ?? null,
      offpeakAt: epochOf(picture?.offpeak_at ?? null),
      carriedNames,
    };
  }, [value, entries]);
}

/**
 * Whether the operator's hide still holds this plan: an entry names it, the plan already EXISTED at
 * the press, and it has not ENDED since. The entry carries a moment for both reasons: a card shown
 * again costs a look, a card hidden twice costs the operator a plan they never saw finish.
 *
 * - A plan CREATED after the press is a different plan under a reused name (dropped and opened
 *   again), and the hide was never of it. An entry outlives its plan until the next hide or show
 *   prunes it, so without this gate a re-opened plan would be born hidden. A `created_at` nothing can
 *   parse cannot prove it is newer, and the hide holds.
 * - A plan that has not ended (`completed_at` null) or cannot be dated stays hidden, and so does one
 *   whose ending is at or before the press, which the operator had in front of him when he hid it. One
 *   that ended AFTER it comes back as a card.
 *
 * Every side is epoch SECONDS: `at` as `hidePlans` stamps it, the two stamps through `epochOf`, so a
 * hide and this reading compare one number and not two spellings of one moment. A carried dismissal
 * passes the creation gate by construction: its `at` is the plan's own ending, which follows its birth.
 */
function isHiddenPlan(plan: DispatcherPlan, hiddenAt: ReadonlyMap<string, number>): boolean {
  const at = hiddenAt.get(plan.name);
  if (at === undefined) return false;
  const createdAt = epochOf(plan.created_at);
  if (createdAt !== null && createdAt > at) return false;
  const endedAt = epochOf(plan.completed_at);
  return endedAt === null || endedAt <= at;
}

/**
 * The outings whose `target` — and whose `plan` — name no plan and no arc this screen draws.
 *
 * THE ONE CASE IT EXISTS FOR IS AN ARC'S DESIGN BEFORE ITS ARC FILE LOADS. `dispatcher design
 * <arc> --arc` writes a planner row for a name the store holds no arc for yet: the arc's own file
 * is what opens the arc and the plans of it, and until that load lands, no card and no deck on the
 * screen answers to that name. The store's document is built for exactly this — the row is carried,
 * and it is the only thing that says the arc is being designed — so a client that drew only
 * `plan.planner` and `arc.planner` would show the operator nothing at all while a soul is out on the
 * arc he has just asked for.
 *
 * BOTH NAMES ARE ASKED BECAUSE BOTH ARE SCOPES (`store_planners._subjects`): `target` is the work the
 * outing is FOR and `plan` the name it LANDS in, which differ only for a judgment — an outing whose
 * `target` is the arc and whose `plan` is `<arc>--judgment`. The store holds both BARE, so this
 * compares the document's own bare names and never strips an adornment.
 */
function plannersWithNoHome(
  planners: DispatcherPlanner[],
  plans: DispatcherPlan[],
  arcs: DispatcherArc[],
): DispatcherPlanner[] {
  const named = new Set<string>();
  for (const plan of plans) named.add(plan.name);
  for (const arc of arcs) named.add(arc.name);
  return planners.filter((planner) => !named.has(planner.target) && !named.has(planner.plan));
}
