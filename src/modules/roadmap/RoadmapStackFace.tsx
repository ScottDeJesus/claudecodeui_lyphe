import { RoadmapDialogHost } from '@/modules/roadmap/RoadmapDialogHost';
import { StackOf } from '@/modules/roadmap/stack/StackOf';
import { useRevealCard } from '@/shared/hooks/useRevealCard';

type RoadmapStackFaceProps = {
  /** Shows a feature's live card on the In flight face, for a roadmap dialog's Open its card; `null` where the surface has no tab to turn (the landing is then `?runner=<plan>`). */
  openCard: ((plan: string) => void) | null;
};

/**
 * THE RING, as a face of the Roadmap tab: what is in flight as one ring (`StackOf`), a wall for each plan the In flight face
 * draws, whichever roadmap or project it belongs to: finished and not yet dismissed, being built, or held. It follows no
 * choice of roadmap, so it has no picker. It is quiet until pressed: what faces the operator is said under it with its
 * presses (Start, Release, Stop, Dismiss), and a press on the wall opens that plan's own card, in place (`StackCard`).
 *
 * The roadmap's own dialogs open over it through `RoadmapDialogHost`. A feature dialog's Open its card goes to `openCard`,
 * the tab's turn to In flight, or to the `?runner=` landing where there is no tab.
 *
 * `data-roadmap-stack-face` marks its root.
 *
 * Used by `RoadmapTab`, as its Stack face.
 */
export function RoadmapStackFace({ openCard }: RoadmapStackFaceProps) {
  const reveal = useRevealCard();
  return (
    <div data-roadmap-stack-face className="relative flex h-full min-h-0 flex-col">
      <RoadmapDialogHost onOpenCard={openCard ?? reveal}>
        {() => <div className="min-h-0 flex-1"><StackOf /></div>}
      </RoadmapDialogHost>
    </div>
  );
}
