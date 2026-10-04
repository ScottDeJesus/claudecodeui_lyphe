import { useEffect, useMemo } from 'react';

import { askIdentity } from '@/modules/dispatcher/askState';
import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { noteLaneClock, usePutAwayEntries } from '@/modules/dispatcher/hiddenPlans';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { DispatcherArc, DispatcherAsk, DispatcherDaemon, DispatcherLanePicture, DispatcherPlan, DispatcherPlanner, DispatcherRoute } from '@/shared/types';

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
 * A PLAN THE OPERATOR PUT AWAY IS STILL ON THE LANE, AND THIS IS WHERE THE PRESS TAKES EFFECT, so the
 * tab's badge and its lists agree. The entries are `hiddenPlans` under the `dispatcher` preference
 * (`hiddenPlans.ts`): a plan's name beside the moment it was put away. Every plan of the lane reads as
 * ONE of three here (`putAwayReading`): DRAWN (`plans`), HIDDEN (`hidden`, the `Hidden` list's, which
 * holds only unfinished plans) or DISMISSED, a done plan that is on no list and in no count at all.
 */
export function useDispatcherPlans(): {
  /** The plans this screen DRAWS: the lane less the hidden and the dismissed ones, in the lane's order. */
  plans: DispatcherPlan[];
  /**
   * The lane's hidden plans, in the lane's order: what the `Hidden` list at the foot of both homes
   * offers back. Every one is unfinished; a done plan put away is dismissed, and is not here.
   */
  hidden: DispatcherPlan[];
  /**
   * The arcs the lane carries — each with its own word, its derived status and the NAMES of its
   * plans. Every one of them has at least one plan still on the lane (the server drops the rest, so
   * an arc's deck can never stand over nothing), and a plan of one names it in `plan.arc`: the two
   * halves read the same document, and this is that join's other side.
   */
  arcs: DispatcherArc[];
  /** How many plans are DRAWN: the tab's badge and the pane's own count. A hidden or dismissed plan is not counted. */
  count: number;
  /**
   * How many prompts the DRAWN plans are waiting on — the distinct open asks, by `askIdentity`
   * (`askState.ts`), across the plans this screen draws.
   *
   * COUNTED BY IDENTITY, NOT BY CARD: a lock names every plan of its arc still owing an Accept, and
   * the operator owes that ONE answer however many cards carry it — so the amber mark the In flight face puts
   * on the tab strip and the warn tone on the widget's badge count questions, not plans. Asked of the drawn plans
   * alone, like `count`, because a plan the operator has put away draws no card his word could reach.
   */
  waiting: number;
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
   * The outings with NO card and NO deck to be drawn in — what both homes, the Roadmap tab's In flight
   * face and the chat gutter's widget, draw as badges above the arc decks. Empty on an ordinary lane.
   */
  loosePlanners: DispatcherPlanner[];
  /** The dispatcher's next DeepSeek off-peak moment, epoch SECONDS, or `null` when the clock answered `none` or nothing is retained. */
  offpeakAt: number | null;
  /**
   * Every plan name AND every arc name the lane carries, put away or not: what a write prunes the
   * stored lists against — the hidden plans (`hiddenPlans.ts`, plan names) and the card order
   * (`cardOrderEntries.ts`, plan and arc names, which never collide).
   */
  carriedNames: string[];
} {
  const value = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);
  const entries = usePutAwayEntries();
  // The frame's server stamp is the floor a press's moment is held to (`noteLaneClock`): an effect,
  // because it only has to land before the next press, and a press is an event after this commit.
  useEffect(() => noteLaneClock(value?.at), [value]);

  return useMemo(() => {
    const picture = value?.payload;
    const lane = Array.isArray(picture?.plans) ? picture.plans : [];
    // One entry per name is the store's own guarantee (`hiddenPlans.ts`), so a map loses nothing.
    const entryOf = new Map(entries.map((entry) => [entry.name, entry]));
    const arcNews = arcNewsOf(lane);
    const plans = lane.filter((plan) => putAwayReading(plan, entryOf.get(plan.name), arcNews) === 'drawn');
    const hidden = lane.filter((plan) => putAwayReading(plan, entryOf.get(plan.name), arcNews) === 'hidden');

    // The UNFILTERED lane on purpose: every write prunes the stored list against every name the lane
    // still carries, and pruning against the drawn `plans` would drop every earlier entry the moment
    // a second one was made. The dispatcher still holds those plans, so they would come straight back
    // as cards. The arcs the lane carries ride along for the card order, whose entries name decks too:
    // an arc whose every plan is put away has no deck drawn, and its place is still its own.
    const carriedNames = [...lane.map((plan) => plan.name), ...(Array.isArray(picture?.arcs) ? picture.arcs : []).map((arc) => arc.name)];

    // THE ARCS THE SCREEN ACTUALLY HAS CARDS FOR, which is one step stricter than the lane's own
    // list: the server drops an arc with no plan left on the lane, and a put-away plan is on the lane
    // but not on the screen. An arc whose every card the operator has put away would otherwise leave a
    // header standing over nothing, which no further frame would ever clear.
    const drawn = new Set(plans.map((plan) => plan.name));
    const arcs = (Array.isArray(picture?.arcs) ? picture.arcs : [])
      .filter((arc) => arc.plans.some((name) => drawn.has(name)));

    const planners = Array.isArray(picture?.planners) ? picture.planners : [];

    // THE PROMPTS STILL OWED, by identity — one ask is ONE question however many cards carry it (a
    // lock names every plan of its arc), and only the drawn ones count: a plan the operator has put
    // away shows no card his word could reach.
    const waiting = new Set(plans.map(planAsking).filter((ask): ask is DispatcherAsk => ask !== null).map(askIdentity)).size;

    return {
      plans,
      arcs,
      planners,
      // Asked of what this screen DRAWS, never of the frame's own lists: a put-away plan, or an arc
      // every one of whose cards the operator has put away, draws no card for its outing's badge to
      // ride, and a soul at work there would otherwise be invisible on a lane still carrying it.
      loosePlanners: plannersWithNoHome(planners, plans, arcs),
      hidden,
      count: plans.length,
      waiting,
      route: picture?.route ?? null,
      daemon: picture?.daemon ?? null,
      offpeakAt: epochOf(picture?.offpeak_at ?? null),
      carriedNames,
    };
  }, [value, entries]);
}

