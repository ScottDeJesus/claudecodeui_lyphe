import { useMemo } from 'react';

import { RUNNER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import { isDismissed, useDismissedEndings } from '@/modules/plan-runner/dismissedRuns';
import type { RunnerRunSnapshot } from '@/shared/types';

/**
 * The lane's read side: every run the server can see, and which ONE of them a single-card slot
 * should show.
 *
 * It reads the bus and never the socket or the API. `RunnerFeed` is the only thing in the client
 * that names the `runner_state` frame; everything downstream of it — this hook, the Runner tab —
 * reads a retained topic and knows nothing about how it got there. That is what lets a card mount
 * at any moment and paint on its FIRST render with the value the bus was already holding, rather
 * than blank until the runner next moves.
 *
 * `undefined` (nothing retained yet) and `[]` (the lane is empty) collapse to `[]` on purpose: to
 * a screen they are the same instruction — draw nothing — and a caller forced to tell them apart
 * would grow a loading state for a fact that arrives in the same tick as the mount.
 *
 * `pinned` IS THE ONE RUN A SINGLE-CARD SLOT SHOWS: the newest LIVE run, else the newest STALE
 * one, and never a PAUSED one. A parked run is not in motion — the operator stopped it — and
 * raising it to the front every time they open the app would be the app arguing with a decision
 * they made. It is still in `runs` and still counted in `others`, so the Runner tab lists it and
 * offers Resume. Stale DOES take the slot: a run whose heartbeat lapsed may need a hand, which is
 * exactly what a single-card slot is for.
 *
 * NOTHING RENDERS THIS OVER THE CHAT TRANSCRIPT (operator ruling 2026-09-09). A card pinned above
 * the conversation took half a phone screen and left one transcript line with the keyboard open;
 * the Runner tab is the card's one home. `pinned` and `others` survive that ruling because the tab
 * itself wants them — which run heads the list, and how many follow it.
 *
 * ENDED RUNS ARE CARRIED UNTIL THE OPERATOR DISMISSES THEM (2026-09-09): the server keeps a
 * receipted run on the lane for a day, and this is where a dismissal takes effect — an ended run
 * whose ENDING the operator has waved away is dropped from `runs` and from `count`, so the tab's
 * badge and its list agree. Only ENDED runs are subject to it, and a dismissal is of one ending
 * (`{run_id, ended_at}`): a dismissed run that resumes is back while it moves, and back again as a
 * new card if it ends anew — a moving run is never something the operator asked to stop seeing, and
 * a second ending is news they have not seen.
 */
export function useRunnerRuns(): {
  runs: RunnerRunSnapshot[];
  count: number;
  pinned: RunnerRunSnapshot | null;
  others: number;
  /** Every id the lane carries, dismissed or not — what a dismissal prunes its stored list against. */
  carriedIds: string[];
} {
  const value = useLiveTopic<RunnerRunSnapshot[]>(RUNNER_ALL_TOPIC);
  const dismissed = useDismissedEndings();

  return useMemo(() => {
    const carried = Array.isArray(value?.payload) ? value.payload : [];
    const runs = carried.filter((run) => !isDismissed(run, dismissed));

    // One pass per state rather than a sort: the list is a handful of runs, and picking the
    // greatest `started_at` twice says what the rule IS more plainly than a comparator would.
    const newestIn = (state: RunnerRunSnapshot['state']): RunnerRunSnapshot | null =>
      runs.reduce<RunnerRunSnapshot | null>(
        (best, run) => (run.state === state && (best === null || run.started_at > best.started_at) ? run : best),
        null,
      );

    const pinned = newestIn('live') ?? newestIn('stale');
    // `carriedIds` is the UNFILTERED lane on purpose: `dismissRun` prunes the stored ids against it,
    // and pruning against the filtered `runs` would drop every earlier dismissal the moment a second
    // one was made — the server still carries those runs, so they would come straight back.
    const carriedIds = carried.map((run) => run.run_id);
    return { runs, count: runs.length, pinned, others: runs.length - (pinned ? 1 : 0), carriedIds };
  }, [value, dismissed]);
}
