import { useDispatcherPlans } from '@/modules/dispatcher';
import { RoadmapDialogHost } from '@/modules/roadmap/RoadmapDialogHost';
import { StackOf } from '@/modules/roadmap/stack/StackOf';
import { useRevealCard } from '@/shared/hooks/useRevealCard';
import type { RoadmapStackRest } from '@/shared/types';

type RoadmapStandingProps = {
  /**
   * Where the stack arrives from, in the pixels of its own box, when the reader comes from a page that showed it as a small circle there; with
   * `arrivals`, the count of such comings. Each time the count goes up the stack starts as that circle and stands up from it. Absent: it is simply there.
   */
  arriveFrom?: RoadmapStackRest;
  arrivals?: number;
};

/**
 * WHAT IS IN FLIGHT, STANDING ON A PAGE THAT IS NOT THE ROADMAP'S: the In flight board's plans as the whole ring (`StackOf`), already
 * up, filling the box its owner gives it. It is `RoadmapCircle`'s other form: where a page has the room, the stack stands in it; where it has none, the
 * circle waits to be pressed. Presses, keys, the reading under it with its presses and a feature's card are the ring's own, as on the Roadmap tab's Stack face.
 *
 * Nothing is drawn while nothing is in flight: the lane's picture still on its way, or no plan on it.
 *
 * The roadmap's dialogs (a feature's questions) open over the page through `RoadmapDialogHost`.
 *
 * Exported through the roadmap barrel for the station's scene (`StationShell`), in the room over the companion while nothing is on the panel.
 */
export function RoadmapStanding({ arriveFrom, arrivals }: RoadmapStandingProps) {
  const { plans } = useDispatcherPlans();
  const reveal = useRevealCard();

  if (plans.length === 0) return null;
  return (
    <div data-roadmap-standing="" className="relative h-full min-h-0 w-full">
      <RoadmapDialogHost onOpenCard={reveal}>
        {() => <StackOf arriveFrom={arriveFrom} arrivals={arrivals} />}
      </RoadmapDialogHost>
    </div>
  );
}