/**
 * How the operator's entry for this plan reads NOW: `drawn` (no entry, or it has let go), `hidden` (it
 * holds an unfinished plan) or `dismissed` (it holds a done one). The plan decides between the last
 * two, never the press, so a done plan that sat in `Hidden` from before Dismiss existed is dismissed.
 *
 * - A plan CREATED after the press is a different plan under a reused name (dropped and opened
 *   again), and the entry was never of it. An entry outlives its plan until the next press or show
 *   prunes it, so without this gate a re-opened plan would be born put away. A `created_at` nothing
 *   can parse cannot prove it is newer, and the entry holds.
 * - A plan that ENDED after the press comes back as a card: an ending the operator never saw is news.
 *   One that has not ended, cannot be dated, or ended at or before the press (he had that ending in
 *   front of him) stays put away.
 * - A plan whose ASK is newer than the press comes back too: a prompt is news beside an ending, and
 *   the louder of the two, because a plan that owes the operator a word cannot move without him and a
 *   card he cannot see is a card he cannot answer. The press it respects is the one made AFTER the ask
 *   (`newestMoment`): a Hide with that prompt already on the screen was a decision about a plan he had
 *   just read, and it holds.
 * - Held, a plan that is not complete is HIDDEN, because unfinished work must stay reachable. That
 *   covers a done plan re-cut and walking again under its dismissal: it waits in `Hidden` while it
 *   walks, and comes back as a card at the new ending.
 *
 * - An entry an ARC's corner wrote reads the arc's news instead of its own plan's: the newest
 *   creation, ending or ask across every plan of that arc the lane carries (`arcNewsOf`), so an arc
 *   pressed away returns whole the moment one plan of it is asked.
 *
 * Every side is epoch SECONDS: `at` as `putAwayPlans` stamps it, the stamps through `epochOf`, so an
 * entry and this reading compare one number and not two spellings of one moment.
 */
