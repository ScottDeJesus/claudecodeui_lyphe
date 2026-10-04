import { Layers, Milestone, Puzzle, Route } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import { CelebrationLayer } from '@/modules/roadmap/CelebrationLayer';
import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import type { FaceDialog, RoadmapFace } from '@/modules/roadmap/faceContext';
import { useCelebrations } from '@/modules/roadmap/hooks/useCelebrations';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { MilestoneFocus } from '@/modules/roadmap/MilestoneFocus';
import { OpenDialog } from '@/modules/roadmap/modals/OpenDialog';
import { RoadmapHeader } from '@/modules/roadmap/RoadmapHeader';
import { RoadmapRail } from '@/modules/roadmap/RoadmapRail';
import type { RoadmapPicture } from '@/shared/roadmap-types';
import { Badge, Banner, Button, EmptyState, ScrollArea, Spinner } from '@/shared/ui';

/** Something the store holds that no roadmap reaches yet, as the banner names it: an epic (`arc`) or a feature (`plan`). */
type Unplaced = { kind: 'arc' | 'plan'; name: string; title: string };

type RoadmapPathProps = {
  /** Shows a feature's live card: RoadmapTab turns to In flight and brings that card into view. */
  onOpenCard: (plan: string) => void;
};

/**
 * The Roadmap face: one roadmap as a path to its goal. At the top, what the store holds that no roadmap
 * reaches yet, when it holds anything; then the header — the picker, the goal, the standing and the path;
 * then the stage, the focused milestone with its epics, beside the rail of what wants the operator from
 * 1280px up and above it below that. Every other state says its own thing: the picture still on its
 * way, no roadmap at all, and a roadmap with no milestone yet.
 *
 * THE FACE'S BOX IS THE CELEBRATIONS' BOX. `rootRef` is what `useCelebrations` watches (a moment plays
 * only while this face is on screen), and its `relative` box is what `CelebrationLayer` covers, as its
 * last child, outside the scroller — so the milestone's banner centres in what the reader sees, not in a
 * content box scrolled half away. The face provides `CelebrationContext`, which the rows, cards and
 * stations read to play their own part of a moment; while a feature, epic or milestone moment plays, its
 * milestone holds the stage, so the card or row it plays on is drawn. A task moment moves nothing: its
 * row plays where it already is.
 *
 * ONE DIALOG AT A TIME, mounted in one slot: every press on the face that opens a dialog — a menu item, a
 * tile, the ghost station, a row, Place… — opens it here, through the opener the face provides.
 *
 * Used by `RoadmapTab`, as its Roadmap face.
 */
