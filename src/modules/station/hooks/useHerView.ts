import { useStationPref } from '@/modules/station/context/StationContext';
import type { StationHerView } from '@/shared/types';

/**
 * How her column draws her on this device, and the setter that changes it: the station pref `herView`, so it is stored in the
 * station's record and the station reopens in the view he last used. A device that has never chosen one reads `portrait`. Used
 * by her head (`StationHead`, which draws the toggle and her face only in `chat`) and her conversation (`StationConversation`,
 * which draws her portrait in `portrait`), so the two regions of her column always agree.
 */
export function useHerView(): [StationHerView, (next: StationHerView) => void] {
  return useStationPref<StationHerView>('herView', 'portrait');
}