function putAwayReading(
  plan: DispatcherPlan,
  entry: { at: number; arc?: string } | undefined,
  arcNews: ReadonlyMap<string, number>,
): 'drawn' | 'hidden' | 'dismissed' {
  if (entry === undefined) return 'drawn';
  // An ARC PRESS lets go as one (`hiddenPlans.ts`): its entries read the arc's newest moment, so a
  // plan of the arc that opens or ends after the press brings the whole deck back, not one card of it.
  const news = entry.arc !== undefined ? arcNews.get(entry.arc) ?? null : newestMoment(plan);
  if (news !== null && news > entry.at) return 'drawn';
  return plan.status === 'complete' ? 'dismissed' : 'hidden';
}

/**
 * The ask this plan is waiting on, or `null` — `undefined` too, for a frame from a server older than
 * the `asking` key. One place decides that a plan without one is simply not waiting, so the count of
 * prompts and the lane's bell can read the same plans the same way.
 */
function planAsking(plan: DispatcherPlan): DispatcherAsk | null {
  return plan.asking ?? null;
}

/**
 * The newest moment the plan itself has on record, epoch seconds: its creation, its latest ending or
 * the moment its open ask was ASKED, whichever is later — or `null` when none of the three can be
 * dated. Any of them after a press is news (the gates above), and the later of the three answers all
 * of them.
 *
 * THE ASK IS THE ONE MOMENT THAT IS NOT THE PLAN MOVING. A creation means a different plan under a
 * reused name, and an ending means work the operator never saw; an ask means the plan is STUCK on
 * him, and it is the only one of the three that can be dated after a plan has already ended. Read
 * from the store's own `asked` stamp, never from a client clock: it is the ask's identity everywhere
 * else (`askIdentity`), and a moment the store wrote cannot drift with a browser.
 */
function newestMoment(plan: DispatcherPlan): number | null {
  const moments = [epochOf(plan.created_at), latestEnding(plan), epochOf(plan.asking?.asked.at ?? null)]
    .filter((moment): moment is number => moment !== null);
  return moments.length > 0 ? Math.max(...moments) : null;
}

/** Each arc's newest moment across every plan of it the lane carries, drawn or put away — its newest creation, ending or ask: what an arc press reads. */
function arcNewsOf(lane: readonly DispatcherPlan[]): Map<string, number> {
  const news = new Map<string, number>();
  for (const plan of lane) {
    const moment = plan.arc === null ? null : newestMoment(plan);
    if (plan.arc !== null && moment !== null) news.set(plan.arc, Math.max(moment, news.get(plan.arc) ?? moment));
  }
  return news;
}

/**
 * When the plan last ENDED, epoch seconds, or `null` when it cannot be dated. The store stamps
 * `completed_at` once and never moves it (`store_write.mark_complete`, guarded by the rule pass), so a
 * re-cut plan that walks to a second ending keeps its first stamp. A COMPLETE plan's latest ending is
 * therefore its newest phase `done_at`, which also dates a first ending the rule pass stamped late. A
 * plan that is not complete has only the stamp: a phase finishing is not the plan ending.
 */
function latestEnding(plan: DispatcherPlan): number | null {
  const stamp = epochOf(plan.completed_at);
  if (plan.status !== 'complete') return stamp;
  const phaseEnds = (plan.phases ?? []).map((phase) => epochOf(phase.done_at)).filter((end): end is number => end !== null);
  return phaseEnds.length > 0 ? Math.max(...phaseEnds) : stamp;
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
