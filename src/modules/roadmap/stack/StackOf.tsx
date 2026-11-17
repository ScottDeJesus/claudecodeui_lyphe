import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RoadmapStack } from '@/modules/roadmap/stack/RoadmapStack';
import { StackCard } from '@/modules/roadmap/stack/StackCard';
import { isLater } from '@/modules/roadmap/utils/celebrationMoments';
import { currentSeenStamp, rememberSeen } from '@/modules/roadmap/utils/seenStamp';
import { arrivalTier, layoutStack } from '@/modules/roadmap/utils/stackLayout';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapStackHandle, RoadmapStackRest, RoadmapStackTarget, RoadmapStackTier } from '@/shared/types';

/** The seen stamp the visit measures against, once read: the roadmap it was read for, and the stamp (`null` on a first visit). */
type SeenRead = { roadmap: string; at: string | null };

/** No card open: what the face opens with, and what a press on nothing returns it to. */
const NO_CARD: RoadmapStackTarget | null = null;

/** The stack before its roadmap's seen stamp has been read: no ring yet. One array, so the painter is not handed a new nothing each render. */
const NO_TIERS: RoadmapStackTier[] = [];

type StackOfProps = {
  roadmap: Roadmap;
  /** Where the stack rests as one small circle, on a page that keeps it small until pressed; absent, it always stands. */
  rest?: RoadmapStackRest;
  /** With a `rest`: whether it stands. */
  standing?: boolean;
  /** With a `rest`: the small circle was pressed. */
  onStand?: () => void;
  /** With a `rest`: the small circle's accessible name. */
  restLabel?: string;
};

/**
 * THE STACK OF ONE ROADMAP, bound to what it needs: laid out from the picture (`layoutStack`), with the card a press opens (`StackCard`), and with what
 * shipped since the operator last looked standing over the rest, in the positive colour, until he opens it.
 *
 * WHAT IS NEW is measured against the roadmap's seen stamp as it stood when this stack was mounted (`utils/seenStamp`, the one the celebrations move). A
 * feature stops being new once its card has been opened here, and once every such feature has been opened the stamp moves to the newest of them.
 *
 * A stack laid back down to its circle puts its card away.
 *
 * Used by `RoadmapStackFace` (the Roadmap tab's Stack face, always standing) and `RoadmapCircle` (the sessions home's circle, small until pressed).
 */
export function StackOf({ roadmap, rest, standing, onStand, restLabel }: StackOfProps) {
  const stackRef = useRef<RoadmapStackHandle>(null);
  // The card that is open on the stack, by the feature's or the epic's name; one at a time.
  const [open, setOpen] = useState<RoadmapStackTarget | null>(NO_CARD);
  // The seen stamp as it stood when this visit began, read once per roadmap (the server's copy is asked too, so it is
  // not known at once). What shipped after it is what he has not seen.
  const [seen, setSeen] = useState<SeenRead | null>(null);
  // The features he has opened on this visit: a wall stops standing over the rest once its card has been opened.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let current = true;
    void currentSeenStamp(roadmap.name).then((at) => {
      if (current) setSeen({ roadmap: roadmap.name, at });
    });
    return () => { current = false; };
  }, [roadmap.name]);

  const features = useMemo(() => roadmap.milestones.flatMap((milestone) => milestone.epics.flatMap((epic) => epic.features)), [roadmap]);
  // On a first visit (no stamp) nothing is new: everything shipped would otherwise stand tall at once.
  const stamp = seen !== null && seen.roadmap === roadmap.name ? seen.at : null;
  const unseen = useMemo(() => new Set(
    stamp === null ? [] : features.filter((feature) => isLater(feature.shipped_at, stamp) && !opened.has(feature.name)).map((feature) => feature.name),
  ), [features, stamp, opened]);

  // Once he has opened every feature that shipped while he was away, the stamp moves to the newest of them, so the
  // next visit (and the tree's own celebrations) start from there. Until the stamp is read there is nothing to move.
  const newest = useMemo(() => features.reduce<string | null>((latest, feature) => (
    feature.shipped_at !== null && (latest === null || isLater(feature.shipped_at, latest)) ? feature.shipped_at : latest
  ), null), [features]);
  useEffect(() => {
    if (seen === null || seen.roadmap !== roadmap.name || newest === null || unseen.size > 0) return;
    if (seen.at === null || isLater(newest, seen.at)) rememberSeen(roadmap.name, newest);
  }, [seen, roadmap.name, newest, unseen]);

  // Nothing is laid out until the stamp has been read: the stack's first picture is its arrival, turned to the newest thing he has not seen, and a picture
  // drawn before the stamp would arrive knowing of none.
  const stampRead = seen !== null && seen.roadmap === roadmap.name;
  const tiers = useMemo(() => (stampRead ? layoutStack(roadmap, unseen) : NO_TIERS), [stampRead, roadmap, unseen]);
  const arrival = useMemo(() => arrivalTier(roadmap, tiers), [roadmap, tiers]);

  // Stable: the stack's frame loop and the card's Escape listener both hold it.
  const show = useCallback((target: RoadmapStackTarget | null) => {
    setOpen((held) => (held?.kind === target?.kind && held?.name === target?.name ? held : target));
    if (target?.kind === 'feature') setOpened((names) => (names.has(target.name) ? names : new Set(names).add(target.name)));
  }, []);
  const close = useCallback(() => show(NO_CARD), [show]);
  const openFeature = useCallback((name: string) => {
    stackRef.current?.face(name);
    show({ kind: 'feature', name });
  }, [show]);
  // Laid back down, it holds no card: the next time it stands it stands bare.
  const laidDown = rest !== undefined && standing !== true;
  if (laidDown && open !== NO_CARD) setOpen(NO_CARD);

  return (
    <RoadmapStack
      roadmap={roadmap}
      tiers={tiers}
      arrival={arrival}
      open={open}
      onOpen={show}
      handleRef={stackRef}
      rest={rest}
      standing={standing}
      onStand={onStand}
      restLabel={restLabel}
      card={open !== null && <StackCard target={open} tiers={tiers} onClose={close} onOpenFeature={openFeature} />}
    />
  );
}