export function RoadmapPath({ onOpenCard }: RoadmapPathProps) {
  const { t } = useTranslation();
  const { picture, selected } = useRoadmap();
  // The face's own box: the celebrations play only while it is on screen, and the milestone's layer covers it.
  const rootRef = useRef<HTMLDivElement>(null);
  // The face's scroller: a milestone moment brings the path back into it before it plays.
  const scrollRef = useRef<HTMLDivElement>(null);
  const milestones = selected?.milestones ?? [];
  // What plays on this face: `active` is the CelebrationContext value below, `moment` and `skip` the layer's.
  const { moment, skip, active } = useCelebrations(selected, rootRef);
  // The milestone holding what plays: named by `active.milestone`, or holding an epic of `active.epics`
  // or a feature of `active.features`. The hook keeps `active` through the beat between two moments and
  // empties it with the queue, so this holds through the gaps and is null once it is empty. A TASK moment
  // is left out on purpose: its meter plays wherever its row is drawn (the stage or the rail's In flight
  // section), and a task lands every few minutes while a feature walks, so taking the stage for it would
  // pull the reader off the milestone he pressed and remount what he has open there.
  const playing = milestones.find((item) => item.name === active.milestone)
    ?? milestones.find((item) => item.epics.some((epic) => active.epics.has(epic.name) || epic.features.some((feature) => active.features.has(feature.name))))
    ?? null;
  // A milestone moment plays on its station, so a station scrolled out of the face's view (down the
  // page, or along the sideways rail on a phone) is brought into it first: the smooth scroll lands inside
  // the layer's 900 ms entrance, so the rail's draw, the bloom and the burst play where the reader looks.
  // Instantly under reduced motion, which asks for no travel. A station already in view is left alone.
  useEffect(() => {
    if (moment?.level !== 'milestone') return;
    const scroller = scrollRef.current;
    const station = scroller?.querySelector<HTMLElement>(`[data-roadmap-milestone="${CSS.escape(moment.name)}"]`);
    if (!scroller || !station) return;
    const view = scroller.getBoundingClientRect();
    const box = station.getBoundingClientRect();
    const clipped = box.top < view.top || box.bottom > view.bottom || box.left < view.left || box.right > view.right;
    if (!clipped) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    station.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center', inline: 'center' });
  }, [moment]);
  // Which dialog is open, for which item, adding or editing — one at a time, as a dialog is modal. `null`
  // for none. Its opener is the face context's `openDialog`, so any press under the face can put one up.
  const [dialog, setDialog] = useState<FaceDialog | null>(null);
  // The milestone the operator put on the stage by pressing its station, kept per roadmap (by name) so a
  // switch to the other roadmap and back returns to the one he left on. Not derivable: only his press says it.
  const [focusedBy, setFocusedBy] = useState<Record<string, string>>({});
  const selectedName = selected?.name ?? null;
  const focusedName = selectedName === null ? null : focusedBy[selectedName] ?? null;
  const focus = useCallback((name: string) => {
    if (selectedName !== null) setFocusedBy((held) => ({ ...held, [selectedName]: name }));
  }, [selectedName]);
  // What every press under the face reaches: the dialog opener, the card opener the tab supplied, and the stage.
  const face = useMemo<RoadmapFace>(() => ({ openDialog: setDialog, openCard: onOpenCard, focus }), [onOpenCard, focus]);

  // The stage's milestone: the one a moment is playing on, else the one pressed, else the current one,
  // else the last. A moment's milestone borrows the stage because an epic's card and a feature's row play
  // their own part only where they are drawn — when a milestone's last feature ships, `current` moves on
  // and would take the stage with it. A roadmap whose every milestone is reached opens on the one it
  // reached last, and a pressed station that has since gone falls back the same way.
  const focused = playing
    ?? milestones.find((item) => item.name === focusedName)
    ?? milestones.find((item) => item.name === selected?.current)
    ?? milestones.at(-1)
    ?? null;
  const loading = picture === null || (picture.roadmaps.length > 0 && selected === null);

  return (
    <RoadmapFaceContext.Provider value={face}>
    <CelebrationContext.Provider value={active}>
      <div ref={rootRef} className="relative flex h-full min-h-0 flex-col" data-roadmap-face>
        {loading ? (
          <div className="grid flex-1 place-items-center p-6">
            <Spinner label={t('roadmap.loading')} />
          </div>
        ) : selected === null ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-md">
              <EmptyState
                icon={Route}
                title={t('roadmap.empty.none')}
                message={t('roadmap.empty.noneMessage')}
                actionLabel={t('roadmap.picker.new')}
                onAction={() => setDialog({ dialog: 'add', kind: 'roadmap', parent: null })}
              />
            </div>
          </div>
        ) : (
          <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
            <div className="mx-auto flex w-full min-w-0 max-w-screen-2xl flex-col gap-8 px-4 pb-12 pt-5 lg:px-6 lg:pt-6">
              {picture !== null && picture.unplaced.epics.length + picture.unplaced.features.length > 0 && (
                <UnplacedBanner
                  unplaced={picture.unplaced}
                  onPlace={(item: Unplaced) => setDialog({ dialog: 'move', kind: item.kind, name: item.name })}
                />
              )}

              <RoadmapHeader key={selected.name} roadmap={selected} focused={focused?.name ?? null} onFocus={focus} />

              {focused === null ? (
                <EmptyState
                  icon={Milestone}
                  title={t('roadmap.empty.noPath')}
                  actionLabel={t('roadmap.menu.addMilestone')}
                  onAction={() => setDialog({ dialog: 'add', kind: 'milestone', parent: selected })}
                />
              ) : (
                // The stage, then the rail: beside it from 1280px up, under it below. A rail with nothing to say draws nothing, and the stage takes the row.
                <div className="flex min-w-0 flex-col gap-8 xl:flex-row xl:items-start">
                  <div className="min-w-0 flex-1">
                    <MilestoneFocus key={focused.name} roadmap={selected} milestone={focused} />
                  </div>
                  <RoadmapRail roadmap={selected} />
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {dialog !== null && <OpenDialog dialog={dialog} onClose={() => setDialog(null)} onOpenCard={onOpenCard} />}
        <CelebrationLayer moment={moment} onSkip={skip} scope="face" />
      </div>
    </CelebrationContext.Provider>
    </RoadmapFaceContext.Provider>
  );
}

/**
 * What the store holds that no roadmap reaches — epics under no milestone, features under no epic — in
 * one informational strip over the roadmap, each with the press that puts it on one. It names each by
 * its kind (the dispatcher's own Epic and Feature tags) so a title is never mistaken for the other.
 */
function UnplacedBanner({ unplaced, onPlace }: { unplaced: RoadmapPicture['unplaced']; onPlace: (item: Unplaced) => void }) {
  const { t } = useTranslation();
  // Each title's id: its Place… press is described by it, so three presses named alike are told apart.
  const titleId = useId();
  const items: Unplaced[] = [
    ...unplaced.epics.map((item) => ({ kind: 'arc' as const, name: item.name, title: item.title })),
    ...unplaced.features.map((item) => ({ kind: 'plan' as const, name: item.name, title: item.title })),
  ];
  // One grid for every row, so the kinds, the titles and the presses each stand in a column; held to a
  // reading measure, so on a wide face each Place… stays beside the title it places.
  return (
    <div data-roadmap-unplaced>
      <Banner tone="info">
        <p className="font-medium">{t('roadmap.unplaced.banner', { count: items.length })}</p>
        <ul className="mt-1.5 grid max-w-2xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
          {items.map((item, index) => (
            <li key={item.name} className="col-span-3 grid grid-cols-subgrid items-center">
              <Badge as="span" kind={item.kind === 'arc' ? 'epic' : 'feature'} className="gap-1 justify-self-start">
                {item.kind === 'arc' ? <Layers aria-hidden="true" className="size-3.5" /> : <Puzzle aria-hidden="true" className="size-3.5" />}
                {t(item.kind === 'arc' ? 'roadmap.kind.epic' : 'roadmap.kind.feature')}
              </Badge>
              <span id={`${titleId}-${index}`} className="truncate">{item.title}</span>
              <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" aria-describedby={`${titleId}-${index}`} onClick={() => onPlace(item)}>
                {t('roadmap.unplaced.place')}
              </Button>
            </li>
          ))}
        </ul>
      </Banner>
    </div>
  );
}
