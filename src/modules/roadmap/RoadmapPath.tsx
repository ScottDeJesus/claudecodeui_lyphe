import { Layers, Milestone, Puzzle, Route } from 'lucide-react';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import type { CelebrationActive } from '@/modules/roadmap/celebrationContext';
import { CelebrationLayer } from '@/modules/roadmap/CelebrationLayer';
import { FAKE_ROADMAP_VIEW } from '@/modules/roadmap/fake'; // FILL: fake — import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap'; import { useCelebrations } from '@/modules/roadmap/hooks/useCelebrations'; and the dialogs the slot mounts
import { MilestoneFocus } from '@/modules/roadmap/MilestoneFocus';
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
 * stations read to play their own part of a moment.
 *
 * ONE DIALOG AT A TIME, mounted in one slot: every press on the face that opens a dialog — a menu item, a
 * tile, the ghost station, a row, Place… — opens it here, through the opener the face provides.
 *
 * Used by `RoadmapTab`, as its Roadmap face.
 */
export function RoadmapPath({ onOpenCard: _onOpenCard }: RoadmapPathProps) { // FILL: onOpenCard — destructured as itself once the provider below hands it to FeatureRow's reveal and the slot hands it to FeatureDialog
  const { t } = useTranslation();
  const { picture, selected } = useContext(FAKE_ROADMAP_VIEW); // FILL: roadmap — useRoadmap(): the whole picture and the roadmap on screen
  // The face's own box: the celebrations play only while it is on screen, and the milestone's layer covers it.
  const rootRef = useRef<HTMLDivElement>(null);
  // The face's scroller: a milestone moment brings the path back into it before it plays.
  const scrollRef = useRef<HTMLDivElement>(null);
  // FILL: celebrations — useCelebrations(selected, rootRef) (hooks/useCelebrations.ts): what plays on this face; its `active` is the CelebrationContext value below, its `moment` and `skip` the layer's
  const active: CelebrationActive = { tasks: new Set(), features: new Set(), epics: new Set(), milestone: null };
  // FILL: moment — when a milestone moment arrives and its station lies outside scrollRef's view, scroll the face so the path is in it, within the layer's 900 ms entrance (instantly under reduced motion), so the draw, the bloom and the burst play where the reader is looking
  useEffect(() => {}, []);
  // FILL: dialog — component state, with its comment: which dialog is open, for which item, adding or editing (one at a time); its opener is the face context's, provided below
  // FILL: focus — component state per roadmap, with its comment: the milestone the operator put on the stage by pressing its station, remembered per roadmap so a switch and back returns to it; `focus(name)` is a station's press
  const [focusedName, focus] = useState<string | null>(null);

  // The stage's milestone: the one pressed, else the current one, else the last — so a roadmap whose
  // every milestone is reached opens on the one it reached last, and a pressed station that has since
  // gone falls back the same way.
  const milestones = selected?.milestones ?? [];
  const focused = milestones.find((item) => item.name === focusedName)
    ?? milestones.find((item) => item.name === selected?.current)
    ?? milestones.at(-1)
    ?? null;
  const loading = picture === null || (picture.roadmaps.length > 0 && selected === null);

  return (
    // FILL: provider — the face's own context nests inside this provider, here and at its close: the dialog host's opener (read by RoadmapHeader, RoadmapPicker, MilestonePath's ghost station, MilestoneFocus, EpicCard and RoadmapRail) and onOpenCard (read by FeatureRow's reveal; FeatureDialog is handed it in the slot)
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
                onAction={() => {}} // FILL: onNew — ItemDialog adding a roadmap (kind roadmap)
              />
            </div>
          </div>
        ) : (
          <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
            <div className="mx-auto flex w-full min-w-0 max-w-screen-2xl flex-col gap-8 px-4 pb-12 pt-5 lg:px-6 lg:pt-6">
              {picture !== null && picture.unplaced.epics.length + picture.unplaced.features.length > 0 && (
                <UnplacedBanner
                  unplaced={picture.unplaced}
                  onPlace={(_item: Unplaced) => {}} // FILL: onPlace — MoveDialog for this unplaced epic or feature: the milestones for an epic, the epics for a feature
                />
              )}

              <RoadmapHeader key={selected.name} roadmap={selected} focused={focused?.name ?? null} onFocus={focus} />

              {focused === null ? (
                <EmptyState
                  icon={Milestone}
                  title={t('roadmap.empty.noPath')}
                  actionLabel={t('roadmap.menu.addMilestone')}
                  onAction={() => {}} // FILL: onAddMilestone — ItemDialog adding a milestone (kind milestone, parent selected.name)
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

        {/* FILL: dialogs — the open dialog mounts here */}
        {/* FILL: moment — the hook's moment and skip: moment={moment} onSkip={skip} */}
        <CelebrationLayer moment={null} onSkip={() => {}} scope="face" />
      </div>
    {/* FILL: provider — its close, the face's own context's beside this one's */}
    </CelebrationContext.Provider>
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
