import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { RoadmapDialogHost } from '@/modules/roadmap/RoadmapDialogHost';
import { StackOf } from '@/modules/roadmap/stack/StackOf';
import { useRevealCard } from '@/shared/hooks/useRevealCard';

/**
 * THE ROADMAP STANDING ON A PAGE THAT IS NOT THE ROADMAP'S: the roadmap on screen (`useRoadmap`'s selected one) as its whole stack (`StackOf`), already
 * up, filling the box its owner gives it. It is `RoadmapCircle`'s other form: where a page has the room, the stack stands in it; where it has none, the
 * circle waits to be pressed. Presses, keys, the reading under it and a feature's card are the stack's own, as on the Roadmap tab's Stack face.
 *
 * Nothing is drawn while there is nothing to draw: the picture still on its way, no roadmap, a roadmap with no milestone yet.
 *
 * The roadmap's dialogs (an epic's menu, its Add a feature, a feature's questions) open over the page through `RoadmapDialogHost`.
 *
 * Exported through the roadmap barrel for the station's scene (`StationShell`), in the room over the companion while nothing is on the panel.
 */
export function RoadmapStanding() {
  const { picture, selected } = useRoadmap();
  const reveal = useRevealCard();

  if (picture === null || selected === null || selected.milestones.length === 0) return null;
  return (
    <div data-roadmap-standing="" className="relative h-full min-h-0 w-full">
      <RoadmapDialogHost onOpenCard={reveal}>
        {/* Keyed by the roadmap: another roadmap is another stack, arriving on its own current milestone. */}
        {() => <StackOf key={selected.name} roadmap={selected} />}
      </RoadmapDialogHost>
    </div>
  );
}
