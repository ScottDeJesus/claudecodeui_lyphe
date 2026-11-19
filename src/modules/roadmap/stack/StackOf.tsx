import { useCallback, useMemo, useRef, useState } from 'react';

import { useDispatcherPlans } from '@/modules/dispatcher';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { RoadmapStack } from '@/modules/roadmap/stack/RoadmapStack';
import { StackCard } from '@/modules/roadmap/stack/StackCard';
import { layoutStack } from '@/modules/roadmap/utils/stackLayout';
import type { RoadmapStackHandle, RoadmapStackRest, RoadmapStackTarget } from '@/shared/types';

/** No card open: what the face opens with, and what a press on nothing returns it to. */
const NO_CARD: RoadmapStackTarget | null = null;

type StackOfProps = {
  /** Where the stack rests as one small circle, on a page that keeps it small until pressed; absent, it always stands. */
  rest?: RoadmapStackRest;
  /** With a `rest`: whether it stands. */
  standing?: boolean;
  /** With a `rest`: the small circle was pressed. */
  onStand?: () => void;
  /** With a `rest`: the small circle's accessible name. */
  restLabel?: string;
  /** The stack's travel between two pages that both show it (`RoadmapStack`'s own three): where a standing stack arrives from and how many times, and how many times a resting one has come back. */
  arriveFrom?: RoadmapStackRest;
  arrivals?: number;
  returns?: number;
};

/**
 * THE RING OF WHAT IS IN FLIGHT, bound to what it needs: laid out from the dispatcher's lane and every roadmap's picture
 * (`layoutStack`), with the card a press opens (`StackCard`).
 *
 * WHAT IT HOLDS is what the In flight board draws, whichever roadmap or project it belongs to: the plans that are finished
 * and not yet dismissed, the ones being built, and the ones held (waiting for a Start or a turn, stopped, parked, or still
 * being designed, a word owed or not). It follows no choice of roadmap. A finished plan stands in the positive colour until
 * its Dismiss, which is the board's own (the lane's put-away), so the ring and the board never disagree about what is on them.
 *
 * A stack laid back down to its circle puts its card away.
 *
 * Used by `RoadmapStackFace` (the Roadmap tab's Stack face, always standing), `RoadmapStanding` (the station's room) and
 * `RoadmapCircle` (the small circle on the sessions home and beside a chat, small until pressed).
 */
export function StackOf({ rest, standing, onStand, restLabel, arriveFrom, arrivals, returns }: StackOfProps) {
  const stackRef = useRef<RoadmapStackHandle>(null);
  // The card that is open on the ring, by its feature's name; one at a time.
  const [open, setOpen] = useState<RoadmapStackTarget | null>(NO_CARD);
  const { plans } = useDispatcherPlans();
  const { picture } = useRoadmap();
  const tiers = useMemo(() => layoutStack(plans, picture), [plans, picture]);

  // Stable: the stack's frame loop and the card's Escape listener both hold it.
  const show = useCallback((target: RoadmapStackTarget | null) => {
    setOpen((held) => (held?.kind === target?.kind && held?.name === target?.name ? held : target));
  }, []);
  const close = useCallback(() => show(NO_CARD), [show]);
  // Laid back down, it holds no card: the next time it stands it stands bare.
  const laidDown = rest !== undefined && standing !== true;
  if (laidDown && open !== NO_CARD) setOpen(NO_CARD);

  return (
    <RoadmapStack
      tiers={tiers}
      arrival={0}
      open={open}
      onOpen={show}
      handleRef={stackRef}
      rest={rest}
      standing={standing}
      onStand={onStand}
      restLabel={restLabel}
      arriveFrom={arriveFrom}
      arrivals={arrivals}
      returns={returns}
      card={open !== null && <StackCard target={open} tiers={tiers} onClose={close} />}
    />
  );
}
