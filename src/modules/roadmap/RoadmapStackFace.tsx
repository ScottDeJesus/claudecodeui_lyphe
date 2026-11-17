import { Milestone, Route } from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { RoadmapDialogHost } from '@/modules/roadmap/RoadmapDialogHost';
import { RoadmapPicker } from '@/modules/roadmap/RoadmapPicker';
import { RoadmapStack } from '@/modules/roadmap/stack/RoadmapStack';
import { StackCard } from '@/modules/roadmap/stack/StackCard';
import { isLater } from '@/modules/roadmap/utils/celebrationMoments';
import { currentSeenStamp, rememberSeen } from '@/modules/roadmap/utils/seenStamp';
import { arrivalTier, layoutStack } from '@/modules/roadmap/utils/stackLayout';
import { useRevealCard } from '@/shared/hooks/useRevealCard';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapStackHandle, RoadmapStackTarget } from '@/shared/types';
import { EmptyState, Spinner } from '@/shared/ui';

type RoadmapStackFaceProps = {
  /** Shows a feature's live card on the In flight face, for a roadmap dialog's Open its card; `null` where the surface has no tab to turn (the landing is then `?runner=<plan>`). */
  openCard: ((plan: string) => void) | null;
};

/** The seen stamp the visit measures against, once read: the roadmap it was read for, and the stamp (`null` on a first visit). */
type SeenRead = { roadmap: string; at: string | null };

/** No card open: what the face opens with, and what a press on nothing returns it to. */
const NO_CARD: RoadmapStackTarget | null = null;

/** The stack of one roadmap, with what shipped since the operator last looked standing over the rest until he opens it. */
function StackOf({ roadmap }: { roadmap: Roadmap }) {
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

  const tiers = useMemo(() => layoutStack(roadmap, unseen), [roadmap, unseen]);
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

  return (
    <RoadmapStack
      roadmap={roadmap}
      tiers={tiers}
      arrival={arrival}
      open={open}
      onOpen={show}
      handleRef={stackRef}
      card={open !== null && <StackCard target={open} tiers={tiers} onClose={close} onOpenFeature={openFeature} />}
    />
  );
}

/** The face under its dialog host: the states that come before a stack, the picker, then the stack of the roadmap on screen. */
function StackFaceBody() {
  const { t } = useTranslation();
  const { picture, selected } = useRoadmap();
  const { openDialog } = useContext(RoadmapFaceContext);
  const loading = picture === null || (picture.roadmaps.length > 0 && selected === null);

  if (loading) {
    return <div className="grid flex-1 place-items-center p-6"><Spinner label={t('roadmap.loading')} /></div>;
  }
  if (selected === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <EmptyState
            icon={Route}
            title={t('roadmap.empty.none')}
            message={t('roadmap.empty.noneMessage')}
            actionLabel={t('roadmap.picker.new')}
            onAction={() => openDialog({ dialog: 'add', kind: 'roadmap', parent: null })}
          />
        </div>
      </div>
    );
  }
  return (
    <>
      <div data-roadmap-header={selected.name} className="shrink-0 px-4 pt-3 lg:px-6">
        <div className="w-64 max-w-full"><RoadmapPicker size="sm" /></div>
      </div>
      {selected.milestones.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md">
            <EmptyState
              icon={Milestone}
              title={t('roadmap.empty.noPath')}
              actionLabel={t('roadmap.menu.addMilestone')}
              onAction={() => openDialog({ dialog: 'add', kind: 'milestone', parent: selected })}
            />
          </div>
        </div>
      ) : (
        // Keyed by the roadmap: another roadmap is another stack, arriving on its own current milestone with no card open.
        <div className="min-h-0 flex-1"><StackOf key={selected.name} roadmap={selected} /></div>
      )}
    </>
  );
}

/**
 * THE ROADMAP AS A STACK, as a face of the Roadmap tab: the picker, then the roadmap on screen as rings (`RoadmapStack`),
 * one per milestone, the current one standing open with a wall for every feature. One object is the way round the
 * roadmap, the measure of how far along it is, and the gauge of what asks for the operator; it is quiet until pressed,
 * and what a press opens is that feature's own card, in place (`StackCard`).
 *
 * It keeps the states every roadmap surface has before there is something to draw (the picture still on its way, no
 * roadmap at all, a roadmap with no milestone yet), with the same words and the same presses as the tree's face.
 *
 * WHAT SHIPPED WHILE HE WAS AWAY STANDS OVER THE REST, in the positive colour, until he opens it: measured against the
 * roadmap's seen stamp as it stood when the visit began (`utils/seenStamp`, the one the celebrations move), and the
 * stamp moves on once every such feature has been opened.
 *
 * The roadmap's own dialogs open over it through `RoadmapDialogHost`: an epic's menu and its Add a feature, and the
 * empty states' New roadmap and Add a milestone. A feature dialog's Open its card goes to `openCard`, the tab's turn to
 * In flight, or to the `?runner=` landing where there is no tab.
 *
 * `data-roadmap-stack-face` marks its root; `data-roadmap-header` (the roadmap's name) its picker row.
 *
 * Used by `RoadmapTab`, as its Stack face.
 */
export function RoadmapStackFace({ openCard }: RoadmapStackFaceProps) {
  const reveal = useRevealCard();
  return (
    <div data-roadmap-stack-face className="relative flex h-full min-h-0 flex-col">
      <RoadmapDialogHost onOpenCard={openCard ?? reveal}>
        {() => <StackFaceBody />}
      </RoadmapDialogHost>
    </div>
  );
}
