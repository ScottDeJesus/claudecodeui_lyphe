import { useMemo } from 'react';

import { SOULS_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { SoulLaunchSnapshot } from '@/shared/types';

/**
 * The lane's read side: every launcher soul the server can see, keyed by launch id.
 *
 * It reads the bus and never the socket or the API. `SoulLaunchFeed` is the only thing in the
 * client that names the `soul_launch_state` frame; everything downstream of it reads a retained
 * topic and knows nothing about how it got there — which is what lets the pin strip mount at any
 * moment and paint on its FIRST render with the picture the bus was already holding.
 *
 * A MAP RATHER THAN THE ARRAY, because of what the reader does with it: the strip holds a list of
 * ids ANCHORED IN THE TRANSCRIPT and asks, for each, whether the lane knows that launch. An array
 * would be walked once per anchor; this is one lookup each, and it is also where the "which
 * launches are real" question is answered — an id no entry answers for is a launch this lane does
 * not carry, and draws nothing.
 *
 * `undefined` (nothing retained yet) and `[]` (the lane is empty) collapse to an empty map on
 * purpose: to a screen they are the same instruction — draw nothing — and a caller forced to tell
 * them apart would grow a loading state for a fact that arrives in the same tick as the mount.
 */
export function useSoulLaunches(): Map<string, SoulLaunchSnapshot> {
  const value = useLiveTopic<SoulLaunchSnapshot[]>(SOULS_ALL_TOPIC);

  return useMemo(() => {
    const carried = Array.isArray(value?.payload) ? value.payload : [];
    const byId = new Map<string, SoulLaunchSnapshot>();
    for (const launch of carried) {
      if (typeof launch?.launch_id === 'string') byId.set(launch.launch_id, launch);
    }
    return byId;
  }, [value]);
}
