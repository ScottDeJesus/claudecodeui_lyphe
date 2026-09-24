import { useMemo } from 'react';

import { epochOf } from '@/modules/dispatcher/dispatcherState';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import { DISPATCHER_ENDING_PREFIX, useDismissedEndings } from '@/modules/plan-runner';
import type { DismissedEnding } from '@/modules/plan-runner';
import type { DispatcherDaemon, DispatcherLanePicture, DispatcherPlan, DispatcherRoute } from '@/shared/types';

/**
 * The lane's read side: every v3 plan the dispatcher's store holds, and this box's posture beside
 * them.
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
 * A COMPLETE PLAN IS CARRIED UNTIL THE OPERATOR DISMISSES IT, exactly as an ended run is — the
 * server keeps it on the lane, and this is where the dismissal takes effect, so the tab's badge and
 * its list agree. The dismissal is the RUN LANE'S OWN LIST, not a second store: a plan's dismissal
 * id is `v3:<name>` and its ending is its `completed_at` in seconds, which is why the operator's
 * `v3` card and their run cards are one list of what they have already seen. A plan that is cut and
 * walked again gets a fresh `completed_at` — a NEW ending — and comes back as a new card, for the
 * run lane's reason: a dismissal is of one ending, never of a name.
 */
export function useDispatcherPlans(): {
  plans: DispatcherPlan[];
  count: number;
  route: DispatcherRoute | null;
  daemon: DispatcherDaemon | null;
  /** The dispatcher's next DeepSeek off-peak moment, epoch SECONDS, or `null` when the clock answered `none` or nothing is retained. */
  offpeakAt: number | null;
  /** Every plan the lane carries as a dismissal id, dismissed or not — what a dismissal prunes its stored list against. */
  carriedNames: string[];
} {
  const value = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);
  const dismissed = useDismissedEndings();

  return useMemo(() => {
    const picture = value?.payload;
    const lane = Array.isArray(picture?.plans) ? picture.plans : [];
    const plans = lane.filter((plan) => !isDismissedPlan(plan, dismissed));

    // The UNFILTERED lane on purpose: `dismissRun` prunes the stored list against every id the lane
    // still carries, and pruning against the filtered `plans` would drop every earlier dismissal the
    // moment a second one was made — the dispatcher still holds those plans, so they would come
    // straight back as cards.
    const carriedNames = lane.map((plan) => `${DISPATCHER_ENDING_PREFIX}${plan.name}`);
    return {
      plans,
      count: plans.length,
      route: picture?.route ?? null,
      daemon: picture?.daemon ?? null,
      offpeakAt: epochOf(picture?.offpeak_at ?? null),
      carriedNames,
    };
  }, [value, dismissed]);
}

/**
 * Whether THIS ending of the plan is one the operator waved away. Only a complete plan can be
 * dismissed, and only by the exact pair `{ v3:<name>, completed_at }` — a plan whose completion the
 * document cannot date (the field is null, or a stamp nothing can parse) has no ending to match and
 * stands, which is the safe direction: a card shown again costs a look, a card hidden twice costs
 * the operator a plan they never saw finish.
 *
 * It is written out here rather than borrowed from `isDismissed`, which reads a `RunnerRunSnapshot`
 * — the two lanes share the LIST and not the row, and forcing a plan through the run's shape to
 * reuse four lines of comparison would be the wrong kind of sharing.
 */
function isDismissedPlan(plan: DispatcherPlan, dismissed: readonly DismissedEnding[]): boolean {
  if (plan.status !== 'complete') return false;
  const endedAt = epochOf(plan.completed_at);
  if (endedAt === null) return false;
  return dismissed.some((ending) =>
    ending.run_id === `${DISPATCHER_ENDING_PREFIX}${plan.name}` && ending.ended_at === endedAt);
}
